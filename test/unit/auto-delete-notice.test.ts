import assert from 'node:assert/strict'
import { test } from 'node:test'
import { autoDeleteNoticeText, autoDeleteWirePrefix } from '../../src/shared/auto-delete-notice'
import { autoDeleteNoticeFields } from '../../src/main/network/firestore-values'
import { decodeInquiryMessage } from '../../src/main/accounts/channel-inquiries'
import { documents, type FirestoreDocument, type WireObject } from '../../src/main/network/firestore-values'

// The server writes the auto-delete notice as a system message: the sentence it composed behind «__TALKY_AUTODEL__:»
// and the values behind it (onChatAutoDeletePolicyUpdated / onInquiryAutoDeletePolicyUpdated). The line is drawn in
// this app's language from those values, and an older notice keeps the stored sentence.
const stored = `${autoDeleteWirePrefix}민지님이 모든 메시지를 1주일 후 자동 삭제로 설정했어요.`

test('the notice is drawn from its values, and an older one keeps the sentence the server wrote', () => {
  assert.equal(autoDeleteNoticeText({ actorName: '민지', seconds: 604800, myOnly: false }, stored), '민지님이 모든 메시지를 1주일 후 자동 삭제로 설정했어요.')
  assert.equal(autoDeleteNoticeText({ actorName: '민지', seconds: 604800, myOnly: true }, stored), '민지님이 본인이 보낸 메시지만 1주일 후 자동 삭제로 설정했어요.')
  assert.equal(autoDeleteNoticeText({ actorName: '우리 채널', seconds: 0, myOnly: false }, stored), '우리 채널님이 이 대화의 자동 삭제를 껐어요.')
  assert.equal(autoDeleteNoticeText(null, stored), '민지님이 모든 메시지를 1주일 후 자동 삭제로 설정했어요.', 'no values: the stored sentence, without the marker')
  assert.equal(autoDeleteNoticeText({ actorName: '민지', seconds: 12345, myOnly: false }, stored), '민지님이 모든 메시지를 1주일 후 자동 삭제로 설정했어요.', 'a period this app does not offer keeps the sentence')
  assert.equal(autoDeleteNoticeText(null, ''), '')
})

const fields = (value: Record<string, WireObject>): Record<string, WireObject> => value
test('only a notice the server marked carries values', () => {
  assert.deepEqual(autoDeleteNoticeFields(fields({ systemKind: { stringValue: 'autoDeletePolicy' }, autoDeleteActorName: { stringValue: '민지' }, autoDeleteSeconds: { integerValue: '604800' }, autoDeleteMyOnly: { booleanValue: true } })),
    { actorName: '민지', seconds: 604800, myOnly: true })
  assert.equal(autoDeleteNoticeFields(fields({ systemKind: { stringValue: 'somethingElse' }, autoDeleteActorName: { stringValue: '민지' } })), null)
  assert.equal(autoDeleteNoticeFields(fields({ systemKind: { stringValue: 'autoDeletePolicy' } })), null, 'without a name the stored sentence is used')
  assert.deepEqual(autoDeleteNoticeFields(fields({ systemKind: { stringValue: 'autoDeletePolicy' }, autoDeleteActorName: { stringValue: '민지' }, autoDeleteSeconds: { integerValue: '77' } })),
    { actorName: '민지', seconds: 0, myOnly: false }, 'a period the server never offers reads as off')
})

const inquiry = { id: 'inq1', cutoff: null }
const at = (ms: number): WireObject => ({ timestampValue: { seconds: String(Math.floor(ms / 1000)), nanos: 0 } })
const message = (id: string, value: Record<string, WireObject>): FirestoreDocument => ({
  name: `${documents}/channelInquiries/inq1/messages/${id}`, updateTime: { seconds: '5', nanos: 0 },
  fields: { createdAt: at(Date.now() - 60_000), ...value }
} as unknown as FirestoreDocument)

test('an inquiry room draws the notice as a system line and hides a message past its time', () => {
  const notice = decodeInquiryMessage(message('m1', { isSystem: { booleanValue: true }, systemKind: { stringValue: 'autoDeletePolicy' },
    text: { stringValue: stored }, autoDeleteActorName: { stringValue: '우리 채널' }, autoDeleteSeconds: { integerValue: '86400' }, autoDeleteMyOnly: { booleanValue: false },
    senderType: { stringValue: 'owner' } }), inquiry, 'me1')
  assert.equal(notice?.system, true)
  assert.equal(notice?.text, '우리 채널님이 모든 메시지를 1일 후 자동 삭제로 설정했어요.')
  assert.ok(!notice?.text.includes('__TALKY_AUTODEL__'), 'the marker never reaches the screen')
  const old = decodeInquiryMessage(message('m2', { text: { stringValue: stored }, senderType: { stringValue: 'subscriber' } }), inquiry, 'me1')
  assert.equal(old?.system, true, 'a notice from before the fields is still a system line')
  assert.equal(old?.text, '민지님이 모든 메시지를 1주일 후 자동 삭제로 설정했어요.')
  const expired = decodeInquiryMessage(message('m3', { text: { stringValue: '안녕하세요' }, type: { stringValue: 'text' }, senderId: { stringValue: 'peer1' },
    deleteAt: at(Date.now() - 1000) }), inquiry, 'me1')
  assert.equal(expired, null, 'the room\'s policy already removed it')
  const plain = decodeInquiryMessage(message('m4', { text: { stringValue: '안녕하세요' }, type: { stringValue: 'text' }, senderId: { stringValue: 'me1' } }), inquiry, 'me1')
  assert.equal(plain?.system, undefined)
  assert.equal(plain?.text, '안녕하세요')
  assert.equal(plain?.own, true)
})
