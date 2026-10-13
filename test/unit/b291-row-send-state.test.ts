import assert from 'node:assert/strict'
import { test } from 'node:test'
import { rowSendState, type RowSendFacts } from '../../src/shared/row-send-state'
import { decodeDialog, type FirestoreDocument } from '../../src/main/network/firestore-values'
import { ChatListTops, expiredTop } from '../../src/main/accounts/chat-list-tops'
import type { DialogSummary, MessagePosition } from '../../src/shared/model'

// B340 (user decision 10-13): the row's place left of the date keeps only a message of mine still on its way or failed —
// draft > on its way > failed; the sent check and the read circle B291 drew there are gone (the bubbles keep them). The
// room document still says whose the line is (topFromMe, lastMessageId) — B327's «나에게만» uses its message id.
const at = (seconds: number, id: string): MessagePosition => ({ seconds, nanoseconds: 0, id })
const base: RowSendFacts = { secret: false, draft: false }

test('the place shows a message on its way or one that did not go, and nothing for one sent or read', () => {
  assert.equal(rowSendState(base), 'none', 'sent or read: nothing on the row')
  assert.equal(rowSendState({ ...base, failed: true }), 'failed')
  assert.equal(rowSendState({ ...base, failed: true, sending: true }), 'sending')
  assert.equal(rowSendState({ ...base, sending: true, draft: true }), 'none', 'a draft stands in for the line')
  assert.equal(rowSendState({ ...base, secret: true, sending: true }), 'none')
})

const root = 'projects/talky-a38c3/databases/(default)/documents/chats'
const members = (...uids: string[]) => ({ arrayValue: { values: uids.map(uid => ({ stringValue: uid })) } })
const chat = (fields: Record<string, unknown>, type = 'direct'): FirestoreDocument => ({ name: `${root}/c1`, updateTime: { seconds: '1', nanos: 0 }, createTime: { seconds: '1', nanos: 0 },
  fields: { type: { stringValue: type }, participantUids: members('me', 'peer'), lastMessage: { stringValue: '안녕' }, lastMessageAt: { timestampValue: { seconds: '1791700000', nanos: 0 } }, ...fields } } as unknown as FirestoreDocument)
test('the room document: lastSenderId mine, unless the line is a channel post\'s mirror; lastMessageId names the message', () => {
  const mine = decodeDialog(chat({ lastSenderId: { stringValue: 'me' }, lastMessageId: { stringValue: 'm9' } }), 'me').summary
  assert.equal(mine.topFromMe, true); assert.equal(mine.topMessageId, 'm9')
  assert.equal(decodeDialog(chat({ lastSenderId: { stringValue: 'peer' } }), 'me').summary.topFromMe, undefined)
  assert.equal(decodeDialog(chat({ lastSenderId: { stringValue: 'me' }, lastSenderType: { stringValue: 'channel_post' } }, 'group'), 'me').summary.topFromMe, undefined)
  assert.equal(decodeDialog(chat({}), 'me').summary.topFromMe, undefined, 'a line from before the server kept its sender')
})

test('a row whose message this device took away, or that expired, says whose the line it now shows is', () => {
  const tops = new ChatListTops()
  const summary = { id: 'c1', preview: '내 글', top: at(100, 'c1'), topFromMe: true, topMessageId: 'm9' } as unknown as DialogSummary
  tops.apply(summary)
  assert.equal(tops.replace('c1', { preview: '상대 글', position: at(90, 'm8'), fromMe: false, messageId: 'm8' }), true)
  const again = { id: 'c1', preview: '내 글', top: at(100, 'c1'), topFromMe: true, topMessageId: 'm9' } as unknown as DialogSummary
  assert.equal(tops.apply(again), true)
  assert.equal(again.topFromMe, undefined); assert.equal(again.topMessageId, 'm8')
  const expiring = { id: 'c1', preview: '사라질 글', top: at(100, 'c1') } as unknown as DialogSummary
  const open = { messages: [{ position: at(90, 'm7'), text: '앞 글' }], newerAvailable: false, ready: true, preview: () => '앞 글', mine: () => true }
  assert.equal(expiredTop(expiring, 1, 2, open), true)
  assert.equal(expiring.topFromMe, true); assert.equal(expiring.topMessageId, 'm7')
})
