import { identifier, object } from './validation'
import { inquiryIdentifier } from './channel-inquiries'

// A room's history cleared for everyone, kept on this device until the server has it (A4 contract, user decision
// 2026-09-30): the boundary is fixed when the person presses — the last message this device had then — and every send
// of the request carries that same boundary, so it can go again as often as needed, as Telegram keeps max_id in its
// pending task and sends messages.deleteHistory again with it (telegram-refs R-3).
//   chat-clear: clearMorseChatHistory (Telegram's «clear history» for everyone; the room stays).
//   direct-delete: deleteDirectChatHistory (a private chat deleted for both; the room leaves the list).
//   inquiry-clear: clearMorseInquiryHistory (a channel inquiry room cleared for both).
export type HistoryClearKind = 'chat-clear' | 'direct-delete' | 'inquiry-clear'
// The request's `upTo` (A4 §3-1): the message id and its server time in milliseconds, rounded down.
export interface HistoryClearUpTo { messageId: string; createdAtMillis: number }
// `seen` is the room's last message time the person saw when they pressed ({seconds, nanoseconds}); the message itself
// is found at the first send, at or before it, and kept as `upTo`. Both null: the room had no message.
export interface HistoryClearRequest {
  id: string; kind: HistoryClearKind; targetId: string
  seen: { seconds: number; nanoseconds: number } | null
  upTo: HistoryClearUpTo | null
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
export function historyClearUpTo(raw: unknown): HistoryClearUpTo {
  const value = object(raw)
  const millis = value.createdAtMillis
  if (typeof millis !== 'number' || !Number.isSafeInteger(millis) || millis <= 0 || Object.keys(value).some(key => !['messageId', 'createdAtMillis'].includes(key))) throw new Error('Invalid history boundary')
  return { messageId: identifier(value.messageId), createdAtMillis: millis }
}
export function historyClearRequest(raw: unknown): HistoryClearRequest {
  const value = object(raw)
  if (typeof value.id !== 'string' || !uuid.test(value.id) || !['chat-clear', 'direct-delete', 'inquiry-clear'].includes(String(value.kind)) ||
      Object.keys(value).some(key => !['id', 'kind', 'targetId', 'seen', 'upTo'].includes(key))) throw new Error('Invalid history clear')
  let seen: HistoryClearRequest['seen'] = null
  if (value.seen !== null && value.seen !== undefined) {
    const at = object(value.seen), seconds = at.seconds, nanoseconds = at.nanoseconds
    if (typeof seconds !== 'number' || !Number.isSafeInteger(seconds) || seconds <= 0 || typeof nanoseconds !== 'number' || !Number.isSafeInteger(nanoseconds) ||
        nanoseconds < 0 || nanoseconds >= 1e9) throw new Error('Invalid history clear')
    seen = { seconds, nanoseconds }
  }
  const kind = value.kind as HistoryClearKind
  return { id: value.id, kind, targetId: kind === 'inquiry-clear' ? inquiryIdentifier(value.targetId) : identifier(value.targetId), seen, upTo: value.upTo === null || value.upTo === undefined ? null : historyClearUpTo(value.upTo) }
}
// A server Timestamp in whole milliseconds, rounded down (A4 §3-2: rounding up would move the boundary 1 ms later).
export function millisDown(at: { seconds: number; nanoseconds: number }): number { return at.seconds * 1000 + Math.floor(at.nanoseconds / 1e6) }
