import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canAddPollOption, emptyPollDraft, pollDraftProblems, pollDraftReady, pollDraftWire, pollRoomAllowed,
  type PollDraft } from '../../src/shared/poll-draft'

// 이 검사는 서버 canonicalMessage (MorseIOS firebase/functions/morse-release-authority.js) 와 같은 선을
// 그어야 한다. 어긋나면 사용자가 «보냈는데 서버가 거절» 을 겪는다. 서버가 거절하는 것:
// 질문 1..300, 선택지 2..10개, 각 1..100, 공백 제거 후 중복 금지, 퀴즈는 복수 선택과 배타이고
// 정답이 범위 안이어야 한다.
//
// 기본값은 공식 Telegram 작성기가 열릴 때의 값이다 (ComposePollScreen.swift 1378-1393): 공개, 복수 선택,
// 재투표 허용, 섞지 않음. 그래서 퀴즈를 켜는 것만으로는 보낼 수 없다 — 복수 선택을 함께 꺼야 한다.
const draft = (over: Partial<PollDraft> = {}): PollDraft => ({ ...emptyPollDraft, ...over })

test('a poll needs a question and two answers', () => {
  assert.deepEqual(pollDraftProblems(draft()), ['question-missing', 'options-few'])
  assert.deepEqual(pollDraftProblems(draft({ question: '점심?' })), ['options-few'])
  assert.deepEqual(pollDraftProblems(draft({ question: '점심?', options: ['국밥', ''] })), ['options-few'])
  assert.equal(pollDraftReady(draft({ question: '점심?', options: ['국밥', '라면'] })), true)
})

test('an empty box is a box not yet filled, not an answer', () => {
  // 가운데가 비어도 양쪽이 적혀 있으면 보낼 수 있다. 세는 것은 적힌 것뿐이다.
  assert.equal(pollDraftReady(draft({ question: 'q', options: ['a', '', 'b'] })), true)
  assert.deepEqual(pollDraftWire(draft({ question: 'q', options: ['a', '', 'b'] })).pollOptions, ['a', 'b'])
})

test('two answers that read the same after trimming are one answer', () => {
  assert.deepEqual(pollDraftProblems(draft({ question: 'q', options: ['국밥', ' 국밥 '] })), ['options-duplicate'])
})

test('the limits match the ones the server enforces', () => {
  assert.deepEqual(pollDraftProblems(draft({ question: 'q'.repeat(301), options: ['a', 'b'] })), ['question-long'])
  assert.deepEqual(pollDraftProblems(draft({ question: 'q', options: ['a', 'b'.repeat(101)] })), ['option-long'])
  const eleven = Array.from({ length: 11 }, (_, index) => `o${index}`)
  assert.deepEqual(pollDraftProblems(draft({ question: 'q', options: eleven })), ['options-many'])
  assert.equal(canAddPollOption(draft({ options: Array.from({ length: 10 }, () => '') })), false)
  assert.equal(canAddPollOption(draft({ options: Array.from({ length: 9 }, () => '') })), true)
})

test('a quiz takes one answer and needs to know which one', () => {
  const quiz = (over: Partial<PollDraft>) => draft({ question: 'q', options: ['a', 'b'], quiz: true, multipleAnswers: false, ...over })
  assert.deepEqual(pollDraftProblems(quiz({})), ['quiz-answer-missing'])
  assert.deepEqual(pollDraftProblems(quiz({ correctOption: 5 })), ['quiz-answer-missing'])
  assert.equal(pollDraftReady(quiz({ correctOption: 1 })), true)
  // 기본 초안은 복수 선택이 켜져 있다. 퀴즈만 켜면 서버가 거절할 모양이므로 여기서 먼저 막는다.
  assert.deepEqual(pollDraftProblems(draft({ question: 'q', options: ['a', 'b'], quiz: true, correctOption: 0 })), ['quiz-multiple'])
})

test('a quiz answer counts the filled boxes, not the empty ones before it', () => {
  // 가운데 빈 칸을 지우면 뒤의 선택지가 앞으로 당겨진다. 정답은 적힌 것 기준이어야 한다.
  const withGap = draft({ question: 'q', options: ['a', '', 'b'], quiz: true, multipleAnswers: false, correctOption: 1 })
  assert.equal(pollDraftReady(withGap), true)
  assert.deepEqual(pollDraftWire(withGap).pollOptions, ['a', 'b'])
  assert.equal(pollDraftWire(withGap).pollCorrectOption, 1, '적힌 것 기준으로 b')
})

test('the wire carries no tally — the server starts one', () => {
  const wire = pollDraftWire(draft({ question: '점심?', options: [' 국밥 ', '라면'], anonymous: false, multipleAnswers: true }))
  assert.deepEqual(wire, { pollQuestion: '점심?', pollOptions: ['국밥', '라면'], pollIsAnonymous: false, pollMultipleAnswers: true,
    pollIsQuiz: false, pollCanRevote: true, pollShuffleOptions: false })
  assert.equal('pollVoteCounts' in wire, false)
  assert.equal('pollTotalVoters' in wire, false)
  assert.equal('pollIsClosed' in wire, false)
})

test('a draft that is not ready is never turned into a wire', () => {
  assert.throws(() => pollDraftWire(draft({ question: '', options: ['a', 'b'] })))
})

// 공식 Telegram 은 1:1 대화와 비밀대화에 투표 버튼을 주지 않는다. «저장한 메시지»에는 준다 —
// canSendPolls 는 사람 상대에서 꺼지되 자기 자신은 남는다 (ChatControllerOpenAttachmentMenu.swift 183-231).
test('a poll belongs to a group, a channel discussion or Saved Messages', () => {
  assert.equal(pollRoomAllowed('group', false, false), true)
  assert.equal(pollRoomAllowed('group', true, false), true)
  assert.equal(pollRoomAllowed('direct', true, false), true, '채널 토론방')
  assert.equal(pollRoomAllowed('direct', false, true), true, '저장한 메시지')
  assert.equal(pollRoomAllowed('direct', false, false), false)
  assert.equal(pollRoomAllowed('secret', false, false), false)
})
