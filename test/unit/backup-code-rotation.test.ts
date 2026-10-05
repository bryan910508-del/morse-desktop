import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { BackupCodeRotations, proofFreshMs, rotationAnswer, rotationRecord, rotationRetryDelay, type ProviderProof, type Rotation, type RotationStore } from '../../src/main/auth/backup-code-rotation'
import { MorseCallableFailure } from '../../src/main/network/morse-callable'
import { linkedIdentities } from '../../src/main/api/account-tools'

// A3 contract §4 (common rules 1, 4 and 6): the new recovery code is kept with the old one the moment it is made, a
// change whose answer was lost goes again with the same two codes, `ok` (applied or not) makes the new code the
// account's, the server refusing the old code keeps the old, and a new change waits for one still on its way.
function store(kept: string | null = null) {
  const state = { pending: null as Rotation | null, kept, saves: 0 }
  const value: RotationStore = {
    read: async () => state.pending, save: async (_uid, rotation) => { state.pending = rotation; state.saves++ }, clear: async () => { state.pending = null },
    kept: async () => state.kept, keep: async (_uid, code) => { state.kept = code },
    forget: async (_uid, code) => { if (state.kept === code) state.kept = null }
  }
  return { state, value }
}
const lost = (): never => { throw new MorseCallableFailure('unknown', 'UNAVAILABLE') }
const refused = (): never => { throw new MorseCallableFailure('answered', 'PERMISSION_DENIED') }
const held = (): never => { throw new MorseCallableFailure('answered', 'PERMISSION_DENIED', 'session-revoked') }
const invalid = (): never => { throw new MorseCallableFailure('answered', 'INVALID_ARGUMENT') }
const opened: BackupCodeRotations[] = []
after(() => { for (const rotations of opened) rotations.close() })
function rotations(s: ReturnType<typeof store>, answers: (() => void)[], clock = { now: 1_000_000 }) {
  const sent: [string, string][] = [], proofs: ProviderProof[] = []
  let counter = 0
  const value = new BackupCodeRotations(s.value, () => async request => {
    if ('proof' in request) { proofs.push(request.proof); sent.push([`by-${request.proof.kind}`, request.next]) } else sent.push([request.old, request.next])
    ;(answers.shift() ?? (() => {}))()
  }, () => `NEW-${++counter}`, () => clock.now)
  opened.push(value)
  return { value, sent, proofs, clock }
}
const apple = (obtainedAt = 1_000_000): ProviderProof => ({ kind: 'apple', idToken: 'a.b.c', nonce: 'raw', obtainedAt })
const answered = (status: string, reason = '') => (): never => { throw new MorseCallableFailure('answered', status, reason) }
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

test('the wait before a change goes again is 2 s doubling to a minute', () => {
  assert.deepEqual([1, 2, 3, 5, 6, 9].map(rotationRetryDelay), [2000, 4000, 8000, 32000, 60000, 60000])
})

test('a change that is answered is the account\'s; the code this device keeps becomes the new one', async () => {
  const s = store('OLD-CODE'), r = rotations(s, [])
  assert.deepEqual(await r.value.change('u1', null), { backupCode: 'NEW-1', confirmed: true })
  assert.deepEqual(r.sent, [['OLD-CODE', 'NEW-1']])
  assert.equal(s.state.pending, null)
  assert.equal(s.state.kept, 'NEW-1')
})

test('a lost answer keeps both codes and goes again with the same two, until answered', async () => {
  const s = store(), r = rotations(s, [lost])
  assert.deepEqual(await r.value.change('u1', 'TYPED-OLD'), { backupCode: 'NEW-1', confirmed: false })
  assert.deepEqual(s.state.pending, { old: 'TYPED-OLD', next: 'NEW-1' }, 'kept on the device before it went')
  r.value.retryNow('u1'); await wait(20)
  assert.deepEqual(r.sent, [['TYPED-OLD', 'NEW-1'], ['TYPED-OLD', 'NEW-1']])
  assert.equal(s.state.pending, null)
})

test('the server refusing the old code drops the change; the kept code it refused leaves this device', async () => {
  const s = store('OLD-CODE'), r = rotations(s, [refused])
  await assert.rejects(r.value.change('u1', null), /현재 복구 코드를 확인해 주세요/)
  assert.equal(s.state.pending, null)
  assert.equal(s.state.kept, null, 'iOS forgetRefusedBackupCode: settings ask for the code next time')
  // A typed code that is refused leaves a different kept code alone.
  const s2 = store('KEPT-CODE'), r2 = rotations(s2, [refused])
  await assert.rejects(r2.value.change('u1', 'TYPED-OLD'), /현재 복구 코드를 확인해 주세요/)
  assert.equal(s2.state.kept, 'KEPT-CODE')
})

test('only permission-denied with no reason is a wrong code; a reason keeps the change for later', () => {
  assert.equal(rotationAnswer(new MorseCallableFailure('answered', 'PERMISSION_DENIED')), 'wrong-code')
  for (const reason of ['session-revoked', 'password-needed', 'account-banned']) {
    assert.equal(rotationAnswer(new MorseCallableFailure('answered', 'PERMISSION_DENIED', reason)), 'held', reason)
  }
  assert.equal(rotationAnswer(new MorseCallableFailure('answered', 'RESOURCE_EXHAUSTED', 'rate-limited')), 'rate-limited')
  assert.equal(rotationAnswer(new MorseCallableFailure('answered', 'RESOURCE_EXHAUSTED')), 'waiting')
  assert.equal(rotationAnswer(new MorseCallableFailure('answered', 'PERMISSION_DENIED', 'provider-proof-stale')), 'needs-proof')
  assert.equal(rotationAnswer(new MorseCallableFailure('answered', 'PERMISSION_DENIED', 'provider-not-linked')), 'identity-refused')
  assert.equal(rotationAnswer(new MorseCallableFailure('answered', 'INVALID_ARGUMENT')), 'refused')
  assert.equal(rotationAnswer(new MorseCallableFailure('unknown', 'UNAVAILABLE')), 'waiting')
  assert.equal(rotationAnswer(new MorseCallableFailure('not-sent', 'UNKNOWN')), 'waiting')
  assert.equal(rotationAnswer(new Error('offline')), 'waiting')
})

test('a refusal with a reason keeps both codes and the kept one, and goes when the account is back', async () => {
  const s = store('OLD-CODE'), r = rotations(s, [held])
  assert.deepEqual(await r.value.change('u1', null), { backupCode: 'NEW-1', confirmed: false })
  assert.deepEqual(s.state.pending, { old: 'OLD-CODE', next: 'NEW-1' })
  assert.equal(s.state.kept, 'OLD-CODE')
  await wait(2100)
  assert.equal(r.sent.length, 1, 'no timer: it waits for the account')
  r.value.retryNow('u1'); await wait(20)
  assert.deepEqual(r.sent, [['OLD-CODE', 'NEW-1'], ['OLD-CODE', 'NEW-1']])
  assert.equal(s.state.pending, null)
  assert.equal(s.state.kept, 'NEW-1')
})

test('another refusal drops the change and keeps every code', async () => {
  const s = store('OLD-CODE'), r = rotations(s, [invalid])
  await assert.rejects(r.value.change('u1', null), /다시 시도해 주세요/)
  assert.equal(s.state.pending, null)
  assert.equal(s.state.kept, 'OLD-CODE')
})

test('a change waiting with a refused old code is not made again from that code', async () => {
  const s = store('OLD-CODE'), r = rotations(s, [lost, refused])
  await r.value.change('u1', null)
  await assert.rejects(r.value.change('u1', null), /현재 복구 코드를 확인해 주세요/)
  assert.equal(r.sent.length, 2, 'the waiting change only; no second code from the refused one')
  assert.equal(s.state.kept, null)
})

test('a new change first finishes the one on its way, and starts from its new code', async () => {
  const s = store('OLD-CODE'), r = rotations(s, [lost])
  await r.value.change('u1', null)
  assert.deepEqual(await r.value.change('u1', null), { backupCode: 'NEW-2', confirmed: true })
  assert.deepEqual(r.sent, [['OLD-CODE', 'NEW-1'], ['OLD-CODE', 'NEW-1'], ['NEW-1', 'NEW-2']])
  assert.equal(s.state.kept, 'NEW-2')
  // Still not answered: the waiting code is shown again, and no other is made.
  const s2 = store('OLD-CODE'), r2 = rotations(s2, [lost, lost])
  await r2.value.change('u1', null)
  assert.deepEqual(await r2.value.change('u1', null), { backupCode: 'NEW-1', confirmed: false })
  assert.equal(s2.state.saves, 1, 'no second code while the first waits')
})

// A3 §9 (3-1d): no old code — the account's Apple or Google identity shown again stands for it.
test('with no code on this device, the identity makes the new code: kept first, sent with the identity, then kept as the code', async () => {
  const s = store(), r = rotations(s, [])
  assert.deepEqual(await r.value.changeByProvider('u1', apple()), { backupCode: 'NEW-1', confirmed: true })
  assert.deepEqual(r.sent, [['by-apple', 'NEW-1']])
  assert.equal(r.proofs[0]?.nonce, 'raw')
  assert.equal(s.state.saves, 1, 'kept on the device before it went')
  assert.equal(s.state.pending, null)
  assert.equal(s.state.kept, 'NEW-1', 'iOS storedCode: the code this device keeps from now on')
})

test('a lost answer goes again with the same code while the identity is under nine minutes old, then waits for the person', async () => {
  const s = store(), r = rotations(s, [lost, lost])
  assert.deepEqual(await r.value.changeByProvider('u1', apple()), { backupCode: 'NEW-1', confirmed: false })
  assert.deepEqual(s.state.pending, { old: null, next: 'NEW-1', byProvider: 'apple' })
  r.value.retryNow('u1'); await wait(20)
  assert.deepEqual(r.sent, [['by-apple', 'NEW-1'], ['by-apple', 'NEW-1']])
  r.clock.now += proofFreshMs
  assert.equal(await r.value.needsProof('u1'), true)
  r.value.retryNow('u1'); await wait(20)
  assert.equal(r.sent.length, 2, 'not sent past nine minutes')
  // Asked again by a typed code: the waiting one cannot go, so its code is shown with «confirm again».
  assert.deepEqual(await r.value.change('u1', 'TYPED-OLD'), { backupCode: 'NEW-1', confirmed: false, needsProof: true })
  // Confirmed again: the same code goes with the new identity.
  assert.deepEqual(await r.value.changeByProvider('u1', apple(r.clock.now)), { backupCode: 'NEW-1', confirmed: true })
  assert.deepEqual(r.sent.at(-1), ['by-apple', 'NEW-1'])
  assert.equal(s.state.kept, 'NEW-1')
  assert.equal(await r.value.needsProof('u1'), false)
})

test('a stale identity keeps the code for «confirm again»; another identity refuses and changes nothing', async () => {
  const s = store(), r = rotations(s, [answered('PERMISSION_DENIED', 'provider-proof-stale')])
  assert.deepEqual(await r.value.changeByProvider('u1', apple()), { backupCode: 'NEW-1', confirmed: false, needsProof: true })
  assert.deepEqual(s.state.pending, { old: null, next: 'NEW-1', byProvider: 'apple' })
  assert.equal(await r.value.needsProof('u1'), true, 'the refused identity is not sent again')
  for (const reason of ['provider-not-linked', 'provider-proof-invalid']) {
    const s2 = store('KEPT-CODE'), r2 = rotations(s2, [answered('PERMISSION_DENIED', reason)])
    await assert.rejects(r2.value.changeByProvider('u1', apple()), /연결된 Apple·Google 계정이 아니에요/)
    assert.equal(s2.state.pending, null, reason)
    assert.equal(s2.state.kept, 'KEPT-CODE', reason)
  }
})

test('a day\'s reissues used up drop the change', async () => {
  const s = store(), r = rotations(s, [answered('RESOURCE_EXHAUSTED', 'rate-limited')])
  await assert.rejects(r.value.changeByProvider('u1', apple()), /오늘은 더 만들 수 없어요/)
  assert.equal(s.state.pending, null)
  assert.equal(s.state.kept, null)
})

test('the screen locking drops the identity: a change waiting on it is asked for again', async () => {
  const s = store(), r = rotations(s, [lost])
  await r.value.changeByProvider('u1', apple())
  r.value.dropProofs()
  r.value.retryNow('u1'); await wait(20)
  assert.equal(r.sent.length, 1)
  assert.equal(await r.value.needsProof('u1'), true)
})

test('a change by identity first finishes a change by code still on its way, whose code is then the new one', async () => {
  const s = store('OLD-CODE'), r = rotations(s, [lost])
  await r.value.change('u1', null)
  assert.deepEqual(await r.value.changeByProvider('u1', apple()), { backupCode: 'NEW-1', confirmed: true })
  assert.deepEqual(r.sent, [['OLD-CODE', 'NEW-1'], ['OLD-CODE', 'NEW-1']], 'no reissue spent')
  assert.equal(s.state.kept, 'NEW-1')
})

test('the stored form: two codes, or a new code made by identity; anything else is no change', () => {
  assert.deepEqual(rotationRecord({ old: 'CODE-A', next: 'CODE-B' }), { old: 'CODE-A', next: 'CODE-B' })
  assert.deepEqual(rotationRecord({ old: null, next: 'CODE-B', byProvider: 'google' }), { old: null, next: 'CODE-B', byProvider: 'google' })
  for (const value of [null, 'x', { old: null, next: 'CODE-B' }, { old: 'CODE-A', next: 'CODE-B', byProvider: 'apple' }, { old: null, next: 'CODE-B', byProvider: 'facebook' },
    { old: 'CODE-A', next: 'bad code' }, { old: 'CODE-A' }]) assert.equal(rotationRecord(value), null, JSON.stringify(value))
})

test('the linked identities a code can be made with are read from the ID token\'s firebase.identities', () => {
  const token = (claims: unknown) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`
  assert.deepEqual(linkedIdentities(token({ firebase: { identities: { 'apple.com': ['x'], 'google.com': ['y'], email: ['z'] } } })), ['apple', 'google'])
  assert.deepEqual(linkedIdentities(token({ firebase: { identities: { 'google.com': ['y'] } } })), ['google'])
  assert.deepEqual(linkedIdentities(token({ firebase: { identities: {}, sign_in_provider: 'custom' } })), [])
  for (const value of [token({}), token({ firebase: { identities: ['apple.com'] } }), 'not-a-token', '']) assert.deepEqual(linkedIdentities(value), [], value)
})
