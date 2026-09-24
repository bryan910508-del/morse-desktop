import { createHash } from 'node:crypto'
import type { SendWire } from '../../shared/model'
import { tr } from '../../shared/i18n'

// The Railway server's canonical() (morse-message-authority.js) in its exact field order: the payloadDigest it
// stores must equal this, or a send whose answer was lost is taken for a conflict when it is looked up.
// IDs and transport flags are excluded.
const stringFields = ['encryptedMediaMetadata', 'fileName', 'mediaUrl', 'thumbnailUrl', 'thumbData', 'videoCaption', 'imageCaption', 'categoryId', 'replyToId',
  'replyStoryOwnerName', 'replyStoryThumbData', 'replyStoryOwnerType', 'replyStoryId', 'replyStoryOwnerId', 'replyStoryThumbnailUrl', 'replyStoryMediaType',
  'replyStoryText', 'replyStoryChannelId', 'iv', 'pollQuestion'] as const
const numberFields = ['replyStoryExpiresAt', 'fileSize', 'videoDuration', 'videoWidthPx', 'videoHeightPx', 'mediaWidthPx', 'mediaHeightPx', 'voiceDuration'] as const
const arrayFields = ['mediaKeys', 'imageWidthsPx', 'imageHeightsPx', 'voiceWaveform'] as const

export function textDigest(wire: SendWire): string {
  const source = wire as unknown as Record<string, unknown>
  // 서버처럼 payload 에서 종류를 읽는다. 보내는 쪽 타입 합집합이 아직 모르는 종류(연락처·투표)도
  // digest 는 맞게 계산해야 한다 — 서버는 data.type 을 본다.
  const type = typeof source.type === 'string' ? source.type : 'text'
  const canonical: Record<string, unknown> = { type: wire.type, text: wire.text, isSilent: wire.isSilent === true, isEncrypted: false }
  for (const key of stringFields) if (typeof source[key] === 'string') canonical[key] = source[key]
  // 서버는 옛 이름 reply_to 도 아직 받는다. 이 자리에서, 글자열들 뒤에 넣는다.
  if (!canonical.replyToId && typeof source.reply_to === 'string') canonical.replyToId = source.reply_to
  for (const key of numberFields) if (source[key] !== undefined && source[key] !== null) canonical[key] = source[key]
  for (const key of arrayFields) if (Array.isArray(source[key])) canonical[key] = source[key]
  // 투표. 서버 canonical() 이 이 자리에서 하는 것을 그대로 한다 — 선택지를 다듬어 넣고, 다섯 설정을
  // 서버와 같은 기본값으로 굳히고, 집계를 0 에서 시작시킨다. 키가 들어가는 **차례**까지 같아야 한다:
  // JSON.stringify 는 넣은 순서대로 적고, 그 글자열의 해시가 payloadDigest 다.
  //
  // 방송형 토론방에서 서버가 익명으로 굳히는 것(acceptMessage)은 여기 넣지 않는다. 서버도 digest 를
  // 그보다 먼저, 온 payload 그대로 계산해 저장한다.
  if (type === 'poll') {
    const raw = Array.isArray(source.pollOptions) ? source.pollOptions : []
    const options = raw.map(value => typeof value === 'string' ? value.trim() : '')
    canonical.pollOptions = options
    const quiz = source.pollIsQuiz === true
    canonical.pollIsQuiz = quiz
    canonical.pollIsAnonymous = source.pollIsAnonymous === true
    // 퀴즈는 답이 하나뿐이다. 아니면 기본이 복수 선택이다 — 공식 Telegram 작성기와 같다.
    canonical.pollMultipleAnswers = quiz ? false : source.pollMultipleAnswers !== false
    canonical.pollCanRevote = source.pollCanRevote !== false
    canonical.pollShuffleOptions = source.pollShuffleOptions === true
    // 정답은 퀴즈일 때만 들어간다. 아니면 키 자체가 없다.
    if (quiz && Number.isInteger(source.pollCorrectOption)) canonical.pollCorrectOption = source.pollCorrectOption
    // 보낸 집계는 무시된다. 서버가 0 에서 시작시키므로 digest 도 0 이어야 한다.
    canonical.pollVoteCounts = options.map(() => 0)
    canonical.pollTotalVoters = 0
    canonical.pollIsClosed = false
  } else delete canonical.pollQuestion
  if (source.isCircleVideo === true) canonical.isCircleVideo = true
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}
export const retryableRejections = new Set(['UNAUTHORIZED', 'SUSPENDED', 'CHAT_MISSING', 'NOT_PARTICIPANT', 'PEER_GONE', 'BLOCKED', 'POSTING_RESTRICTED'])
// DIRECT_CHAT_EXISTS: the pair already has a dialog under another id (morse-message-authority.js). The list
// receives that dialog; this room's message was not stored.
export const definiteRejections = new Set([...retryableRejections, 'INVALID_PAYLOAD', 'REPLY_MESSAGE_NOT_FOUND', 'CONFLICT', 'DIRECT_CHAT_EXISTS'])
export function deliveryReason(reason: string): string {
  return ({ BLOCKED: tr('차단 상태로 전송할 수 없습니다.'), PEER_GONE: tr('상대 계정을 확인할 수 없습니다.'),
    'upload-network': tr('첨부 업로드가 중단되었습니다. 다시 전송을 누르면 수신 위치를 확인합니다.'),
    'upload-permission': tr('첨부를 올릴 권한을 확인하지 못했습니다. 계정과 대화 상태를 확인해 주세요.'),
    'upload-conflict': tr('서버 첨부와 보관한 원본이 일치하지 않아 전송을 중단했습니다.'),
    'upload-expired': tr('업로드 세션이 만료되었습니다. 이 대기를 정리하고 파일을 다시 첨부해 주세요.'),
    'upload-metadata': tr('첨부 완료 정보를 확인하지 못했습니다. 다시 확인해 주세요.'),
    POSTING_RESTRICTED: tr('이 대화에 게시할 권한이 없습니다.'), NOT_PARTICIPANT: tr('대화 참여 권한이 없습니다.'),
    CHAT_MISSING: tr('대화를 찾을 수 없습니다.'), SUSPENDED: tr('현재 계정의 전송이 제한되어 있습니다.'),
    REPLY_MESSAGE_NOT_FOUND: tr('답장 원본이 없어 전송되지 않았습니다. 최신 대화에서 다시 작성해 주세요.'),
    UNAUTHORIZED: tr('로그인 상태를 다시 확인해 주세요.'), INVALID_PAYLOAD: tr('전송할 수 없는 내용입니다.'),
    CONFLICT: tr('서버 기록과 전송 정보가 일치하지 않습니다.'),
    DIRECT_CHAT_EXISTS: tr('이 상대와의 대화가 이미 있습니다. 대화 목록의 기존 대화에서 다시 보내 주세요.'),
    'ack-pending': tr('전송 결과를 확인하고 있습니다.'),
    'not-found': tr('전송 여부를 확인할 수 없습니다. 대화 기록을 확인해 주세요.'),
    'lookup-failed': tr('서버 기록을 확인하지 못했습니다. 다시 확인해 주세요.') } as Record<string, string>)[reason] ?? tr('전송 결과를 확인해야 합니다.')
}
