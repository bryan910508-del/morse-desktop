import assert from 'node:assert/strict'
import { test } from 'node:test'
import { forwardRequest, savedMessagesFirst, type ForwardTarget } from '../../src/shared/forward'
import { forwardBatchRequest } from '../../src/shared/forward-batch'

// Saved Messages is where a message from a conversation is kept, and Telegram offers it first of all:
// ChatsListBoxController::rebuildRows adds `history(session().user())` before the chats and then
// partitions the rows by isSelf(). Morse refused it — in three places, each writing the same rule
// again: the list of targets, the single-message request and the batch. Fixing one left the others.
const me = 'memo_uid-1', source = { chatId: 'chat-a', messageId: 'm1', version: '1:0' }

test('a message can be forwarded to Saved Messages', () => {
  const request = forwardRequest({ id: 'f1', source, targets: [{ chatId: me, messageId: 'n1' }] })
  assert.deepEqual(request.targets, [{ chatId: me, messageId: 'n1' }])
})

test('several messages can be forwarded to Saved Messages at once', () => {
  const request = forwardBatchRequest({ id: 'f2', sources: [source, { ...source, messageId: 'm2' }],
    targets: [{ chatId: me, messageIds: ['n1', 'n2'] }] })
  assert.deepEqual(request.targets, [{ chatId: me, messageIds: ['n1', 'n2'] }])
})

test('the room a message is already in is still refused, in both shapes', () => {
  assert.throws(() => forwardRequest({ id: 'f3', source, targets: [{ chatId: source.chatId, messageId: 'n1' }] }), /전달할 다른 대화/)
  assert.throws(() => forwardBatchRequest({ id: 'f4', sources: [source], targets: [{ chatId: source.chatId, messageIds: ['n1'] }] }), /전달 대상과 메시지 수/)
})

test('a target named twice is still refused', () => {
  assert.throws(() => forwardRequest({ id: 'f5', source, targets: [{ chatId: me, messageId: 'n1' }, { chatId: me, messageId: 'n2' }] }), /전달할 다른 대화/)
})

// Telegram's forward list always holds Saved Messages, because it is the account's own peer and needs
// no room to exist. Morse keeps it in a room the server makes on first use, so an account that had
// never opened it was offered no Saved Messages at all.
const room = (chatId: string, title: string): ForwardTarget => ({ chatId, title, kind: 'direct', preview: '' })
const chats = [room('chat-b', '상대'), room('chat-c', '동료')]

test('Saved Messages leads the list, above every chat', () => {
  const offered = room(me, '저장한 메시지')
  const list = savedMessagesFirst([...chats, offered], me, 'chat-a', offered, true)
  assert.deepEqual(list.map(target => target.chatId), [me, 'chat-b', 'chat-c'])
})

test('it is offered before its room exists, and the window makes the room before sending', () => {
  const list = savedMessagesFirst(chats, me, 'chat-a', null, false)
  assert.equal(list[0]!.chatId, me)
  assert.equal(list[0]!.title, '저장한 메시지')
  assert.equal(list.length, 3)
})

test('a message already in Saved Messages is not offered its own room', () => {
  assert.deepEqual(savedMessagesFirst(chats, me, me, null, false).map(target => target.chatId), ['chat-b', 'chat-c'])
  assert.deepEqual(savedMessagesFirst(chats, me, me, null, true).map(target => target.chatId), ['chat-b', 'chat-c'])
})

test('a room that exists but refused the message is not replaced by an invented one', () => {
  assert.deepEqual(savedMessagesFirst(chats, me, 'chat-a', null, true).map(target => target.chatId), ['chat-b', 'chat-c'])
})
