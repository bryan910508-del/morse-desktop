import assert from 'node:assert/strict'
import { test } from 'node:test'
import { selectionActions, selectionMenuRows } from '../../src/shared/message-selection'
import type { ChatMessage } from '../../src/shared/model'

// B61 (Telegram history_inner_widget.cpp:3541-3551, 3732-3759): the menu on a chosen message — copy, forward, delete,
// clear — each row only when the selection bar would allow the same.
const text = (id: string, extra: Partial<ChatMessage> = {}) => ({ id, chatId: 'c', senderId: 'me', kind: 'text', text: `${id} 글`, position: { seconds: 1, nanoseconds: 0, id },
  serverConfirmed: true, readEligible: true, encrypted: false, system: false, version: '1:0', reactions: [], ...extra }) as unknown as ChatMessage

test('sent text messages: copy, forward, delete and clear, in Telegram\'s order', () => {
  assert.deepEqual(selectionMenuRows(selectionActions([text('a'), text('b')])), ['copy', 'forward', 'delete', 'clear'])
})

test('a row leaves when one chosen message does not allow it; clearing stays', () => {
  assert.deepEqual(selectionMenuRows(selectionActions([text('a'), text('b', { serverConfirmed: false })])), ['copy', 'delete', 'clear'], 'not forwardable until confirmed')
  assert.deepEqual(selectionMenuRows(selectionActions([text('a'), text('b', { version: '' })])), ['copy', 'clear'], 'one without a version can be neither forwarded nor deleted')
  assert.deepEqual(selectionMenuRows(selectionActions(Array.from({ length: 11 }, (_, n) => text(`m${n}`)))), ['copy', 'delete', 'clear'], 'over the forward limit of 10')
  assert.deepEqual(selectionMenuRows(selectionActions([text('e', { encrypted: true })])), ['delete', 'clear'], 'nothing to copy or forward')
  assert.deepEqual(selectionMenuRows(selectionActions([])), ['clear'])
})
