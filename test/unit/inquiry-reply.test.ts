import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { attachInquiryReplies, decodeInquiryMessage } from '../../src/main/accounts/channel-inquiries'
import { inquiryChatMessage, inquirySendRequest, type InquiryMessageItem } from '../../src/shared/channel-inquiries'
import { documents, type FirestoreDocument, type WireObject } from '../../src/main/network/firestore-values'

// HistoryMessageReply: a message says which message it answers (replyToId), and the bubble quotes that message with
// its sender and a few of its words. A room holds its latest messages, so the original is looked for among them.
const at = (ms: number): WireObject => ({ timestampValue: { seconds: String(Math.floor(ms / 1000)), nanos: 0 } })
const inquiry = { id: 'inq1', cutoff: null }
const message = (id: string, fields: Record<string, WireObject>): FirestoreDocument => ({
  name: `${documents}/channelInquiries/inq1/messages/${id}`, updateTime: { seconds: '7', nanos: 0 },
  fields: { createdAt: at(Date.now() - 60_000), type: { stringValue: 'text' }, senderType: { stringValue: 'subscriber' }, ...fields }
} as unknown as FirestoreDocument)
const item = (value: Partial<InquiryMessageItem>): InquiryMessageItem => ({
  id: 'm1', own: false, senderType: 'subscriber', kind: 'text', text: '안녕하세요', label: '', createdAt: 1, edited: false, version: '1:0', ...value
})

test('a message says which message of the room it answers', () => {
  const answer = decodeInquiryMessage(message('m2', { text: { stringValue: '네 맞아요' }, senderId: { stringValue: 'peer1' }, replyToId: { stringValue: 'm1' } }), inquiry, 'me1')
  assert.equal(answer?.replyToId, 'm1')
  const plain = decodeInquiryMessage(message('m3', { text: { stringValue: '안녕하세요' }, senderId: { stringValue: 'peer1' } }), inquiry, 'me1')
  assert.equal(plain?.replyToId, undefined)
  const itself = decodeInquiryMessage(message('m4', { text: { stringValue: '안녕' }, senderId: { stringValue: 'peer1' }, replyToId: { stringValue: 'm4' } }), inquiry, 'me1')
  assert.equal(itself?.replyToId, undefined, 'a message never answers itself')
})

test('the quote names the sender and carries the words, and says when the original is gone', () => {
  const rows = [item({ id: 'm1', text: '문의드립니다' }), item({ id: 'm2', own: true, text: '네 말씀하세요', replyToId: 'm1' }),
    item({ id: 'm3', replyToId: 'gone' }), item({ id: 'm4', text: '사진', kind: 'image', label: '사진' }),
    item({ id: 'm5', own: true, replyToId: 'm4' }), item({ id: 'm6', system: true, text: '자동 삭제를 켰어요' }), item({ id: 'm7', replyToId: 'm6' })]
  const withReplies = attachInquiryReplies(rows, '민지')
  assert.deepEqual(withReplies[1]!.reply, { state: 'ready', senderName: '민지', kind: 'text', text: '문의드립니다' })
  assert.deepEqual(withReplies[2]!.reply, { state: 'unavailable' }, 'an original no longer in the room says so')
  assert.deepEqual(withReplies[4]!.reply, { state: 'ready', senderName: '민지', kind: 'image', text: '사진' })
  assert.deepEqual(withReplies[6]!.reply, { state: 'unavailable' }, 'a notice line is never quoted')
  assert.equal(withReplies[0]!.reply, undefined, 'a message that answers nothing carries no quote')
  const mine = attachInquiryReplies([item({ id: 'm1', own: true, text: '보냈습니다' }), item({ id: 'm2', replyToId: 'm1' })], '민지')
  assert.equal((mine[1]!.reply as { senderName: string }).senderName, '나')
  const untouched = [item({ id: 'm1' })]
  assert.equal(attachInquiryReplies(untouched, '민지'), untouched, 'a room with no answers is left as it is')
})

test('the bubble receives the quote, and a send may name what it answers', () => {
  const quoted = inquiryChatMessage(item({ id: 'm2', replyToId: 'm1', reply: { state: 'ready', senderName: '민지', kind: 'text', text: '문의드립니다' } }), 'inq1')
  assert.equal(quoted.replyToId, 'm1')
  assert.deepEqual(quoted.reply, { state: 'ready', senderName: '민지', kind: 'text', text: '문의드립니다' })
  assert.equal(inquiryChatMessage(item({ id: 'm1' }), 'inq1').reply, undefined)
  const requestId = randomUUID(), messageId = randomUUID().toUpperCase()
  assert.deepEqual(inquirySendRequest({ requestId, inquiryId: 'ch1_sub1', messageId, text: '네', replyToId: 'm1' }),
    { requestId, inquiryId: 'ch1_sub1', messageId, text: '네', replyToId: 'm1' })
  assert.equal(inquirySendRequest({ requestId, inquiryId: 'ch1_sub1', messageId, text: '네' }).replyToId, undefined)
  assert.throws(() => inquirySendRequest({ requestId, inquiryId: 'ch1_sub1', messageId, text: '네', replyToId: 'bad/id' }))
  assert.throws(() => inquirySendRequest({ requestId, inquiryId: 'ch1_sub1', messageId, text: '네', reply: 'm1' }))
})
