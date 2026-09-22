import assert from 'node:assert/strict'
import { test } from 'node:test'
import { inquiryChatMessage, inquiryForwardRequest, inquiryOfQueueChatId, inquiryQueueChatId, type InquiryMessageItem } from '../../src/shared/channel-inquiries'
import { canForwardMedia, canForwardMessage, canForwardText, forwardRequest } from '../../src/shared/forward'

// Telegram forwards by re-sending the content (no source identity travels with it), so a room's message is forwarded
// through the very machinery a chat's message uses. The room comes along as its client id, sub_inq_<inquiryId>,
// which no chat can be called, so the queue never mistakes one for the other.
const text = (value: Partial<InquiryMessageItem> = {}): InquiryMessageItem => ({
  id: 'm1', own: true, senderType: 'subscriber', kind: 'text', text: '안녕하세요', label: '', createdAt: 1_700_000_000_000,
  edited: false, version: '1700000000:0', ...value
})

test('a room message reads as a message the forward machinery accepts', () => {
  const message = inquiryChatMessage(text(), 'ch1_sub1')
  assert.equal(message.chatId, 'ch1_sub1')
  assert.equal(message.kind, 'text')
  assert.equal(message.text, '안녕하세요')
  assert.equal(canForwardText(message), true)
  assert.equal(canForwardMedia(message), false)
  const photo = inquiryChatMessage(text({ kind: 'image', text: '설명', label: '사진', mediaMetadata: { imageWidthsPx: [800], imageHeightsPx: [600] },
    attachments: [{ index: 0, kind: 'image', name: '사진', available: true, blind: false }] }), 'ch1_sub1')
  assert.equal(photo.caption, '설명', 'a picture carries its caption, not its text')
  assert.equal(canForwardMedia(photo), true)
  assert.equal(canForwardText(photo), false)
})

test('a notice line and an unfinished message are never forwarded', () => {
  assert.equal(canForwardMessage(inquiryChatMessage(text({ system: true, text: '민지님이 자동 삭제를 켰어요.' }), 'ch1_sub1')), false)
  assert.equal(canForwardMessage(inquiryChatMessage(text({ text: '   ' }), 'ch1_sub1')), false)
  assert.equal(canForwardMessage(inquiryChatMessage(text({ version: '' }), 'ch1_sub1')), false)
  const missing = inquiryChatMessage(text({ kind: 'image', attachments: [{ index: 0, kind: 'image', name: '사진', available: false, blind: false }],
    mediaMetadata: { imageWidthsPx: [800], imageHeightsPx: [600] } }), 'ch1_sub1')
  assert.equal(canForwardMedia(missing), false, 'an attachment whose object is gone is not forwarded')
})

test('the room travels as its client id, which a chat forward request accepts', () => {
  assert.equal(inquiryQueueChatId('ch1_sub1'), 'sub_inq_ch1_sub1')
  assert.equal(inquiryOfQueueChatId('sub_inq_ch1_sub1'), 'ch1_sub1')
  assert.equal(inquiryOfQueueChatId('chat1'), '', 'a chat is not a room')
  assert.equal(inquiryOfQueueChatId(undefined), '')
  assert.throws(() => inquiryOfQueueChatId('sub_inq_nope'), /문의/, 'a room id always names its channel and subscriber')
  const request = forwardRequest({ id: 'op1', source: { chatId: 'sub_inq_ch1_sub1', messageId: 'm1', version: '1700000000:0' },
    targets: [{ chatId: 'chat1', messageId: 'a1b2c3' }] })
  assert.equal(request.source.chatId, 'sub_inq_ch1_sub1')
  assert.deepEqual(request.targets, [{ chatId: 'chat1', messageId: 'a1b2c3' }])
  assert.throws(() => forwardRequest({ id: 'op1', source: { chatId: 'sub_inq_ch1_sub1', messageId: 'm1', version: '1700000000:0' },
    targets: [{ chatId: 'sub_inq_ch1_sub1', messageId: 'a1' }] }), /대화/, 'a room never forwards into itself')
})

test('a forward into rooms names the rooms, and never the room it came from', () => {
  const source = { chatId: 'chat1', messageId: 'm1', version: '1700000000:0' }
  assert.deepEqual(inquiryForwardRequest({ id: 'op1', source, inquiryIds: ['ch1_sub1', 'ch2_sub1'] }),
    { id: 'op1', source, inquiryIds: ['ch1_sub1', 'ch2_sub1'] })
  assert.throws(() => inquiryForwardRequest({ id: 'op1', source, inquiryIds: [] }), /대화/)
  assert.throws(() => inquiryForwardRequest({ id: 'op1', source, inquiryIds: ['ch1_sub1', 'ch1_sub1'] }), /대화/)
  assert.throws(() => inquiryForwardRequest({ id: 'op1', source, inquiryIds: Array.from({ length: 11 }, (_, index) => `ch${index}_sub1`) }), /대화/)
  assert.throws(() => inquiryForwardRequest({ id: 'op1', source: { ...source, chatId: 'sub_inq_ch1_sub1' }, inquiryIds: ['ch1_sub1'] }), /대화/,
    'a room does not forward into itself')
  assert.deepEqual(inquiryForwardRequest({ id: 'op1', source: { ...source, chatId: 'sub_inq_ch1_sub1' }, inquiryIds: ['ch2_sub1'] }).inquiryIds, ['ch2_sub1'])
  assert.throws(() => inquiryForwardRequest({ id: 'op1', source, inquiryIds: ['ch1_sub1'], extra: 1 }))
})
