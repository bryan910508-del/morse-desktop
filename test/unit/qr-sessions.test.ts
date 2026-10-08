import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decodeSignInSession, revokeRefusal } from '../../src/main/api/account-tools'
import { MorseCallableFailure } from '../../src/main/network/morse-callable'
import { documents, type FirestoreDocument } from '../../src/main/network/firestore-values'
import { sessionQrLine } from '../../src/shared/account-tools'

// A13 §2.2 · §3: a session a phone approved by QR says so and which phone; every session shows its IP and the place
// the IP points to (Telegram settings_active_sessions.cpp:463-467) — the account's own list only. Android §32's words.
const doc = (id: string, fields: Record<string, unknown>): FirestoreDocument => ({ name: `${documents}/users/me/signInSessions/${id}`, fields }) as unknown as FirestoreDocument
const map = (fields: Record<string, unknown>) => ({ mapValue: { fields } })

test('a QR session names the phone that approved it, and every session its IP (B206: no place)', () => {
  const row = decodeSignInSession(doc('desk', { platform: { stringValue: 'macOS' }, loginProvider: { stringValue: 'qr' },
    linkedBy: map({ sessionId: { stringValue: 'phone1' }, platform: { stringValue: 'iOS' }, deviceLabel: { stringValue: 'Morse · iPhone 15' } }),
    ip: { stringValue: '203.0.113.7' }, origin: map({ country: { stringValue: 'kr' }, region: { stringValue: 'Seoul' } }) }), 'other')!
  assert.deepEqual(row.qr, { approvedBy: 'iPhone 15', approverSessionId: 'phone1', approverGone: false })
  assert.equal(row.ip, '203.0.113.7')
  assert.ok(!('origin' in row), 'an old row\'s country is not read: the server no longer writes it')
  const plain = decodeSignInSession(doc('p', { platform: { stringValue: 'Android' }, loginProvider: { stringValue: 'custom' }, origin: map({ country: { stringValue: 'Korea' } }) }), 'p')!
  assert.equal(plain.qr, null, 'only a QR sign-in says how it came')
  const unnamed = decodeSignInSession(doc('d2', { loginProvider: { stringValue: 'qr' }, linkedBy: map({ platform: { stringValue: 'Android' } }) }), 'x')!
  assert.equal(unnamed.qr?.approvedBy, 'Android', 'the platform when the label is missing')
})

test('the QR line and the 24-hour refusal read as Android shows them', () => {
  assert.equal(sessionQrLine({ approvedBy: 'iPhone 15', approverSessionId: 'p', approverGone: false }), 'QR 로그인 · iPhone 15에서 승인')
  assert.equal(sessionQrLine({ approvedBy: 'iPhone 15', approverSessionId: 'p', approverGone: true }), 'QR 로그인 · 승인 기기 로그아웃됨')
  assert.equal(revokeRefusal(new MorseCallableFailure('answered', 'FAILED_PRECONDITION', 'fresh-session')), '새로 로그인한 기기는 24시간 동안 다른 기기를 로그아웃할 수 없어요.')
  assert.equal(revokeRefusal(new MorseCallableFailure('answered', 'PERMISSION_DENIED', 'other')), '세션을 종료하지 못했습니다.')
  assert.equal(revokeRefusal(new Error('offline')), '세션을 종료하지 못했습니다.')
})
