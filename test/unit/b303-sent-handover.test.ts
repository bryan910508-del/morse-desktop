import assert from 'node:assert/strict'
import { test } from 'node:test'
import { keepsSent, shownSince } from '../../src/main/messaging/outbox'
import { historyEntries } from '../../src/renderer/src/history/history-entries'
import type { LocalOutgoing } from '../../src/shared/delivery'
import type { ChatMessage } from '../../src/shared/model'

// B303 (tdesktop api_updates.cpp:1704-1711 — one message is one item, whichever of the answer and the message comes
// first): a sent message is kept as a «sent» item only while the open history does not show it yet.
const row = { chatId: 'chat1', id: 'm1' }
test('the answer before the history: the sent item is kept until the history shows it', () => {
  assert.equal(keepsSent(null, row), true)
  assert.equal(keepsSent({ chatId: 'chat1', ids: new Set(['m0']) }, row), true)
})
test('the history before the answer: the message is already shown, so nothing is kept', () => {
  assert.equal(keepsSent({ chatId: 'chat1', ids: new Set(['m0', 'm1']) }, row), false)
})
test('another chat\'s history showing the same id keeps it; another id in this chat keeps it', () => {
  assert.equal(keepsSent({ chatId: 'chat2', ids: new Set(['m1']) }, row), true)
  assert.equal(keepsSent({ chatId: 'chat1', ids: new Set(['m2']) }, { chatId: 'chat1', id: 'm3' }), true)
})
test('a sticker deleted right after it was sent does not come back as the sent item', () => {
  const message = { id: 'm1', chatId: 'chat1', senderId: 'me', position: { seconds: 1, nanoseconds: 0, id: 'm1' } } as unknown as ChatMessage
  const sent = { id: 'm1', chatId: 'chat1', sequence: 1, createdAt: 1000, state: 'sent' } as unknown as LocalOutgoing
  const shown = { chatId: 'chat1', ids: new Set(['m1']) }
  const kept = keepsSent(shown, row) ? [sent] : []
  const entries = (messages: ChatMessage[]) => historyEntries(messages, kept, raw => ({ kind: 'message', key: raw.id, message: raw, own: true, time: 1 }))
  assert.deepEqual(entries([message]).map(entry => entry.kind), ['message'])
  // Deleted for everyone (the copy is gone) or hidden for me (the history leaves it out): nothing is drawn in its place.
  assert.deepEqual(entries([]), [])
  // Before B303 the item was kept, and the deletion drew it again.
  assert.deepEqual(historyEntries([], [sent], () => null).map(entry => entry.kind), ['local'])
})

// B303b (user: «보낸지 얼마 안된글 몇초만에 지우면 다시 생긴다»): sent → the history shows it → deleted, the snapshot
// without it comes → the server's answer comes late. Only the last snapshot's ids were kept, so the answer kept it.
test('shown, then deleted before the answer came: the late answer keeps nothing', () => {
  let shown = shownSince(null, 'chat1', ['m0', 'm1'])
  shown = shownSince(shown, 'chat1', ['m0'])
  assert.equal(keepsSent(shown, row), false)
  assert.equal(keepsSent(shownSince(shown, 'chat2', ['x']), row), true, 'another chat starts afresh')
})
