import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { inquiryQueueChatId, inquiryScheduleRequest } from '../../src/shared/channel-inquiries'
import { inquiryQueueFields } from '../../src/main/accounts/channel-inquiries'

// «예약 전송» in an inquiry room. firestore.rules scheduledMessages: a queue document that names an inquiry must
// carry chatId == 'sub_inq_' + inquiryId and come from a participant of that room; the worker
// (talky-scheduled-online-messages) then sends it into the room through the same canonicalMessage a chat uses.
const requestId = randomUUID(), inquiryId = 'ch1_sub1'
const messageId = randomUUID().toUpperCase()

test('a scheduled inquiry message names one room, one message and one time', () => {
  const at = Date.now() + 60_000
  assert.deepEqual(inquiryScheduleRequest({ requestId, inquiryId, messageId, text: '안녕하세요', scheduledAt: at }),
    { requestId, inquiryId, messageId, text: '안녕하세요', scheduledAt: at })
  assert.throws(() => inquiryScheduleRequest({ requestId, inquiryId, messageId, text: '안녕하세요', scheduledAt: 1.5 }), /예약 시간/)
  assert.throws(() => inquiryScheduleRequest({ requestId, inquiryId, messageId, text: '안녕하세요' }), /예약 시간/)
  assert.throws(() => inquiryScheduleRequest({ requestId, inquiryId, messageId, text: '   ', scheduledAt: at }))
  assert.throws(() => inquiryScheduleRequest({ requestId, inquiryId, messageId: 'not-a-uuid', text: '안녕하세요', scheduledAt: at }))
  assert.throws(() => inquiryScheduleRequest({ requestId, inquiryId, messageId, text: '안녕하세요', scheduledAt: at, kind: 'online' }), 'an inquiry has no «온라인시 보내기»')
})

test('the queue document carries the room the rules ask for, and the time as Firestore writes it', () => {
  const at = 1_800_000_000_123
  const fields = inquiryQueueFields(inquiryScheduleRequest({ requestId, inquiryId, messageId, text: '안녕하세요', scheduledAt: at }), 'me1')
  assert.equal(inquiryQueueChatId(inquiryId), 'sub_inq_ch1_sub1')
  assert.deepEqual(fields.chatId, { stringValue: 'sub_inq_ch1_sub1' })
  assert.deepEqual(fields.inquiryId, { stringValue: inquiryId }, 'without it the worker would treat the room as a chat')
  assert.deepEqual(fields.senderId, { stringValue: 'me1' })
  assert.deepEqual(fields.messageId, { stringValue: messageId })
  assert.deepEqual(fields.text, { stringValue: '안녕하세요' })
  assert.deepEqual(fields.type, { stringValue: 'text' })
  assert.deepEqual(fields.status, { stringValue: 'pending' })
  assert.deepEqual(fields.scheduledAt, { timestampValue: { seconds: '1800000000', nanos: 123000000 } })
  assert.equal(fields.recipientId, undefined, 'a room is not a direct peer queue')
  assert.equal(fields.replyToId, undefined)
})
