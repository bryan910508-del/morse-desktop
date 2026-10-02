import assert from 'node:assert/strict'
import { test } from 'node:test'
import { purgesAccountData, registrationDelay, registrationOutcome, rejectionFailure, type RegistrationOutcome } from '../../src/main/network/registration-outcome'
import { tokenFailureEffect, type AuthFailureCode } from '../../src/main/auth/contracts'

// Every `registrationFailed` the server sends (talky-server index.js: registrationFailure calls in `register`,
// registrationFailurePayload for anything it did not expect, and `revoke` from the watches it keeps afterwards),
// plus the one this build makes of a `registered` it cannot use.
const server: [error: string, reason: string, outcome: RegistrationOutcome][] = [
  ['SERVICE_UNAVAILABLE', 'firebase-unavailable', 'retry'],
  ['UPGRADE_REQUIRED', 'client-protocol-too-old', 'update'],
  ['PROTOCOL_UNSUPPORTED', 'server-protocol-too-old', 'unsupported'],
  ['INVALID_REGISTRATION', 'malformed-registration', 'refused'],
  ['INVALID_REGISTRATION', 'session-required', 'refused'],
  ['UNAUTHORIZED', 'token-account-mismatch', 'renew'],
  ['UNAUTHORIZED', 'token-expired', 'renew'],
  ['UNAUTHORIZED', 'credential-generation-missing', 'retry'],
  ['UNAUTHORIZED', 'account-unavailable', 'confirm'],
  ['UNAUTHORIZED', 'credential-revoked', 'confirm'],
  ['UNAUTHORIZED', 'session-revoked', 'confirm'],
  // A5 contract §3-2: no session document, or one of another sign-in.
  ['UNAUTHORIZED', 'session-unconfirmed', 'confirm'],
  // Any exception the server did not expect — a Firebase Auth lookup or a Firestore read failing for a moment.
  ['UNAUTHORIZED', 'authentication-failed', 'retry'],
  // The server's watch of the account failing after it registered this socket.
  ['UNAUTHORIZED', 'authorization-monitor-failed', 'retry']
]

test('each refusal the server can send is read for what it means', () => {
  for (const [error, reason, outcome] of server) assert.equal(registrationOutcome({ error, reason }), outcome, `${error}:${reason}`)
  assert.equal(registrationOutcome({ reason: 'protocol-unsupported' }), 'unsupported', 'this build\'s own reading of a registered it cannot use')
})

// F-RT-001: one temporary server error used to clear the queue of messages not yet sent, uploads, drafts and what
// this device hid. Telegram forgets an account's data only on 401 — here, startMorseDeviceSession's «session-revoked»
// (A5 contract §3-1). Nothing the socket sends clears it by itself: its four «may be gone» reasons only ask the server.
test('only a sign-in the server says is gone clears what this device kept for the account', () => {
  const purging = server.filter(([error, reason]) => purgesAccountData(registrationOutcome({ error, reason }))).map(([, reason]) => reason)
  assert.deepEqual(purging, [], 'no socket refusal clears anything by itself')
  assert.deepEqual(server.filter(([error, reason]) => registrationOutcome({ error, reason }) === 'confirm').map(([, reason]) => reason).sort(),
    ['account-unavailable', 'credential-revoked', 'session-revoked', 'session-unconfirmed'], 'these ask startMorseDeviceSession')
  assert.equal(purgesAccountData('revoked'), true, 'the server\'s «session-revoked», reached through confirm')
  for (const outcome of ['renew', 'confirm', 'retry', 'update', 'unsupported', 'refused'] as const) assert.equal(purgesAccountData(outcome), false, outcome)
})

test('what this build has not heard of is tried again, never taken for a sign-out', () => {
  assert.equal(registrationOutcome({ error: 'UNAUTHORIZED', reason: 'something-new' }), 'retry')
  assert.equal(registrationOutcome({ error: 'SOMETHING_NEW' }), 'retry')
  assert.equal(registrationOutcome({}), 'retry')
  assert.equal(registrationOutcome(null), 'retry')
  assert.equal(registrationOutcome({ reason: 42 }), 'retry')
})

// The transport hands the account only what it gives up on, as one string (the reason, or the error when there is
// none); the account reads it back with the same rule, and must reach the same answer.
test('the account reads a refusal passed on to it the way the transport read it', () => {
  for (const [error, reason, outcome] of server) {
    if (outcome === 'renew' || outcome === 'retry' || outcome === 'confirm') continue
    const passed = reason || error
    assert.equal(registrationOutcome({ reason: passed, error: passed }), outcome, passed)
  }
  assert.equal(registrationOutcome({ reason: 'UPGRADE_REQUIRED', error: 'UPGRADE_REQUIRED' }), 'update', 'an error with no reason')
})

test('the account says why, by cause', () => {
  assert.equal(rejectionFailure('revoked'), 'revoked')
  assert.equal(rejectionFailure('update'), 'update-required')
  assert.equal(rejectionFailure('unsupported'), 'unavailable')
  assert.equal(rejectionFailure('refused'), 'protocol')
  // A refusal that is tried again should never reach the account; if it does, the account tries again too.
  assert.equal(rejectionFailure('retry'), 'network')
  assert.equal(rejectionFailure('confirm'), 'network')
})

// «연속 실패는 백오프»: one second doubling to thirty, with a fifth either way so many devices do not come back at once.
test('each try waits longer, up to half a minute', () => {
  const low = (): number => 0, high = (): number => 1
  const at = (attempt: number, random: () => number): number => Math.round(registrationDelay(attempt, random))
  assert.equal(at(1, low), 1600)
  assert.equal(at(1, high), 2400)
  assert.equal(at(3, low), 6400)
  assert.equal(at(5, high), 36000, 'the fifth doubling reaches the ceiling')
  assert.equal(at(50, low), 24000, 'never more than thirty seconds, less a fifth')
  assert.equal(at(50, high), 36000, 'never more than thirty seconds, plus a fifth')
  assert.equal(at(-3, low), 800, 'no negative exponent')
})

// 11_phase1-work §E-1: a token refresh that fails because the Keychain would not save the new token used to clear the
// account's local data too — the same kind of loss as F-RT-001, from this device's own trouble. Only a sign-in that
// is over (the refresh token refused, or revoked) signs the account out and clears it.
test('a token that could not be saved disconnects the account without clearing it', () => {
  const codes: AuthFailureCode[] = ['unavailable', 'update-required', 'app-proof', 'invalid-code', 'rate-limited', 'invalid-credential', 'revoked',
    'network', 'storage', 'protocol', 'cancelled', 'id-taken', 'account-limit', 'saved-account', 'already-added', 'device-limit', 'apple', 'stale-identity']
  const effects = Object.fromEntries(codes.map(code => [code, tokenFailureEffect(code)]))
  assert.equal(effects.storage, 'disconnect')
  assert.equal(effects['invalid-credential'], 'sign-out')
  assert.equal(effects.revoked, 'sign-out')
  assert.deepEqual(codes.filter(code => effects[code] === 'sign-out').sort(), ['invalid-credential', 'revoked'], 'nothing else clears what the account kept')
  assert.deepEqual(codes.filter(code => effects[code] === 'none').length, codes.length - 3, 'the rest leave the account as it is')
})
