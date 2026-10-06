import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decodeDialog, documents, type FirestoreDocument } from '../../src/main/network/firestore-values'
import { decodeInquiry } from '../../src/main/accounts/channel-inquiries'
import { expiredTop } from '../../src/main/accounts/chat-list-tops'
import { setLanguage } from '../../src/shared/i18n'
import type { DialogSummary, MessagePosition } from '../../src/shared/model'

// B163 ①④ (contract §10): the server writes a room whose newest line is its auto-delete notice as lastMessage '' +
// lastMessageType 'autoDeletePolicy' + lastSystemEvent, and every message's deleteAt as lastMessageDeleteAt. Without
// those fields (the server today) everything reads as before.
const s = (stringValue: string) => ({ stringValue })
const ts = (seconds: number) => ({ timestampValue: { seconds: String(seconds), nanos: 0 } })
const event = (fields: Record<string, unknown>) => ({ mapValue: { fields: { kind: s('autoDeletePolicy'), ...fields } } })
const room = (fields: Record<string, unknown>): FirestoreDocument => ({ name: `${documents}/chats/direct_me_you`, updateTime: { seconds: '5', nanos: 0 }, createTime: { seconds: '1', nanos: 0 },
  fields: { type: s('direct'), participantUids: { arrayValue: { values: [s('me'), s('you')] } }, participantInfo: { mapValue: { fields: { you: { mapValue: { fields: { displayName: s('민지') } } } } } },
    lastMessageAt: ts(1_790_000_000), ...fields } } as unknown as FirestoreDocument)

test('B163: without the new fields a row reads exactly as before', () => {
  setLanguage('ko')
  const read = decodeDialog(room({ lastMessage: s('안녕'), lastMessageType: s('text') }), 'me')
  assert.equal(read.summary.preview, '안녕')
  assert.equal(read.topExpiresAt, undefined)
  assert.equal(decodeDialog(room({ lastMessage: s('') }), 'me').summary.preview, '', 'an empty line stays empty')
  assert.equal(decodeDialog(room({ lastMessage: s(''), lastSystemEvent: event({ actorName: s('민지'), seconds: { integerValue: '3600' } }) }), 'me').summary.preview, '',
    'an event without its kind in lastMessageType is not read')
})

test('B163 ①: the auto-delete notice reads in the row as it does in the room, in each language', () => {
  const line = (fields: Record<string, unknown>) => decodeDialog(room({ lastMessage: s(''), lastMessageType: s('autoDeletePolicy'), lastSystemEvent: event(fields) }), 'me').summary.preview
  setLanguage('ko')
  assert.equal(line({ actorName: s('민지'), seconds: { integerValue: '86400' }, myOnly: { booleanValue: false } }), '민지님이 모든 메시지를 1일 후 자동 삭제로 설정했어요.')
  assert.equal(line({ actorName: s('민지'), seconds: { integerValue: '3600' }, myOnly: { booleanValue: true } }), '민지님이 본인이 보낸 메시지만 1시간 후 자동 삭제로 설정했어요.')
  assert.equal(line({ actorName: s('민지'), seconds: { integerValue: '0' } }), '민지님이 이 대화의 자동 삭제를 껐어요.')
  assert.equal(line({ seconds: { integerValue: '3600' } }), '자동 삭제 설정이 바뀌었어요.', 'no name: the plain sentence')
  assert.equal(line({ actorName: s('민지'), seconds: { integerValue: '120' } }), '자동 삭제 설정이 바뀌었어요.', 'a period this app does not offer: the plain sentence, never «turned off»')
  setLanguage('en')
  assert.match(line({ actorName: s('Minji'), seconds: { integerValue: '86400' } }), /Minji/)
  assert.doesNotMatch(line({ actorName: s('Minji'), seconds: { integerValue: '86400' } }), /[가-힣]/)
  setLanguage('ru')
  assert.doesNotMatch(line({ actorName: s('Минджи'), seconds: { integerValue: '86400' } }), /[가-힣]/)
  setLanguage('ko')
  const other = decodeDialog(room({ lastMessage: s(''), lastMessageType: s('autoDeletePolicy'), lastSystemEvent: { mapValue: { fields: { kind: s('newLogin') } } } }), 'me').summary.preview
  assert.equal(other, '', 'another kind of event is not read as the notice')
})

test('B163 ①: an inquiry row reads its auto-delete notice too, and as before without the fields', () => {
  setLanguage('ko')
  const inquiry = (fields: Record<string, unknown>) => decodeInquiry({ name: `${documents}/channelInquiries/q1`, updateTime: { seconds: '5', nanos: 0 },
    fields: { channelOwnerId: s('me'), subscriberId: s('you'), channelName: s('채널'), subscriberName: s('민지'), lastMessageAt: ts(1_790_000_000), ...fields } } as unknown as FirestoreDocument, 'me')
  assert.equal(inquiry({ lastMessage: s(''), lastMessageType: s('autoDeletePolicy'), lastSystemEvent: event({ actorName: s('채널'), seconds: { integerValue: '604800' } }) }).lastMessage,
    '채널님이 모든 메시지를 1주일 후 자동 삭제로 설정했어요.')
  assert.equal(inquiry({ lastMessage: s('안녕하세요') }).lastMessage, '안녕하세요')
})

const at = (seconds: number, id = 'c1'): MessagePosition => ({ seconds, nanoseconds: 0, id })
const row = (top: MessagePosition): DialogSummary => ({ id: 'c1', preview: '사라질 글', top } as unknown as DialogSummary)

test('B163 ④: the row\'s message past its deleteAt gives way to the next one held here, or to no line', () => {
  const now = 2_000_000
  // Not yet: nothing changes.
  let summary = row(at(100))
  assert.equal(expiredTop(summary, now + 1, now, null), false)
  assert.equal(summary.preview, '사라질 글')
  assert.equal(expiredTop(summary, undefined, now, null), false, 'no lastMessageDeleteAt: as before')
  // Expired, the chat open with its newest page: the newest message it still holds.
  summary = row(at(100))
  const open = { messages: [{ position: at(90, 'm1'), text: '앞 글' }], newerAvailable: false, ready: true, preview: () => '앞 글' }
  assert.equal(expiredTop(summary, now - 1, now, open), true)
  assert.equal(summary.preview, '앞 글')
  assert.deepEqual(summary.top, at(90), 'sorted by that message, under the chat\'s own id')
  // Expired, the open copy has not dropped it yet (its own timer comes a moment later): no line rather than the old one.
  summary = row(at(100))
  assert.equal(expiredTop(summary, now - 1, now, { ...open, messages: [{ position: at(100, 'm2'), text: '사라질 글' }] }), true)
  assert.equal(summary.preview, '')
  // Expired, the chat not open or not read to its newest page: no line, the row keeps its place.
  summary = row(at(100))
  assert.equal(expiredTop(summary, now - 1, now, null), true)
  assert.equal(summary.preview, '')
  assert.deepEqual(summary.top, at(100))
  summary = row(at(100))
  expiredTop(summary, now - 1, now, { ...open, newerAvailable: true })
  assert.equal(summary.preview, '')
})

test('B163 ④: the server\'s newer line is taken as it comes', () => {
  // The server wrote the room again: a new message with a later deleteAt, or none — the decoded row is not touched.
  const read = decodeDialog(room({ lastMessage: s('새 글'), lastMessageType: s('text'), lastMessageDeleteAt: ts(1_900_000_000) }), 'me')
  assert.equal(read.topExpiresAt, 1_900_000_000_000)
  const summary = read.summary
  assert.equal(expiredTop(summary, read.topExpiresAt, 1_800_000_000_000, null), false)
  assert.equal(summary.preview, '새 글')
})
