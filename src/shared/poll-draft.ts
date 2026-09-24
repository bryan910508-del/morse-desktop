// 투표를 만들 때의 검사. 서버 canonicalMessage (firebase/functions/morse-release-authority.js) 와 같은 선을
// 그어, 보내기 전에 여기서 막는다. 서버가 거절할 것을 보낸 뒤에 알게 되는 것보다 낫고, 두 곳이 어긋나면
// 사용자는 «보냈는데 안 됐다»를 겪는다.
//
// 공식 Telegram 은 그룹·채널·저장한 메시지에 투표를 보낸다. 1:1 과 비밀대화에서는 못 보낸다
// (ChatControllerOpenAttachmentMenu.swift 183-231행, 커밋 6ad963e5b62d354da79040f388ae2b9132fb17b8 —
// canSendPolls 는 true 로 시작해 사람 상대에서 꺼지되 봇과 «자기 자신»은 남는다). 그 선은 방을 아는
// 쪽에서 긋는다 — pollRoomAllowed. 서버도 같은 선이다 (assertPollRoom, acceptMessage).
//
// 설정 다섯 개의 기본값은 공식 작성기가 열릴 때의 값이다 (ComposePollScreen.swift 1378-1393): 공개,
// 퀴즈가 아니면 복수 선택, 재투표 허용, 섞지 않음. 방송형 채널의 토론방만 익명 고정 + 섞기 기본이고,
// 그것은 서버가 acceptMessage 에서 굳힌다.

export const maxPollOptions = 10
export const minPollOptions = 2
export const maxPollQuestionLength = 300
export const maxPollOptionLength = 100

export interface PollDraft {
  question: string
  options: string[]
  anonymous: boolean
  multipleAnswers: boolean
  quiz: boolean
  correctOption: number | null
  canRevote: boolean
  shuffleOptions: boolean
}

export const emptyPollDraft: PollDraft = {
  question: '', options: ['', ''], anonymous: false, multipleAnswers: true, quiz: false, correctOption: null,
  canRevote: true, shuffleOptions: false,
}

export type PollDraftProblem =
  | 'question-missing' | 'question-long'
  | 'options-few' | 'options-many' | 'option-long' | 'options-duplicate'
  | 'quiz-answer-missing' | 'quiz-multiple'

/** 보낼 수 있는 상태면 빈 배열. 아니면 무엇이 막는지. */
export function pollDraftProblems(draft: PollDraft): PollDraftProblem[] {
  const problems: PollDraftProblem[] = []
  const question = draft.question.trim()
  if (!question) problems.push('question-missing')
  else if (question.length > maxPollQuestionLength) problems.push('question-long')
  // 빈 칸은 아직 안 적은 칸이다. 세는 것은 적힌 것만.
  const filled = draft.options.map(option => option.trim()).filter(Boolean)
  if (filled.length < minPollOptions) problems.push('options-few')
  if (filled.length > maxPollOptions) problems.push('options-many')
  if (filled.some(option => option.length > maxPollOptionLength)) problems.push('option-long')
  if (new Set(filled).size !== filled.length) problems.push('options-duplicate')
  // 퀴즈는 답이 하나다. 서버도 퀴즈에 복수 선택이 오면 거절한다 — 작성기에서 퀴즈를 켤 때
  // 복수 선택을 함께 끄고, 그래도 남아 있으면 여기서 막는다.
  if (draft.quiz) {
    if (draft.multipleAnswers) problems.push('quiz-multiple')
    const answer = draft.correctOption
    // 정답은 «적힌 선택지» 기준이다. 중간에 빈 칸이 있으면 자리가 밀린다.
    if (answer === null || !Number.isInteger(answer) || answer < 0 || answer >= filled.length) problems.push('quiz-answer-missing')
  }
  return problems
}

export function pollDraftReady(draft: PollDraft): boolean { return pollDraftProblems(draft).length === 0 }

/** 서버로 보낼 모양. 집계는 담지 않는다 — 서버가 0에서 시작시키고 보낸 값은 버린다. */
export function pollDraftWire(draft: PollDraft): {
  pollQuestion: string
  pollOptions: string[]
  pollIsAnonymous: boolean
  pollMultipleAnswers: boolean
  pollIsQuiz: boolean
  pollCanRevote: boolean
  pollShuffleOptions: boolean
  pollCorrectOption?: number
} {
  if (!pollDraftReady(draft)) throw new Error('poll draft is not ready')
  const options = draft.options.map(option => option.trim()).filter(Boolean)
  return {
    pollQuestion: draft.question.trim(),
    pollOptions: options,
    pollIsAnonymous: draft.anonymous,
    pollMultipleAnswers: draft.multipleAnswers,
    pollIsQuiz: draft.quiz,
    pollCanRevote: draft.canRevote,
    pollShuffleOptions: draft.shuffleOptions,
    ...(draft.quiz && draft.correctOption !== null ? { pollCorrectOption: draft.correctOption } : {}),
  }
}

/** 선택지 칸을 더할 수 있는가. 적힌 것이 아니라 칸 수로 센다. */
export function canAddPollOption(draft: PollDraft): boolean { return draft.options.length < maxPollOptions }

/**
 * 이 방에 투표를 보낼 수 있는가. 그룹, 채널 토론방, 그리고 «저장한 메시지»(메모방)다.
 * `kind` 는 DialogSummary.kind, `discussion` 은 채널 토론방 표시, `memo` 는 chats/memo_{uid} 인지다.
 * 서버가 긋는 선과 같다 — morse-message-authority.js acceptMessage, morse-release-authority.js assertPollRoom.
 */
export function pollRoomAllowed(kind: string, discussion: boolean, memo: boolean): boolean {
  return kind === 'group' || discussion === true || memo === true
}
