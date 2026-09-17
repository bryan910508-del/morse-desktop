import { replyBinding, type ReplyBinding } from './reply-draft'
import { draftText, identifier, object } from './validation'
import { tr } from './i18n'

// MorseDeferredOutgoingRequest: "예약 전송" (scheduledMessages) and "온라인시 보내기"
// (pendingOnlineMessages). The server sends the queued text at the time or when the peer is online.
export type DeferredKind = 'scheduled' | 'online'
export interface DeferredSendRequest { chatId: string; messageId: string; kind: DeferredKind; text: string; scheduledAt: number | null; silent: boolean; reply: ReplyBinding | null }
export interface DeferredItem { id: string; kind: DeferredKind; text: string; scheduledAt: number | null; failed: boolean }
export interface DeferredMessagesSnapshot { chatId: string; items: DeferredItem[] }

// Telegram limits scheduled messages to a year ahead.
export const maxScheduleAheadMs = 365 * 24 * 60 * 60 * 1000

export function deferredSendRequest(raw: unknown): DeferredSendRequest {
  const value = object(raw)
  if (value.kind !== 'scheduled' && value.kind !== 'online') throw new Error(tr('보내는 방식을 다시 선택해 주세요.'))
  if (typeof value.silent !== 'boolean') throw new Error(tr('보내는 방식을 다시 선택해 주세요.'))
  let scheduledAt: number | null = null
  if (value.kind === 'scheduled') {
    if (typeof value.scheduledAt !== 'number' || !Number.isSafeInteger(value.scheduledAt)) throw new Error(tr('예약 시간을 다시 선택해 주세요.'))
    scheduledAt = value.scheduledAt
  }
  return { chatId: identifier(value.chatId), messageId: identifier(value.messageId), kind: value.kind, text: draftText(value.text), scheduledAt, silent: value.silent, reply: replyBinding(value.reply) }
}
export function deferredKind(raw: unknown): DeferredKind {
  if (raw !== 'scheduled' && raw !== 'online') throw new Error(tr('예약된 메시지를 다시 확인해 주세요.'))
  return raw
}
