import type { ChatMessage, ForwardInfo } from './model'
import { identifier, object, outgoingText } from './validation'
import { maxAlbumPhotos } from './uploads'
import { tr } from './i18n'

export const maxForwardTargets = 10
export interface ForwardSource { chatId: string; messageId: string; version: string }
// official: a 1:1 whose other person is an official account (B178 §2-2).
export interface ForwardTarget { chatId: string; title: string; kind: 'direct' | 'group'; preview: string; official?: import('./model').OfficialKind }
export interface ForwardRequest { id: string; source: ForwardSource; targets: { chatId: string; messageId: string }[] }
export interface ForwardProgress { operationId: string; phase: 'preparing' | 'saving'; current: number; count: number; loaded: number; total: number | null }
export function forwardSource(raw: unknown): ForwardSource {
  const value = object(raw)
  if (typeof value.version !== 'string' || !/^\d{1,12}:\d{1,9}$/.test(value.version)) throw new Error(tr('최신 원본 메시지를 다시 선택해 주세요.'))
  return { chatId: identifier(value.chatId), messageId: identifier(value.messageId), version: value.version }
}
// A chat forward goes into chats: a 1:1 inquiry room, named in the queue by its client id (sub_inq_<id>,
// channel-inquiries.ts inquiryOfQueueChatId), is reached through its own request (inquiryForwardRequest), never as a chat.
export const chatTarget = (chatId: string): boolean => !chatId.startsWith('sub_inq_')
export function forwardRequest(raw: unknown): ForwardRequest {
  const value = object(raw), source = forwardSource(value.source)
  if (!Array.isArray(value.targets) || !value.targets.length || value.targets.length > maxForwardTargets) throw new Error(tr('전달할 대화를 {0}개 이내로 선택해 주세요.', [maxForwardTargets]))
  const targets = value.targets.map(raw => { const item = object(raw); return { chatId: identifier(item.chatId), messageId: identifier(item.messageId) } })
  // Saved Messages is a target like any other — Telegram offers it first of all (ChatsListBoxController::rebuildRows) —
  // and so is the room the message is already in (B282). A copy never takes the original's id.
  if (new Set(targets.map(item => item.chatId)).size !== targets.length || new Set(targets.map(item => item.messageId)).size !== targets.length ||
      targets.some(item => item.messageId === source.messageId || !chatTarget(item.chatId))) throw new Error(tr('전달할 다른 대화를 확인해 주세요.'))
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
// A message already in it is offered it too (B282 — tdesktop's share list puts the account's own history first whatever
// is shared, share_box.cpp:850-854).
export function savedMessagesFirst(targets: readonly ForwardTarget[], savedId: string,
  offered: ForwardTarget | null, roomExists: boolean): ForwardTarget[] {
  const rest = targets.filter(target => target.chatId !== savedId)
  if (offered) return [offered, ...rest]
  if (roomExists) return rest
  return [{ chatId: savedId, title: tr('저장한 메시지'), kind: 'direct', preview: '' }, ...rest]
}
// B263 §2-2: a message's forwardInfo, read the same from a Firestore document (its fields made plain, the date in ms), the
// socket's newMessage and an inquiry room. Version 1 only; a malformed one is no header — never a made-up name.
const forwardIdShape = /^[A-Za-z0-9_-]{1,160}$/
export function forwardInfoFrom(raw: unknown): ForwardInfo | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  if (value.v !== undefined && value.v !== 1) return null
  const id = (key: string): string | undefined => typeof value[key] === 'string' && forwardIdShape.test(value[key] as string) ? value[key] as string : undefined
  const hidden = value.hidden === true, fromUid = hidden ? undefined : id('fromUid')
  const fromChannelId = id('fromChannelId'), channelPostId = fromChannelId ? id('channelPostId') : undefined
  const fromName = typeof value.fromName === 'string' ? value.fromName.trim().slice(0, 256) : ''
  if (!hidden && !fromUid && !fromChannelId && !fromName) return null
  const date = typeof value.date === 'number' && Number.isFinite(value.date) && value.date > 0 ? Math.trunc(value.date) : null
  return { ...(fromUid ? { fromUid } : {}), fromName, ...(fromChannelId ? { fromChannelId, ...(channelPostId ? { channelPostId } : {}) } : {}), date, hidden }
}

// B263: what the «Forwarded from» header names and where it leads, as tdesktop HistoryMessageForwarded::create links it
// (history_item_components.cpp:388-392): a channel to the post, a person to them, a hidden sender to the notice. B266: a
// person — contact or not — opens as a person (PeerClickHandler → showPeer → showPeerInfo for a user, data_peer.cpp:281-301,
// window_session_controller.cpp:2846-2847), never their chat.
export type ForwardAction = { kind: 'person'; uid: string } | { kind: 'channel'; channelId: string; postId: string | null } | { kind: 'hidden' }
export function forwardHeaderOf(forward: ForwardInfo, people: { self: string; contactName: string }): { name: string; action: ForwardAction | null } {
  if (forward.fromChannelId) return { name: forward.fromName || tr('채널'), action: { kind: 'channel', channelId: forward.fromChannelId, postId: forward.channelPostId ?? null } }
  if (forward.hidden) return forward.fromName ? { name: forward.fromName, action: { kind: 'hidden' } } : { name: tr('탈퇴한 계정'), action: null }
  const uid = forward.fromUid
  const name = people.contactName || forward.fromName || tr('알 수 없는 사용자')
  return { name, action: uid && uid !== people.self ? { kind: 'person', uid } : null }
}
