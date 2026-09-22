import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ExpiredMessages, expiredCandidates, nextExpiry } from '../../src/main/accounts/expired-messages'
import { documents, type FirestoreDocument, type WireObject } from '../../src/main/network/firestore-values'

// Data::Session::checkTTLs(): a message leaves the history at its moment, and in Telegram it is gone for everyone
// because the server removed it. Here the server only stamps deleteAt, so the open room removes it for both sides —
// and only what the server stamped, never a message written before the policy was set.
const at = (ms: number): WireObject => ({ timestampValue: { seconds: String(Math.floor(ms / 1000)), nanos: (ms % 1000) * 1_000_000 } })
const now = 1_800_000_000_000
const message = (id: string, fields: Record<string, WireObject>): FirestoreDocument => ({
  name: `${documents}/chats/chat1/messages/${id}`, updateTime: { seconds: '5', nanos: 0 },
  fields: { createdAt: at(now - 3_600_000), senderId: { stringValue: 'peer1' }, type: { stringValue: 'text' }, text: { stringValue: '안녕하세요' }, ...fields }
} as unknown as FirestoreDocument)

test('only a message the server stamped, and whose moment has passed, is taken away', () => {
  const docs = [
    message('m1', { deleteAt: at(now - 1000) }),
    message('m2', { deleteAt: at(now + 60_000) }),
    message('m3', {}),
    message('m4', { deleteAt: at(now - 5000), isSystem: { booleanValue: true }, text: { stringValue: '민지님이 자동 삭제를 켰어요.' } }),
    message('m5', { deleteAt: at(now - 2000), senderId: { stringValue: '' } })
  ]
  assert.deepEqual(expiredCandidates(docs, now).map(entry => entry.id), ['m1'], 'a future stamp, no stamp, a notice line and a message with no sender all stay')
  assert.equal(nextExpiry(docs, now), now + 60_000, 'the room comes back when the next one expires')
  assert.equal(nextExpiry([message('m6', {})], now), null)
  const many = Array.from({ length: 40 }, (_, index) => message(`x${index}`, { deleteAt: at(now - 40_000 + index) }))
  assert.equal(expiredCandidates(many, now).length, 25, 'one pass never takes away more than a roomful')
  assert.deepEqual(expiredCandidates(many, now).map(entry => entry.id).slice(0, 2), ['x0', 'x1'], 'the one that expired first goes first')
})

test('each expired message is taken away once, and only where it may be', async () => {
  const removed: string[] = []
  const expired = new ExpiredMessages(async entry => { removed.push(entry.id) }, entry => entry.senderId === 'peer1', () => now)
  const docs = [message('m1', { deleteAt: at(now - 1000) }), message('m2', { deleteAt: at(now - 500), senderId: { stringValue: 'other' } })]
  expired.sweep(docs)
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(removed, ['m1'], 'a group takes away only what this account may take')
  expired.sweep(docs)
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(removed, ['m1'], 'and never twice in one run')
})

test('a removal that fails is left to the other side, and a closed room takes nothing', async () => {
  const tried: string[] = []
  const expired = new ExpiredMessages(async entry => { tried.push(entry.id); throw new Error('offline') }, () => true, () => now)
  expired.sweep([message('m1', { deleteAt: at(now - 1000) })])
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(tried, ['m1'])
  expired.close()
  expired.sweep([message('m2', { deleteAt: at(now - 1000) })])
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(tried, ['m1'], 'nothing is removed after the room is gone')
})
