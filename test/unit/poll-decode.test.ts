import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decodeMessage, documents, type FirestoreDocument, type ReadDialog } from '../../src/main/network/firestore-values'

// 투표 읽기. 계약은 MorseIOS docs/attachment-contract-contact-poll-2026-09-24.md 에 있다.
// 집계는 서버만 쓴다. 문서에 없으면 0 이고, 선택지보다 짧거나 길면 선택지에 맞춘다.
// 연락처 공유는 만들지 않기로 했다 (2026-09-24). 그 종류로 온 메시지는 읽히지 않는 종류가 된다.
const room = 'g1', me = 'me', author = 'other'
function dialog(): ReadDialog {
  return {
    summary: { id: room, version: '1:0', kind: 'group', title: '그룹', participantUids: [me, author], preview: '', unreadCount: 0,
      markedUnread: false, readPositions: {}, readSync: { status: 'ready' }, pinned: false, pinVersion: '', muted: false,
      archived: false, top: null },
    cutoff: null, participantNames: { [me]: '나', [author]: '상대' }, accountUid: me
  } as unknown as ReadDialog
}
const text = (value: string) => ({ stringValue: value })
const list = (values: object[]) => ({ arrayValue: { values } })
function message(fields: Record<string, unknown>, id = 'm1'): FirestoreDocument {
  return {
    name: `${documents}/chats/${room}/messages/${id}`, updateTime: { seconds: '1', nanos: 0 },
    fields: { createdAt: { timestampValue: { seconds: '1750000000', nanos: 0 } }, senderId: text(author), ...fields }
  } as unknown as FirestoreDocument
}

test('a contact message is an unsupported kind, and carries none of its fields', () => {
  const decoded = decodeMessage(message({ type: text('contact'), contactShareId: text('share_1'),
    contactName: text('김아무개'), contactUserId: text('abcd2345'), contactPhotoURL: text('https://x/y.jpg') }), dialog())
  assert.equal(decoded?.kind, 'unsupported')
  // 이 기능은 만들지 않는다. 누군가 그 종류로 써 넣어도 이름·@id·사진이 모델에 실리지 않는다.
  assert.deepEqual(Object.keys(decoded ?? {}).filter(key => key.startsWith('contact')), [])
})

test('a poll reads its question, options and the counts the server wrote', () => {
  const decoded = decodeMessage(message({
    type: text('poll'), pollQuestion: text('점심?'), pollOptions: list([text('국밥'), text('라면'), text('김밥')]),
    pollVoteCounts: list([{ integerValue: '2' }, { integerValue: '0' }, { integerValue: '5' }]),
    pollTotalVoters: { integerValue: '7' }, pollIsAnonymous: { booleanValue: false }, pollMultipleAnswers: { booleanValue: true }
  }), dialog())
  assert.equal(decoded?.kind, 'poll')
  assert.equal(decoded?.poll?.question, '점심?')
  assert.deepEqual(decoded?.poll?.options, ['국밥', '라면', '김밥'])
  assert.deepEqual(decoded?.poll?.voteCounts, [2, 0, 5])
  assert.equal(decoded?.poll?.totalVoters, 7)
  assert.equal(decoded?.poll?.anonymous, false)
  assert.equal(decoded?.poll?.multipleAnswers, true)
  assert.equal(decoded?.poll?.closed, false)
  assert.equal(decoded?.poll?.mine, null, '내 표는 pollVotes 하위 문서에서 따로 읽는다')
})

test('the two switches added on 2026-09-24 are read as the server writes them', () => {
  const decoded = decodeMessage(message({ type: text('poll'), pollQuestion: text('q'), pollOptions: list([text('a'), text('b')]),
    pollCanRevote: { booleanValue: false }, pollShuffleOptions: { booleanValue: true } }), dialog())
  assert.equal(decoded?.poll?.canRevote, false)
  assert.equal(decoded?.poll?.shuffleOptions, true)
})

test('a poll with no counts yet reads zeroes, one per option', () => {
  const decoded = decodeMessage(message({ type: text('poll'), pollQuestion: text('q'), pollOptions: list([text('a'), text('b')]) }), dialog())
  assert.deepEqual(decoded?.poll?.voteCounts, [0, 0])
  assert.equal(decoded?.poll?.totalVoters, 0)
  // 서버는 이 다섯을 언제나 적는다. 필드가 없는 문서는 이 기능보다 오래된 것이고, 그때 익명으로 읽는 것은
  // 보내는 쪽 기본값(공개)과 다른 판단이다 — 확실하지 않은데 누가 찍었는지 보여 주는 쪽이 더 나쁘다.
  assert.equal(decoded?.poll?.anonymous, true, '모르면 익명으로 읽는다')
  assert.equal(decoded?.poll?.canRevote, true, '서버 기본값과 같다')
  assert.equal(decoded?.poll?.shuffleOptions, false)
})

test('a short or long count list is made to match the options', () => {
  const short = decodeMessage(message({ type: text('poll'), pollQuestion: text('q'), pollOptions: list([text('a'), text('b'), text('c')]),
    pollVoteCounts: list([{ integerValue: '4' }]) }), dialog())
  assert.deepEqual(short?.poll?.voteCounts, [4, 0, 0])
  const long = decodeMessage(message({ type: text('poll'), pollQuestion: text('q'), pollOptions: list([text('a'), text('b')]),
    pollVoteCounts: list([{ integerValue: '1' }, { integerValue: '2' }, { integerValue: '9' }]) }), dialog())
  assert.deepEqual(long?.poll?.voteCounts, [1, 2])
})

test('a quiz keeps its answer only when the index is one of its options', () => {
  const inside = decodeMessage(message({ type: text('poll'), pollQuestion: text('q'), pollOptions: list([text('a'), text('b')]),
    pollIsQuiz: { booleanValue: true }, pollCorrectOption: { integerValue: '1' } }), dialog())
  assert.equal(inside?.poll?.quiz, true)
  assert.equal(inside?.poll?.correctOption, 1)
  const outside = decodeMessage(message({ type: text('poll'), pollQuestion: text('q'), pollOptions: list([text('a'), text('b')]),
    pollIsQuiz: { booleanValue: true }, pollCorrectOption: { integerValue: '7' } }), dialog())
  assert.equal(outside?.poll?.correctOption, null)
})

test('a poll without a question or with one option is not a poll', () => {
  assert.equal(decodeMessage(message({ type: text('poll'), pollOptions: list([text('a'), text('b')]) }), dialog())?.poll, undefined)
  assert.equal(decodeMessage(message({ type: text('poll'), pollQuestion: text('q'), pollOptions: list([text('a')]) }), dialog())?.poll, undefined)
})

test('an unknown message kind is still unsupported', () => {
  assert.equal(decodeMessage(message({ type: text('todo') }), dialog())?.kind, 'unsupported')
})
