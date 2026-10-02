import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { BackupCodeRotations, rotationRetryDelay, type RotationStore } from '../../src/main/auth/backup-code-rotation'
import { MorseCallableFailure } from '../../src/main/network/morse-callable'

// A3 contract §4 (common rules 1, 4 and 6): the new recovery code is kept with the old one the moment it is made, a
// change whose answer was lost goes again with the same two codes, `ok` (applied or not) makes the new code the
// account's, the server refusing the old code keeps the old, and a new change waits for one still on its way.
function store(kept: string | null = null) {
  const state = { pending: null as { old: string; next: string } | null, kept, saves: 0 }
  const value: RotationStore = {
    read: async () => state.pending, save: async (_uid, rotation) => { state.pending = rotation; state.saves++ }, clear: async () => { state.pending = null },
    kept: async () => state.kept, keep: async (_uid, code) => { state.kept = code }
  }
  return { state, value }
}
const lost = (): never => { throw new MorseCallableFailure('unknown', 'UNAVAILABLE') }
const refused = (): never => { throw new MorseCallableFailure('answered', 'PERMISSION_DENIED') }
const opened: BackupCodeRotations[] = []
after(() => { for (const rotations of opened) rotations.close() })
function rotations(s: ReturnType<typeof store>, answers: (() => void)[]) {
  const sent: [string, string][] = []
  let counter = 0
  const value = new BackupCodeRotations(s.value, () => async (old, next) => { sent.push([old, next]); (answers.shift() ?? (() => {}))() }, () => `NEW-${++counter}`)
  opened.push(value)
  return { value, sent }
}
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

test('the server refusing the old code drops the change and keeps the old', async () => {
  const s = store('OLD-CODE'), r = rotations(s, [refused])
  await assert.rejects(r.value.change('u1', null), /바꾸지 못했습니다/)
  assert.equal(s.state.pending, null)
  assert.equal(s.state.kept, 'OLD-CODE')
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
