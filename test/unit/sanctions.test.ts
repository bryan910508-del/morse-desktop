import assert from 'node:assert/strict'
import { test } from 'node:test'
import { locale } from '../../src/shared/i18n'
import { operatorMailAddress, operatorMailURL, rejectionCode, rejectionUntil, restrictedNotice, sanctionOf, storedRejection } from '../../src/shared/sanctions'
import { committedSendAck, ServerRejection } from '../../src/main/network/contracts'
import { deliveryReason, definiteRejections, retryableRejections } from '../../src/main/messaging/text-identity'
import { failureFromBody } from '../../src/main/auth/firebase-rest'
import { tokenFailureEffect } from '../../src/main/auth/contracts'
import { decodeDialog, documents, type FirestoreDocument } from '../../src/main/network/firestore-values'
import { decodeChannelSummary } from '../../src/main/accounts/channels'

// A10 §4 (Telegram R-56): what a sanctioned account is told — a restriction with its end, a ban with «도움», a closed
// room instead of its content. The server answers {reason, until?} (morse-sanctions.js).
const until = Date.UTC(2026, 9, 9, 3, 30)
const wire = { id: 'm1', chatId: 'c1', senderId: 'me' } as never

test('a restriction refusal keeps its end on the message, says it, and can be sent again later', () => {
  let rejection: ServerRejection | null = null
  try { committedSendAck({ ok: false, error: 'ACCOUNT_RESTRICTED', until }, wire) } catch (error) { rejection = error as ServerRejection }
  assert.equal(rejection?.reason, 'ACCOUNT_RESTRICTED')
  assert.equal(rejection?.until, until)
  const stored = storedRejection(rejection!.reason, rejection!.until)
  assert.equal(stored, `ACCOUNT_RESTRICTED:${until}`)
  assert.deepEqual([rejectionCode(stored), rejectionUntil(stored), sanctionOf(stored)], ['ACCOUNT_RESTRICTED', until, 'restricted'])
  assert.ok(definiteRejections.has('ACCOUNT_RESTRICTED') && retryableRejections.has(rejectionCode(stored)))
  const date = new Intl.DateTimeFormat(locale(), { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(until)
  assert.equal(deliveryReason(stored), restrictedNotice(until))
  assert.ok(deliveryReason(stored).includes(date), 'the notice names the end')
  assert.equal(deliveryReason('ACCOUNT_RESTRICTED'), restrictedNotice(null), 'without an end it says so plainly')
})

test('a ban and a closed room are final; other refusals keep their old words', () => {
  assert.ok(definiteRejections.has('ACCOUNT_BANNED') && !retryableRejections.has('ACCOUNT_BANNED'))
  assert.ok(definiteRejections.has('CHAT_RESTRICTED') && !retryableRejections.has('CHAT_RESTRICTED'))
  assert.equal(sanctionOf('ACCOUNT_BANNED'), 'banned')
  assert.equal(sanctionOf('CHAT_RESTRICTED'), null)
  assert.equal(storedRejection('BLOCKED', until), 'BLOCKED', 'only a restriction carries a date')
  assert.equal(deliveryReason('BLOCKED'), deliveryReason('BLOCKED:1'.split(':')[0]!))
})

test('a ban from the server stops the account without forgetting its sign-in', () => {
  const banned = failureFromBody({ error: { status: 'PERMISSION_DENIED', message: 'Account banned.', details: { reason: 'ACCOUNT_BANNED' } } }, 403, 'plain')
  assert.equal(banned.code, 'banned')
  assert.equal(failureFromBody({ error: { message: 'USER_DISABLED' } }, 400, 'plain').code, 'banned', 'the operator disabled the Firebase user')
  assert.equal(tokenFailureEffect('banned'), 'disconnect', 'what the device kept stays — a ban can be lifted')
  assert.equal(failureFromBody({ error: { status: 'PERMISSION_DENIED', details: { reason: 'session-revoked' } } }, 403, 'plain').code, 'revoked')
})

test('the operator mail names the account, the app and the system', () => {
  const url = operatorMailURL('restricted', { uid: 'u123', userId: 'minji', appVersion: '0.241.3', system: 'macOS 26.4', until })
  assert.ok(url.startsWith(`mailto:${operatorMailAddress}?subject=`))
  const body = decodeURIComponent(url.split('&body=')[1]!)
  for (const part of ['@minji (u123)', '0.241.3', 'macOS 26.4']) assert.ok(body.includes(part), part)
  assert.ok(decodeURIComponent(url).includes('@minji'), 'in the subject too')
  assert.ok(!decodeURIComponent(operatorMailURL('banned', { uid: '', userId: '', appVersion: '1', system: 's' })).includes('undefined'), 'no account yet: the person writes it')
})

// 6A-5 decision (10-02 21:3x): where the account is not known, an empty «Morse 아이디:» line; never a recovery code
// or any other secret, whatever the sign-in screen held.
test('the ban mail before the account is known leaves the Morse ID line empty and carries no recovery code', () => {
  const code = 'ABCD-EFGH-IJKL-MNOP'
  const facts = { uid: '', userId: '', appVersion: '0.241.3', system: 'macOS 26.4', backupCode: code, recoveryCode: code } as never
  const text = decodeURIComponent(operatorMailURL('banned', facts))
  const lines = text.split('&body=')[1]!.split('\n')
  assert.ok(lines.some(line => line.trim() === 'Morse 아이디:'), 'an empty Morse ID line')
  assert.ok(!text.includes(code) && !text.includes('ABCD'), 'no recovery code anywhere in the mail')
  assert.ok(operatorMailURL('banned', { uid: 'u1', userId: 'minji', appVersion: '1', system: 's' }).includes(encodeURIComponent('Morse 아이디: @minji (u1)')), 'a known account is named')
})

// B73 (10-02 combined test: the appeal mail said nothing of the end the notice under the message showed): a restriction's
// mail carries its end on a «제한 끝» line; a ban's does not, and neither carries a recovery code.
test('the restriction appeal mail names when the restriction ends, and still nothing secret', () => {
  const date = new Intl.DateTimeFormat(locale(), { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(until)
  const code = 'ABCD-EFGH-IJKL-MNOP'
  const facts = { uid: 'u1', userId: 'minji', appVersion: '0.241.3', system: 'macOS 26.4', until, backupCode: code, recoveryCode: code } as never
  const lines = decodeURIComponent(operatorMailURL('restricted', facts)).split('&body=')[1]!.split('\n')
  assert.ok(lines.includes(`제한 끝: ${date}`), 'a line of its own with the end')
  assert.ok(lines.indexOf(`제한 끝: ${date}`) === lines.indexOf('Morse 아이디: @minji (u1)') + 1, 'right under the account')
  assert.ok(!decodeURIComponent(operatorMailURL('restricted', facts)).includes(code), 'no recovery code')
  const without = decodeURIComponent(operatorMailURL('restricted', { uid: 'u1', userId: 'minji', appVersion: '1', system: 's' }))
  assert.ok(!without.includes('제한 끝'), 'no end known, no line')
  assert.ok(!decodeURIComponent(operatorMailURL('banned', { uid: 'u1', userId: 'minji', appVersion: '1', system: 's', until })).includes('제한 끝'), 'a ban has no end')
})

test('a room the operator closed is known from its document; others are not', () => {
  const chat = (restriction?: unknown) => ({ name: `${documents}/chats/g1`, updateTime: { seconds: '1', nanos: 0 }, createTime: { seconds: '1', nanos: 0 },
    fields: { type: { stringValue: 'group' }, participantUids: { arrayValue: { values: [{ stringValue: 'me' }, { stringValue: 'peer' }] } }, name: { stringValue: 'g' },
      ...(restriction === undefined ? {} : { restriction }) } }) as unknown as FirestoreDocument
  assert.equal(decodeDialog(chat({ mapValue: { fields: { reason: { stringValue: 'spam' }, fromChannel: { booleanValue: true } } } }), 'me').summary.restricted, true)
  assert.equal(decodeDialog(chat({ stringValue: 'spam' }), 'me').summary.restricted, true)
  assert.equal(decodeDialog(chat(), 'me').summary.restricted, undefined)
  assert.equal(decodeDialog(chat({ nullValue: null }), 'me').summary.restricted, undefined)
  const channel = (restriction?: unknown) => ({ name: `${documents}/channels/c1`, updateTime: { seconds: '1', nanos: 0 }, createTime: { seconds: '1', nanos: 0 },
    fields: { name: { stringValue: 'c' }, ownerId: { stringValue: 'owner' }, createdAt: { timestampValue: { seconds: '1', nanos: 0 } }, ...(restriction === undefined ? {} : { restriction }) } }) as unknown as FirestoreDocument
  assert.equal(decodeChannelSummary(channel({ mapValue: { fields: { reason: { stringValue: 'x' }, wasPublic: { booleanValue: true } } } }), 'me', true).restricted, true)
  assert.equal(decodeChannelSummary(channel(), 'me', true).restricted, false)
})
