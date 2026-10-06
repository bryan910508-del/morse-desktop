import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ChatListTops } from '../../src/main/accounts/chat-list-tops'
import { messageListPreview } from '../../src/shared/chat-list-preview'
import type { ChatMessage, DialogSummary, MessagePosition } from '../../src/shared/model'

// B165, tdesktop Histories::deleteMessages (data_histories.cpp:1019-1030): the row's message deleted from this device
// leaves the row at once for the newest message left (History::requestChatListMessage, history.cpp:227-235), until the
// room document says what the server made of it (contract B163 §3-2: whatever it writes is taken as it comes).
const at = (seconds: number, id = 'chat1'): MessagePosition => ({ seconds, nanoseconds: 0, id })
const row = (preview: string, top: MessagePosition | null): DialogSummary => ({ id: 'chat1', preview, top } as unknown as DialogSummary)

test('B165: the row takes the newest message left at once, and keeps it through rebuilds the server has not answered', () => {
  const tops = new ChatListTops()
  tops.apply(row('B163-3', at(30)))
  assert.equal(tops.replace('chat1', { preview: 'B163-2', position: at(20, 'm2') }), true)
  const again = row('B163-3', at(30))
  tops.apply(again)
  assert.equal(again.preview, 'B163-2')
  assert.deepEqual(again.top, at(20), 'the row sorts by the message it now shows, under the chat’s own id')
  const unrelated = row('B163-3', at(30))
  tops.apply(unrelated)
  assert.equal(unrelated.preview, 'B163-2', 'a read mark or a typing change of the room does not end it')
})

test('B165: the room document written again is taken as it comes, and nothing is taken away twice', () => {
  const tops = new ChatListTops()
  tops.apply(row('B163-3', at(30)))
  tops.replace('chat1', { preview: 'B163-2', position: at(20, 'm2') })
  const server = row('B163-2', at(20))
  tops.apply(server)
  assert.equal(server.preview, 'B163-2')
  // Another message arrives after: the server's line, not this device's old guess.
  const newer = row('B163-5', at(40))
  tops.apply(newer)
  assert.equal(newer.preview, 'B163-5')
  assert.deepEqual(newer.top, at(40))
})

test('B165: a room left with no message shows no line and keeps its place', () => {
  const tops = new ChatListTops()
  tops.apply(row('only one', at(30)))
  tops.replace('chat1', null)
  const empty = row('only one', at(30))
  tops.apply(empty)
  assert.equal(empty.preview, '')
  assert.deepEqual(empty.top, at(30))
})

test('B165: a row the list has not read, or one that left the list, keeps nothing', () => {
  const tops = new ChatListTops()
  assert.equal(tops.replace('chat1', null), false)
  tops.apply(row('x', at(1)))
  tops.prune(() => false)
  assert.equal(tops.replace('chat1', null), false)
})

test('B165: the line for a message held here reads as the server’s line for that kind', () => {
  const message = (fields: Partial<ChatMessage>): ChatMessage => ({ kind: 'text', text: '', encrypted: false, system: false, ...fields } as ChatMessage)
  assert.equal(messageListPreview(message({ text: '안녕' })), '안녕')
  assert.equal(messageListPreview(message({ kind: 'image' })), '사진')
  assert.equal(messageListPreview(message({ kind: 'voice' })), '음성 메시지')
  assert.equal(messageListPreview(message({ kind: 'file', attachments: [{ index: 0, kind: 'file', name: 'plan.pdf', available: true, blind: false }] as ChatMessage['attachments'] })), 'plan.pdf')
  assert.equal(messageListPreview(message({ kind: 'file' })), '파일')
  assert.equal(messageListPreview(message({ kind: 'poll' as ChatMessage['kind'], poll: { question: '언제?' } as ChatMessage['poll'] })), '언제?')
  assert.equal(messageListPreview(message({ system: true, text: '자동 삭제를 껐습니다' })), '자동 삭제를 껐습니다')
})
