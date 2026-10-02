import assert from 'node:assert/strict'
import { test } from 'node:test'
import { connectionDetail } from '../../src/main/platform/connection-diagnostics'
import { registrationOutcome, registrationWords } from '../../src/main/network/registration-outcome'

// A5 joint device check (2026-10-01): the socket's refusal reason `session-unconfirmed` was written as `*`, because
// anything of 16 characters or more is hidden as a possible token. The server's own words stay; anything else long
// enough to be a token is still hidden.
test('a socket refusal reason the server is known to send is written whole', () => {
  assert.equal(connectionDetail('UNAUTHORIZED:session-unconfirmed'), 'UNAUTHORIZED:session-unconfirmed')
  assert.equal(connectionDetail('session-unconfirmed:confirmed'), 'session-unconfirmed:confirmed')
  assert.equal(connectionDetail('UNAUTHORIZED:account-unavailable:renewing'), 'UNAUTHORIZED:account-unavailable:renewing')
  assert.equal(connectionDetail('SERVICE_UNAVAILABLE:authorization-monitor-failed'), 'SERVICE_UNAVAILABLE:authorization-monitor-failed')
  for (const reason of ['session-revoked', 'credential-revoked', 'account-unavailable', 'session-unconfirmed', 'token-expired', 'token-account-mismatch',
    'client-protocol-too-old', 'server-protocol-too-old', 'malformed-registration', 'session-required'])
    assert.ok(registrationWords.has(reason), `${reason} is a word registrationOutcome reads`)
  assert.equal(registrationOutcome({ error: 'UNAUTHORIZED', reason: 'session-unconfirmed' }), 'confirm')
})

test('a token, an id or an unknown long word is still hidden', () => {
  assert.equal(connectionDetail('UNAUTHORIZED:eyJhbGciOiJSUzI1NiIsImtpZCI6Ij'), 'UNAUTHORIZED:*')
  assert.equal(connectionDetail('RAk6jfkPEXhydeuUxG9U36UQP9m1'), '*', 'an account id')
  assert.equal(connectionDetail('UNAUTHORIZED:session-unconfirmed-RAk6jfkPEX'), 'UNAUTHORIZED:*', 'a known word with more joined to it is not known')
  assert.equal(connectionDetail('UNAUTHORIZED:some-new-server-reason'), 'UNAUTHORIZED:*', 'a reason a later server adds stays hidden')
  assert.equal(connectionDetail('transport close'), 'transport close', 'short words were never hidden')
})
