import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chatSendsOf, shownState } from '../../src/main/messaging/outbox'
import { deliveryFailed } from '../../src/shared/delivery'
import type { StoredIntent } from '../../src/main/storage/delivery-protocol'

// B280: a message on its way shows the same in its bubble and in its room's row of the chat list — the clock while it
// may still go by itself, the failed mark only when the person must send it again.
type Row = Pick<StoredIntent, 'chatId' | 'state' | 'reason' | 'createdAt'>
const row = (state: Row['state'], reason = '', createdAt = 1000): Row => ({ chatId: 'c', state, reason, createdAt })
const bubbleFailed = (item: Row) => deliveryFailed(shownState(item))
const listOf = (item: Row) => chatSendsOf([item]).get('c')!

test('the connection cut an upload off: clock in the bubble and in the list', () => {
  const item = row('upload-failed', 'upload-network')
  assert.equal(bubbleFailed(item), false)
  assert.deepEqual(listOf(item), { failed: false, newest: 1000 }, 'the row shows the clock, not the failed mark')
})

test('connected again and going up: clock in both', () => {
  const item = row('uploading')
  assert.equal(bubbleFailed(item), false)
  assert.deepEqual(listOf(item), { failed: false, newest: 1000 })
})

test('a real failure — the upload refused, or the send refused: failed in both', () => {
  for (const item of [row('upload-failed', 'upload-rejected'), row('failed', 'rejected')]) {
    assert.equal(bubbleFailed(item), true)
    assert.deepEqual(listOf(item), { failed: true, newest: 0 })
  }
})

test('every state: the list marks a room failed exactly when a bubble of it is', () => {
  const states: Row['state'][] = ['queued', 'uncertain', 'failed', 'uploading', 'upload-failed']
  for (const state of states) for (const reason of ['', 'upload-network', 'upload-rejected']) {
    const item = row(state, reason)
    assert.equal(listOf(item).failed, bubbleFailed(item), `${state} ${reason}`)
  }
})
