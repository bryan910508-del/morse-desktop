import assert from 'node:assert/strict'
import { test } from 'node:test'
import { messageKindLabel, unsupportedMessageNotice } from '../../src/shared/message-kinds'

// The same map had been written out four times — the bubble, the reply quote, the composer's reply bar
// and the main-process reply preview — and had drifted: one had no name for a poll, and each said
// something different about a message this version cannot read.
const kinds = ['text', 'image', 'video', 'voice', 'file', 'sticker', 'channelPost', 'location', 'event', 'poll', 'unsupported'] as const

test('every kind but a text has a name for the one line it gets', () => {
  assert.equal(messageKindLabel('text'), '')
  for (const kind of kinds.filter(kind => kind !== 'text')) assert.ok(messageKindLabel(kind), `${kind} has no name`)
  assert.equal(messageKindLabel('poll'), '투표', 'the copy that had no name for a poll left its reply bar blank')
})

// Telegram says the whole notice in the message's own text and names it in one line where one line is
// all there is (Watch.Message.Unsupported). Morse says the same two things, and iOS says them in the
// same words (chat.unsupportedMessage / chat.unsupportedMessageShort).
test('a message this version cannot read is named in one line and explained in the bubble', () => {
  assert.equal(messageKindLabel('unsupported'), '지원하지 않는 메시지')
  assert.equal(unsupportedMessageNotice(), '이 메시지는 현재 버전의 Morse에서 지원하지 않습니다. 최신 버전으로 업데이트해 주세요.')
  assert.notEqual(unsupportedMessageNotice(), messageKindLabel('unsupported'), 'the bubble says more than the one line does')
})

test('a kind this version has never heard of takes no room', () => {
  assert.equal(messageKindLabel('something-new'), '')
})
