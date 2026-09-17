import { backgroundPhotoId } from './chat-background'
import { identifier, object } from './validation'
import { replyBinding, type ReplyBinding } from './reply-draft'
import { maxThumbDataChars } from './media-metadata'
import { tr } from './i18n'

// A video message recorded here, the way Telegram Desktop records one (ui/controls/round_video_recorder.cpp):
// a square of kSide 400, at most kMaxDuration 60 seconds, the camera's centre with the microphone. It is sent
// as a round video (isCircleVideo) with its size, whole seconds and a thumbnail.
export const roundVideoSide = 400
export const maxRoundVideoSeconds = 60
export const maxRoundVideoBytes = 50 * 1024 * 1024
export interface RoundVideoFacts { duration: number; thumb: string }
export interface RoundVideoSendRequest extends RoundVideoFacts { id: string; chatId: string; reply: ReplyBinding | null }
function facts(value: Record<string, unknown>): RoundVideoFacts {
  if (typeof value.duration !== 'number' || !Number.isFinite(value.duration) || value.duration < .5 || value.duration > maxRoundVideoSeconds + 1) throw new Error(tr('0.5초에서 60초 사이의 영상 메시지만 보낼 수 있습니다.'))
  if (typeof value.thumb !== 'string' || value.thumb.length > maxThumbDataChars || (value.thumb && !/^[A-Za-z0-9+/]+={0,2}$/.test(value.thumb))) throw new Error(tr('영상 메시지 미리보기를 확인할 수 없습니다.'))
  return { duration: value.duration, thumb: value.thumb }
}
export function roundVideoSendRequest(raw: unknown): RoundVideoSendRequest {
  const value = object(raw)
  if (Object.keys(value).some(key => !['id', 'chatId', 'duration', 'thumb', 'reply'].includes(key))) throw new Error(tr('영상 메시지 전송 요청을 확인해 주세요.'))
  return { id: backgroundPhotoId(value.id), chatId: identifier(value.chatId), ...facts(value), reply: replyBinding(value.reply) }
}
export function roundVideoFacts(raw: unknown): RoundVideoFacts { return facts(object(raw)) }
