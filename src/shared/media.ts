import { identifier, object } from './validation'
import { tr } from './i18n'

export type AttachmentKind = 'image' | 'video' | 'voice' | 'file' | 'sticker'
export interface AttachmentSummary {
  index: number
  kind: AttachmentKind
  name: string
  available: boolean
  blind: boolean
}
export interface MediaRequest {
  requestId: string
  messageId: string
  version: string
  index: number
}
export interface MediaReady {
  requestId: string
  url: string | null
  presentation: 'image' | 'video' | 'audio' | 'file'
  name: string
  size: number
}
export function mediaRequest(value: unknown): MediaRequest {
  const input = object(value)
  if (typeof input.version !== 'string' || !/^\d{1,12}:\d{1,9}$/.test(input.version) ||
      typeof input.index !== 'number' || !Number.isSafeInteger(input.index) || input.index < 0 || input.index >= 1000) throw new Error(tr('첨부 선택을 확인해 주세요.'))
  return { requestId: identifier(input.requestId), messageId: identifier(input.messageId), version: input.version, index: input.index }
}
