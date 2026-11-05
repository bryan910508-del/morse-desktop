import assert from 'node:assert/strict'
import { test } from 'node:test'
import { markArrived } from '../../src/renderer/src/window/chat-marked'
import { clearsUnreadMark } from '../../src/shared/manual-unread'

// Telegram HistoryWidget::unreadCountUpdated (history_widget.cpp:4747-4753): a chat on screen that gets «안 읽음 표시»
// closes and keeps the mark. The mark it was opened with is the one opening clears (:3613-3617), so it does not close it.
const ready = { listReady: true, marked: true }

test('a mark that arrives while the chat is open, after it was seen without one, closes the chat', () => {
  assert.equal(markArrived(false, ready), true)
})

test('the mark the chat was opened with, a list not ready, or no mark close nothing', () => {
  assert.equal(markArrived(true, ready), false, 'opened marked: the opening clears it, the chat stays')
  assert.equal(markArrived(null, ready), false, 'not seen yet in the list: wait for it')
  assert.equal(markArrived(false, { ...ready, listReady: false }), false, 'reloading, reconnecting or behind the passcode lock')
  assert.equal(markArrived(false, { ...ready, marked: false }), false)
})

test('a mark means nothing on a secret chat or the memo space, as opening does not clear it there', () => {
  assert.equal(clearsUnreadMark({ id: 'c1', kind: 'direct', markedUnread: true }, 'me'), true)
  assert.equal(clearsUnreadMark({ id: 's1', kind: 'secret', markedUnread: true }, 'me'), false)
  assert.equal(clearsUnreadMark({ id: 'memo_me', kind: 'direct', markedUnread: true }, 'me'), false)
})
