import assert from 'node:assert/strict'
import { test } from 'node:test'
import { outboxReadTill, readCovers } from '../../src/shared/read-receipts'

// History::outboxReadTillId / isServerSideUnread: one boundary per room, where the furthest reader has come.
test('what I sent is read once anyone else has read it, and my own position does not count', () => {
  const positions = { me: { at: 9_000, id: 'M9' }, a: { at: 3_000, id: 'A3' }, b: { at: 5_000, id: 'B5' } }
  const till = outboxReadTill(positions, ['a', 'b', 'c'])
  assert.deepEqual(till, { at: 5_000, id: 'B5' })
  assert.equal(readCovers(till, { at: 4_000, id: 'X' }), true, 'one reader is enough in a group')
  assert.equal(readCovers(till, { at: 6_000, id: 'Y' }), false)
  assert.equal(outboxReadTill(positions, []), null, 'a room with nobody else (the memo space) has nothing read')
  assert.equal(outboxReadTill({ me: { at: 9_000, id: 'M9' } }, ['a']), null)
  // The same moment: the later message id has come further.
  assert.deepEqual(outboxReadTill({ a: { at: 5_000, id: 'A' }, b: { at: 5_000, id: 'B' } }, ['a', 'b']), { at: 5_000, id: 'B' })
})
