import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { committedSendAck, ServerRejection } from '../../src/main/network/contracts'
import { definiteRejections, deliveryReason, retryableRejections, revokedRejection } from '../../src/main/messaging/text-identity'

// F-ST-003 (parts/P8_stability.md C-ST-13): every refusal the server names ends the send it answers. MESSAGE_REVOKED was
// in none of the outbox's sets, so the message went back to «uncertain», was looked up, found missing and queued again,
// a minute apart at most, without end.
// talky-shared/morse-message-authority.js SEND_ERRORS :448 (iOS repo fc76c271); anything else the server maps to PERSIST_FAILED.
const serverSendErrors = ['FORWARD_SOURCE_SECRET', 'UNAUTHORIZED', 'INVALID_PAYLOAD', 'SUSPENDED', 'CHAT_MISSING', 'NOT_PARTICIPANT', 'PEER_GONE',
  'BLOCKED', 'POSTING_RESTRICTED', 'REPLY_MESSAGE_NOT_FOUND', 'CONFLICT', 'MESSAGE_REVOKED', 'DIRECT_CHAT_EXISTS', 'ACCOUNT_RESTRICTED', 'ACCOUNT_BANNED',
  'CHAT_RESTRICTED', 'READ_ONLY_CHAT', 'STICKER_NOT_FOUND', 'STICKER_REFERENCE_OFF']

test('every refusal the server sends is either final or the deleted message\'s', () => {
  for (const code of serverSendErrors) assert.ok(definiteRejections.has(code) || code === revokedRejection, code)
  assert.equal(revokedRejection, 'MESSAGE_REVOKED')
  assert.ok(!definiteRejections.has('PERSIST_FAILED'), 'the server could not store it: looked up and sent again')
})

test('a read-only chat and a secret original are told, and not sent again by a press', () => {
  for (const code of ['READ_ONLY_CHAT', 'FORWARD_SOURCE_SECRET']) assert.ok(!retryableRejections.has(code), code)
  assert.equal(deliveryReason('READ_ONLY_CHAT'), '이 대화에는 메시지를 보낼 수 없습니다.')
  assert.equal(deliveryReason('FORWARD_SOURCE_SECRET'), '비밀 대화의 메시지는 전달할 수 없습니다.')
  for (const file of ['src/shared/i18n/en.json', 'src/shared/i18n/ru.json']) {
    const words = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>
    assert.ok(words['이 대화에는 메시지를 보낼 수 없습니다.'] && words['비밀 대화의 메시지는 전달할 수 없습니다.'], file)
  }
})

test('the socket\'s answer MESSAGE_REVOKED reaches the outbox as that refusal', () => {
  const wire = { id: 'm1', chatId: 'c1', senderId: 'me', type: 'text', text: 'hi', isSilent: false, isEncrypted: false, protocolVersion: 3 } as never
  let caught: unknown
  try { committedSendAck({ ok: false, error: 'MESSAGE_REVOKED' }, wire) } catch (error) { caught = error }
  assert.ok(caught instanceof ServerRejection)
  assert.equal(caught.reason, 'MESSAGE_REVOKED')
})

test('the outbox lets a deleted message\'s send go, as a deleted message goes, before it reads final refusals', () => {
  const outbox = readFileSync('src/main/messaging/outbox.ts', 'utf8')
  assert.match(outbox, /if \(error instanceof ServerRejection && error\.reason === revokedRejection\) \{[\s\S]{0,300}this\.retryAt\.delete\(intent\.id\)\n\s*await this\.store\(\{ kind: 'finish', id: intent\.id, discarded: true \}\)\n\s*\} else if \(error instanceof ServerRejection && definiteRejections\.has\(error\.reason\)\)/)
})
