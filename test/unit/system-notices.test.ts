import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decodeDialog, decodeMessage, documents, readDialogs, type FirestoreDocument } from '../../src/main/network/firestore-values'
import { chatDeleteRoute } from '../../src/main/accounts/history-clears'
import { setLanguage } from '../../src/shared/i18n'
import { systemNoticeShortcut, systemNoticeText } from '../../src/shared/system-notices'

// B113 / A13-5: Morse's official notice chat «Morse» (chats/system_{uid}, type 'system'), written by the server alone.
// Telegram's service notifications are a user's chat whose peer isServiceUser (777000): read here as a 1:1 marked
// `service` — read-only (no composer, reaction, reply, forward), no last seen, notices drawn from their kind in the app's
// language (§5), read like any other chat, and left out of the Dock badge.

const ts = (seconds: number) => ({ timestampValue: { seconds: String(seconds), nanos: 0 } })
const systemChat = (uid = 'me', participants = [uid, 'morse-system']): FirestoreDocument => ({
  name: `${documents}/chats/system_${uid}`, updateTime: { seconds: '5', nanos: 0 }, createTime: { seconds: '1', nanos: 0 },
  fields: { type: { stringValue: 'system' }, name: { stringValue: 'Morse' }, participantUids: { arrayValue: { values: participants.map(stringValue => ({ stringValue })) } },
    participantInfo: { mapValue: { fields: { 'morse-system': { mapValue: { fields: { displayName: { stringValue: 'Morse' }, official: { stringValue: 'system' } } } } } } },
    lastMessage: { stringValue: '새 기기에서 로그인했습니다: Mac. 본인이 아니면 설정 → 기기에서 이 세션을 종료하세요.' }, lastMessageType: { stringValue: 'system' },
    lastMessageAt: ts(1_790_000_000), unreadCounts: { mapValue: { fields: { me: { integerValue: '1' } } } } }
} as unknown as FirestoreDocument)
const notice = (id: string, event: Record<string, unknown>, senderId = 'morse-system', text = 'Morse 알림'): FirestoreDocument => ({
  name: `${documents}/chats/system_me/messages/${id}`, updateTime: { seconds: '5', nanos: 0 },
  fields: { senderId: { stringValue: senderId }, type: { stringValue: 'system' }, isSystem: { booleanValue: true }, status: { stringValue: 'sent' },
    chatId: { stringValue: 'system_me' }, text: { stringValue: text }, createdAt: ts(1_790_000_000),
    systemEvent: { mapValue: { fields: event } } }
} as unknown as FirestoreDocument)
const s = (stringValue: string) => ({ stringValue })

test('B113: the official notice chat is listed as a read-only 1:1 marked service, named by the document', () => {
  const dialog = decodeDialog(systemChat(), 'me').summary
  assert.equal(dialog.kind, 'direct')
  assert.equal(dialog.service, true)
  assert.equal(dialog.composeAccess, false, 'nothing is offered to send')
  assert.equal(dialog.title, 'Morse')
  assert.equal(dialog.unreadCount, 1, 'its unread count is the chat\'s own, as any chat')
})

test('B113: a system chat that is not this account\'s own with the service account is left out, not shown wrongly', () => {
  assert.equal(readDialogs([systemChat('me', ['me', 'someone'])], 'me').dialogs.length, 0)
  assert.equal(readDialogs([systemChat('me', ['me', 'morse-system', 'x'])], 'me').dialogs.length, 0)
})

test('B113: a notice is a bubble from the service account, read like any message, worded by its kind', () => {
  setLanguage('ko')
  const dialog = decodeDialog(systemChat(), 'me')
  const message = decodeMessage(notice('n1', { kind: s('newLogin'), deviceLabel: s('MacBook'), country: s('KR'), ip: s('1.2.3.4') }), dialog)!
  assert.equal(message.system, false, 'not a centred service line')
  assert.equal(message.kind, 'text')
  assert.equal(message.readEligible, true, 'reading it marks the chat read (the server takes it, SYSTEM_UID)')
  assert.equal(message.notice?.kind, 'newLogin')
  assert.equal(message.text, '새 기기에서 로그인했습니다: MacBook · KR · IP 1.2.3.4. 본인이 아니면 설정 › 기기에서 이 세션을 끝내세요.')
  const unknown = decodeMessage(notice('n2', { kind: s('somethingNew') }, 'morse-system', '서버 대체 문구'), dialog)!
  assert.equal(unknown.text, '서버 대체 문구', 'a kind this build does not know shows the server\'s fallback')
})

test('B113: only the service account\'s message carries a notice; elsewhere a system line stays one', () => {
  const dialog = decodeDialog(systemChat(), 'me')
  const forged = decodeMessage(notice('n3', { kind: s('newLogin') }, 'me', 'x'), dialog)
  assert.equal(forged?.notice, undefined)
})

test('B113: notices read in English and Russian, the device falling back to the platform', () => {
  setLanguage('en')
  assert.equal(systemNoticeText({ kind: 'newLogin', platform: 'Windows', ip: '5.6.7.8' }, ''), 'New login: Windows · IP 5.6.7.8. If this wasn\'t you, end this session in Settings › Devices.')
  assert.equal(systemNoticeText({ kind: 'passwordEnabled' }, ''), 'Two-step verification is on.')
  assert.equal(systemNoticeText({ kind: 'mystery' }, ''), 'Morse notice')
  setLanguage('ru')
  assert.equal(systemNoticeText({ kind: 'passwordDisabled' }, ''), 'Двухэтапная аутентификация отключена.')
  assert.match(systemNoticeText({ kind: 'passwordResetRequested', resetAt: Date.UTC(2026, 9, 11, 3, 0) }, ''), /^Запрошен сброс .* Пароль будет отключён .*2026/)
  setLanguage('ko')
})

test('A3 §9: a recovery code made by Apple or Google is worded by its kind (A13-5 §5), as Android draws it', () => {
  setLanguage('ko')
  assert.equal(systemNoticeText({ kind: 'backupCodeReset', deviceLabel: 'iPhone 15', country: 'KR' }, 'server words'),
    '복구 코드를 새로 만들었습니다: iPhone 15 · KR. 본인이 아니면 설정 › 기기에서 세션을 확인하세요.')
  setLanguage('en')
  assert.equal(systemNoticeText({ kind: 'backupCodeReset', platform: 'macOS' }, ''), 'A new recovery code was made: macOS. If this wasn\'t you, check your sessions in Settings › Devices.')
  setLanguage('ru')
  assert.equal(systemNoticeText({ kind: 'backupCodeReset', platform: 'Android' }, ''), 'Создан новый код восстановления: Android. Если это были не вы, проверьте сеансы в Настройки › Устройства.')
  setLanguage('ko')
  // Android SystemNotices.opensSessions: only a sign-in notice leads to the sessions.
  assert.equal(systemNoticeShortcut({ kind: 'backupCodeReset' }), null)
})

test('B113 / A13-2 ③: a sign-in notice leads to the sessions, a two-step reset to the two-step screen', () => {
  assert.equal(systemNoticeShortcut({ kind: 'newLogin' }), 'sessions')
  assert.equal(systemNoticeShortcut({ kind: 'passwordStage' }), 'sessions')
  assert.equal(systemNoticeShortcut({ kind: 'passwordResetRequested' }), 'two-step', 'A13-2 ③: a reset leads to the two-step screen')
  assert.equal(systemNoticeShortcut({ kind: 'passwordResetCancelled' }), 'two-step')
  assert.equal(systemNoticeShortcut({ kind: 'passwordResetDone' }), 'two-step')
  assert.equal(systemNoticeShortcut({ kind: 'passwordEnabled' }), null)
})

test('B113: the row draws its newest notice from the chat\'s lastSystemEvent; without one, the server\'s text', () => {
  setLanguage('en')
  const withEvent = systemChat()
  ;(withEvent.fields as Record<string, unknown>).lastSystemEvent = { mapValue: { fields: { kind: s('passwordChanged') } } }
  assert.equal(decodeDialog(withEvent, 'me').summary.preview, 'Your two-step verification password was changed.')
  assert.equal(decodeDialog(systemChat(), 'me').summary.preview, '새 기기에서 로그인했습니다: Mac. 본인이 아니면 설정 → 기기에서 이 세션을 종료하세요.',
    'before the server writes lastSystemEvent, its fallback')
  setLanguage('ko')
})

test('B113: «대화 삭제» clears the official notice chat on the server, never deletes or changes its document', () => {
  const service = decodeDialog(systemChat(), 'me').summary
  assert.equal(chatDeleteRoute(service, false), 'service-clear')
  assert.equal(chatDeleteRoute(service, true), 'service-clear', 'for everyone is not offered, and would not go there either')
  assert.equal(chatDeleteRoute({ kind: 'direct' }, false), 'hide')
  assert.equal(chatDeleteRoute({ kind: 'direct' }, true), 'direct-delete')
  assert.equal(chatDeleteRoute({ kind: 'group' }, true), 'document')
})
