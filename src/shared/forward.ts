import type { ChatMessage } from './model'
import { identifier, object, outgoingText } from './validation'
import { maxAlbumPhotos } from './uploads'
import { tr } from './i18n'

export const maxForwardTargets = 10
export interface ForwardSource { chatId: string; messageId: string; version: string }
export interface ForwardTarget { chatId: string; title: string; kind: 'direct' | 'group'; preview: string }
export interface ForwardRequest { id: string; source: ForwardSource; targets: { chatId: string; messageId: string }[] }
export interface ForwardProgress { operationId: string; phase: 'preparing' | 'saving'; current: number; count: number; loaded: number; total: number | null }
export function forwardSource(raw: unknown): ForwardSource {
  const value = object(raw)
  if (typeof value.version !== 'string' || !/^\d{1,12}:\d{1,9}$/.test(value.version)) throw new Error(tr('최신 원본 메시지를 다시 선택해 주세요.'))
  return { chatId: identifier(value.chatId), messageId: identifier(value.messageId), version: value.version }
}
export function forwardRequest(raw: unknown): ForwardRequest {
  const value = object(raw), source = forwardSource(value.source)
  if (!Array.isArray(value.targets) || !value.targets.length || value.targets.length > maxForwardTargets) throw new Error(tr('전달할 대화를 {0}개 이내로 선택해 주세요.', [maxForwardTargets]))
  const targets = value.targets.map(raw => { const item = object(raw); return { chatId: identifier(item.chatId), messageId: identifier(item.messageId) } })
  // Saved Messages is a target like any other — Telegram offers it first of all
  // (ChatsListBoxController::rebuildRows). Only the room the message is already in is refused.
  if (new Set(targets.map(item => item.chatId)).size !== targets.length || new Set(targets.map(item => item.messageId)).size !== targets.length ||
      targets.some(item => item.chatId === source.chatId)) throw new Error(tr('전달할 다른 대화를 확인해 주세요.'))
  return { id: identifier(value.id), source, targets: targets.sort((a, b) => a.chatId.localeCompare(b.chatId, 'en')) }
}
export function canForwardText(message: ChatMessage): boolean {
  if (message.kind !== 'text' || !message.serverConfirmed || !message.readEligible || message.encrypted || message.system || !message.version) return false
  try { outgoingText(message.text); return true } catch { return false }
}
export function canForwardMedia(message: ChatMessage): boolean {
  const parts = message.attachments
  return ['image', 'video', 'file', 'voice', 'sticker'].includes(message.kind) && message.mediaMetadata !== null && message.serverConfirmed && message.readEligible &&
    !message.encrypted && !message.system && Boolean(message.version) && Boolean(parts?.length && parts.length <= maxAlbumPhotos &&
    (message.kind === 'image' || parts.length === 1) && parts.every((part, index) => part.index === index && part.kind === message.kind && part.available))
}
export const canForwardMessage = (message: ChatMessage): boolean => canForwardText(message) || canForwardMedia(message)

// Saved Messages leads the forward list. Telegram's list always holds it: it is the account's own peer,
// so ChatsListBoxController::rebuildRows adds `history(session().user())` with nothing to check, and
// peerListPartitionRows(isSelf) then puts it above the chats — above the pinned ones as well. Morse
// keeps it in a room the server makes on first use, so `offered` is null until that has happened, and
// the room being absent is not a reason to leave it out: the window makes the room before it sends.
// The one case that does leave it out is the message already being in it.
export function savedMessagesFirst(targets: readonly ForwardTarget[], savedId: string, sourceChatId: string,
  offered: ForwardTarget | null, roomExists: boolean): ForwardTarget[] {
  const rest = targets.filter(target => target.chatId !== savedId)
  if (offered) return [offered, ...rest]
  if (sourceChatId === savedId || roomExists) return rest
  return [{ chatId: savedId, title: tr('저장한 메시지'), kind: 'direct', preview: '' }, ...rest]
}
