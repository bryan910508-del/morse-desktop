import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nextIntent, resumableIntent, shownState, waitingUpload } from '../../src/main/messaging/outbox'
import type { StoredIntent } from '../../src/main/storage/delivery-protocol'

// B40 (2026-10-02, Telegram R-54): a room's messages go in the order they were written. A message waits while an
// earlier one of its room is still on its way, and goes once that one is through or has definitely failed.
const row = (sequence: number, chatId: string, state: StoredIntent['state'], reason = ''): StoredIntent =>
  ({ id: `m${sequence}`, sequence, chatId, text: `m${sequence}`, createdAt: sequence, state, reason, wire: { type: 'text' } } as unknown as StoredIntent)
const ids = (rows: StoredIntent[]) => rows.map(item => item.id)

test('a later message of the same room waits for an earlier one whose answer is not known yet', () => {
  const now = 1000, retry = new Map<string, number>()
  const pick = (rows: StoredIntent[]) => nextIntent(rows, now, id => retry.get(id) ?? 0, () => true)
  // M1 went, its acknowledgement timed out: «uncertain», waiting out a retry. M2 was written after it.
  retry.set('m1', now + 4000)
  let rows = [row(1, 'a', 'uncertain', 'ack-pending'), row(2, 'a', 'queued')]
  // What the queue picked before: the first message that may go now — M2, ahead of M1.
  const before = rows.filter(resumableIntent).find(item => (retry.get(item.id) ?? 0) <= now)
  assert.equal(before?.id, 'm2', 'the old choice overtook M1')
  assert.equal(pick(rows).intent, null, 'now M2 waits')
  assert.deepEqual(ids(pick(rows).candidates), ['m1'], 'and the queue wakes for M1')
  // The look-up says the server does not have M1: it goes again as queued, still after its wait.
  rows = [row(1, 'a', 'queued'), row(2, 'a', 'queued')]
  assert.equal(pick(rows).intent, null)
  retry.set('m1', now - 1)
  assert.equal(pick(rows).intent?.id, 'm1', 'M1 goes again first')
  // M1 acknowledged: it leaves the queue, and M2 goes.
  rows = [row(2, 'a', 'queued')]
  assert.equal(pick(rows).intent?.id, 'm2')
})

test('an upload on its way holds the room too, a definite failure does not, and other rooms never wait', () => {
  const pick = (rows: StoredIntent[]) => nextIntent(rows, 0, () => 0, () => true).intent?.id ?? null
  assert.equal(pick([row(1, 'a', 'uploading'), row(2, 'a', 'queued')]), 'm1')
  assert.equal(pick([row(1, 'a', 'upload-failed', 'upload-network'), row(2, 'a', 'queued')]), 'm1', 'a cut-off upload resumes first')
  assert.equal(pick([row(1, 'a', 'failed', 'BLOCKED'), row(2, 'a', 'queued')]), 'm2', 'a refused message stands alone')
  assert.equal(pick([row(1, 'a', 'upload-failed', 'upload-expired'), row(2, 'a', 'queued')]), 'm2')
  // Room a waits on M1; room b's message goes meanwhile.
  assert.equal(nextIntent([row(1, 'a', 'uncertain'), row(2, 'a', 'queued'), row(3, 'b', 'queued')], 0, id => id === 'm1' ? 5000 : 0, () => true).intent?.id, 'm3')
})

test('a message the room may not take yet still holds back the ones after it', () => {
  // A discussion room waiting for its compose policy: nothing of it goes, in order, and other rooms go on.
  const allowed = (item: StoredIntent) => item.chatId !== 'held'
  assert.equal(nextIntent([row(1, 'held', 'queued'), row(2, 'held', 'queued'), row(3, 'b', 'queued')], 0, () => 0, allowed).intent?.id, 'm3')
})

// B40: «not known yet» is the clock, not the red mark (Telegram R-52: failed only on the server's refusal).
test('an upload the connection cut off shows the clock and is not offered as failed', () => {
  assert.equal(shownState({ state: 'upload-failed', reason: 'upload-network' }), 'uploading')
  assert.equal(waitingUpload({ state: 'upload-failed', reason: 'upload-network' }), true)
  for (const reason of ['upload-permission', 'upload-conflict', 'upload-expired', 'upload-metadata'])
    assert.equal(shownState({ state: 'upload-failed', reason }), 'upload-failed', `${reason} still waits for the person`)
  assert.equal(shownState({ state: 'uncertain', reason: 'ack-pending' }), 'uncertain')
})
