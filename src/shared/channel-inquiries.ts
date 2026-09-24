import { backgroundPhotoId } from './chat-background'
import { positionAt, type ChatMessage } from './model'
import { forwardSource, maxForwardTargets } from './forward'
import { identifier, object } from './validation'
import { autoDeleteSecondsValue } from './chat-auto-delete'
import { chatListPreviewText } from './chat-list-preview'
import { tr } from './i18n'

// ChannelInquiryService: one 1:1 room per channel and subscriber (channelInquiries/{channelId}_{subscriberId}).
export type InquiryRole = 'owner' | 'subscriber'
export type InquiryMessageKind = 'text' | 'image' | 'video' | 'voice' | 'file' | 'sticker' | 'location' | 'event'
export interface InquirySummary { id: string; peerUid: string; channelId: string; channelName: string; peerName: string; lastMessage: string; lastMessageAt: number | null; unread: number; photo?: import('./group-photo').GroupPhotoImage | null }
export interface InquiryMessageItem { id: string; own: boolean; senderType: InquiryRole; kind: InquiryMessageKind; text: string; label: string; createdAt: number | null; edited: boolean
  // The message this one answers, and a few words of it, as a chat's reply carries (HistoryMessageReply).
  replyToId?: string; reply?: import('./model').ReplyPreview
  // The room's auto-delete notice, written by the server as a system message.
  system?: true
  // A photo is opened the way a chat attachment is: the version pins the document the bytes belong to.
  version: string; attachments?: import('./media').AttachmentSummary[]
  // A video's size, length and placeholder, a voice message's length and waveform - read as a chat message's.
  mediaMetadata?: import('./media-metadata').MediaMetadata; circular?: true
  // The room's reactions, kept on the message as a chat's are (setMorseMessageReaction with the inquiry).
  reactions?: import('./model').ChatMessage['reactions'] }
export interface InquiryListSnapshot { requestId: string; channelId: string; status: 'loading' | 'ready' | 'error'; items: InquirySummary[]; message: string }
export interface InquiryThreadSnapshot {
  requestId: string; inquiryId: string; channelId: string; role: InquiryRole; title: string; channelName: string
  status: 'loading' | 'ready' | 'error'; items: InquiryMessageItem[]; message: string
  // «모두에게 고정»: the ids the room document keeps, newest first, as a chat keeps them.
  pinnedIds: string[]
  // The room's auto-delete policy, kept on the room document as a chat keeps its own.
  autoDeleteSeconds: number; autoDeleteMyOnly: boolean
  // «예약 전송» of this room, queued on the server (scheduledMessages with this room's inquiryId).
  scheduled: import('./deferred-send').DeferredItem[]
  // How far the other side has read what this account sent (a chat's outboxRead).
  outboxRead: import('./read-receipts').ReadCursor | null
}
export interface ChannelInquiriesSnapshot { list: InquiryListSnapshot | null; thread: InquiryThreadSnapshot | null }
export interface InquiryListRequest { requestId: string; channelId: string }
export interface InquiryThreadRequest { requestId: string; inquiryId: string }
export interface InquiryTargetRequest extends InquiryThreadRequest { messageId: string }
export interface InquiryTextRequest extends InquiryTargetRequest { text: string }
// Server canonicalMessage and the messages update rule: text up to 30,000 characters.
export const maxInquiryText = 30000

function keys(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error(tr('문의를 다시 열어 주세요.'))
}
export function inquiryIdentifier(raw: unknown): string {
  if (typeof raw !== 'string' || !/^[A-Za-z0-9_-]{3,330}$/.test(raw) || !raw.includes('_')) throw new Error(tr('문의를 다시 선택해 주세요.'))
  return raw
}
export function inquiryText(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > maxInquiryText || raw.startsWith('__TALKY_AUTODEL__:') || raw.startsWith('__deleted__:')) throw new Error(tr('메시지 내용을 확인해 주세요.'))
  return raw
}
export function inquiryListRequest(raw: unknown): InquiryListRequest {
  const value = object(raw); keys(value, ['requestId', 'channelId'])
  return { requestId: backgroundPhotoId(value.requestId), channelId: identifier(value.channelId) }
}
export function inquiryThreadRequest(raw: unknown): InquiryThreadRequest {
  const value = object(raw); keys(value, ['requestId', 'inquiryId'])
  return { requestId: backgroundPhotoId(value.requestId), inquiryId: inquiryIdentifier(value.inquiryId) }
}
export function inquiryTargetRequest(raw: unknown): InquiryTargetRequest {
  const value = object(raw); keys(value, ['requestId', 'inquiryId', 'messageId'])
  return { ...inquiryThreadRequest({ requestId: value.requestId, inquiryId: value.inquiryId }), messageId: identifier(value.messageId) }
}
export interface InquiryReactionRequest extends InquiryTargetRequest { reactions: string[] }
export function inquiryReactionRequest(raw: unknown): InquiryReactionRequest {
  const value = object(raw); keys(value, ['requestId', 'inquiryId', 'messageId', 'reactions'])
  const reactions = value.reactions
  if (!Array.isArray(reactions) || reactions.length > 20 || reactions.some(emoji => typeof emoji !== 'string' || !emoji.length || emoji.length > 32)) throw new Error(tr('반응은 20개까지 선택할 수 있습니다.'))
  return { ...inquiryTargetRequest({ requestId: value.requestId, inquiryId: value.inquiryId, messageId: value.messageId }), reactions: [...new Set(reactions as string[])].sort() }
}
export function inquiryPinRequest(raw: unknown): InquiryTargetRequest & { pinned: boolean } {
  const value = object(raw); keys(value, ['requestId', 'inquiryId', 'messageId', 'pinned'])
  if (typeof value.pinned !== 'boolean') throw new Error(tr('고정할지 여부를 확인해 주세요.'))
  return { ...inquiryTargetRequest({ requestId: value.requestId, inquiryId: value.inquiryId, messageId: value.messageId }), pinned: value.pinned }
}
// The room's policy: one of the durations the server accepts.
export interface InquiryAutoDeleteRequest extends InquiryThreadRequest { seconds: number }
export function inquiryAutoDeleteRequest(raw: unknown): InquiryAutoDeleteRequest {
  const value = object(raw); keys(value, ['requestId', 'inquiryId', 'seconds'])
  if (typeof value.seconds !== 'number' || autoDeleteSecondsValue(value.seconds) !== value.seconds) throw new Error(tr('자동 삭제 시간을 다시 선택해 주세요.'))
  return { ...inquiryThreadRequest({ requestId: value.requestId, inquiryId: value.inquiryId }), seconds: value.seconds }
}
export function inquiryEditRequest(raw: unknown): InquiryTextRequest {
  const value = object(raw); keys(value, ['requestId', 'inquiryId', 'messageId', 'text'])
  return { ...inquiryTargetRequest({ requestId: value.requestId, inquiryId: value.inquiryId, messageId: value.messageId }), text: inquiryText(value.text) }
}
// The message a send answers: one of the same room, named as the client names every message.
export function inquiryReplyTo(raw: unknown): { replyToId?: string } {
  if (raw === undefined || raw === null) return {}
  return { replyToId: identifier(raw) }
}
// A room this account may forward into: one row of the «전달» sheet beside the chats.
export interface InquiryForwardRoom { inquiryId: string; channelId: string; title: string; role: InquiryRole }
export interface InquiryForwardRequest { id: string; source: import('./forward').ForwardSource; inquiryIds: string[] }
export function inquiryForwardRequest(raw: unknown): InquiryForwardRequest {
  const value = object(raw); keys(value, ['id', 'source', 'inquiryIds'])
  if (!Array.isArray(value.inquiryIds) || !value.inquiryIds.length || value.inquiryIds.length > maxForwardTargets) throw new Error(tr('전달할 대화를 {0}개 이내로 선택해 주세요.', [maxForwardTargets]))
  const inquiryIds = value.inquiryIds.map(inquiryIdentifier)
  if (new Set(inquiryIds).size !== inquiryIds.length) throw new Error(tr('전달할 다른 대화를 확인해 주세요.'))
  const source = forwardSource(value.source)
  if (inquiryIds.includes(inquiryOfQueueChatId(source.chatId))) throw new Error(tr('전달할 다른 대화를 확인해 주세요.'))
  return { id: identifier(value.id), source, inquiryIds }
}

// A room's message in the shape every message view — and the forward machinery — already speaks. A room is read by
// both of its participants as it arrives, so a message of it is as readable as a chat's (readEligible).
export function inquiryChatMessage(item: InquiryMessageItem, inquiryId: string): ChatMessage {
  const media = Boolean(item.attachments?.length) && item.kind !== 'text'
  const plain = !media && item.kind !== 'text'
  return { id: item.id, chatId: inquiryId, senderId: item.own ? 'me' : 'peer', kind: plain ? 'text' : item.kind,
    text: item.kind === 'text' ? item.text : plain ? [item.label, item.text].filter(Boolean).join('\n') : '', caption: media ? item.text : '',
    attachments: item.attachments, mediaMetadata: item.mediaMetadata ?? null, circular: item.circular ?? false, position: positionAt(item.createdAt ?? 0, item.id), version: item.version,
    ...(item.replyToId ? { replyToId: item.replyToId } : {}), ...(item.reply ? { reply: item.reply } : {}),
    serverConfirmed: true, encrypted: false, silent: false, state: 'sent', readEligible: true, edited: item.edited, system: item.system === true, reactions: item.reactions ?? [] } as ChatMessage
}

// «예약 전송» in an inquiry room. The queue document names the room, and its chatId is the client's
// id of that room, which firestore.rules requires: chatId == 'sub_inq_' + inquiryId.
export const inquiryQueueChatId = (inquiryId: string): string => `sub_inq_${inquiryId}`

// An inquiry room's list line as the server writes it (functions morse-message-preview.js lastMessagePreview): a text
// as written, every other kind as an English label, shown here with the words the history uses for the same kinds
// (history/message.tsx), as Telegram names a kind in the chat list (lng_in_dlg_photo, lng_in_dlg_audio ...). A line
// written before the server described media is a storage URL, shown as a photo. Only an inquiry's line comes here:
// in a chat's line a text that reads "Event" is someone's own word.
// The address is read rather than matched: a written `https://…googleapis.com:443/…` is the same
// address, and a pattern anchored on the «.com/» after the host does not see it, which would put the
// whole storage address in the room's line. `new URL()` normalises the default port away, and an
// address it cannot read is simply not one.
function storageAddress(raw: string): boolean {
  try { const url = new URL(raw); return url.protocol === 'https:' && url.hostname === 'firebasestorage.googleapis.com' } catch { return false }
}
export function inquiryPreviewText(raw: string): string {
  switch (raw) {
    case '📷 Photo': return tr('사진')
    case '🎬 Video': return tr('동영상')
    case '🎤 Voice message': return tr('음성 메시지')
    case '📎 File': return tr('파일')
    case 'Sticker': return tr('스티커')
    case 'Location': return tr('위치')
    case 'Event': return tr('일정')
    // A line another client wrote carries its own language's label, told apart by the picture it
    // starts with, as a chat's line is (chat-list-preview.ts).
    default: return storageAddress(raw) ? tr('사진') : chatListPreviewText(raw)
  }
}
// The room a client id names, if it names one. A forward out of a room carries the room this way, so nothing
// mistakes it for a chat of the same name.
export function inquiryOfQueueChatId(chatId: unknown): string {
  const raw = typeof chatId === 'string' && chatId.startsWith('sub_inq_') ? chatId.slice('sub_inq_'.length) : ''
  return raw ? inquiryIdentifier(raw) : ''
}
export interface InquiryScheduleRequest extends InquiryTextRequest { scheduledAt: number }
export function inquiryScheduleRequest(raw: unknown): InquiryScheduleRequest {
  const value = object(raw); keys(value, ['requestId', 'inquiryId', 'messageId', 'text', 'scheduledAt'])
  if (typeof value.scheduledAt !== 'number' || !Number.isSafeInteger(value.scheduledAt)) throw new Error(tr('예약 시간을 다시 선택해 주세요.'))
  return { ...inquirySendRequest({ requestId: value.requestId, inquiryId: value.inquiryId, messageId: value.messageId, text: value.text }), scheduledAt: value.scheduledAt }
}
// ChannelInquiryService.sendMessage uses UUID().uuidString as the client message id.
const clientMessageId = /^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/
export function inquirySendRequest(raw: unknown): InquiryTextRequest & { replyToId?: string } {
  const value = object(raw); keys(value, ['requestId', 'inquiryId', 'messageId', 'text', 'replyToId'])
  const request = inquiryEditRequest({ requestId: value.requestId, inquiryId: value.inquiryId, messageId: value.messageId, text: value.text })
  if (!clientMessageId.test(request.messageId)) throw new Error(tr('메시지를 다시 보내 주세요.'))
  return { ...request, ...inquiryReplyTo(value.replyToId) }
}

// ChatListView merges inquiry rooms into the chat list (MorseListStorageChatId): a subscriber sees
// one row per inquiry, an owner one folder row per channel holding that channel's rooms.
export type InquiryRowKind = 'subscriber' | 'ownerFolder'
export interface InquiryRow {
  id: string
  kind: InquiryRowKind
  channelId: string
  // The room to open for a subscriber row; an owner row opens that channel's list instead.
  inquiryId: string | null
  title: string
  preview: string
  lastMessageAt: number | null
  unread: number
  rooms: number
  photo?: import('./group-photo').GroupPhotoImage | null
}
export const subscriberRowId = (inquiryId: string): string => `sub_inq_${inquiryId}`
export const ownerRowId = (channelId: string): string => `own_inq_${channelId}`

// A photo send: the picked bytes are re-encoded to JPEG, so storage.rules isValidImage (under 10 MB,
// image/*) holds, and the caption travels as imageCaption like ChannelInquiryChatView does.
export const maxInquiryPhotoBytes = 10 * 1024 * 1024
export const maxInquiryCaption = 3000
// A voice message recorded for an inquiry, as ChannelInquiryChatView.uploadAndSendVoice sends one: whole
// seconds (at least 1) and the 36 levels MorseVoiceRecordingSession keeps, each between 0 and 1.
export interface InquiryVoiceRequest extends InquiryTargetRequest { duration: number; waveform: number[]; captureId: string; sha256: string; replyToId?: string }
// The microphone grant a recording holds, named by the recording's own id and its room.
export interface InquiryVoiceTarget extends InquiryThreadRequest { captureId: string }
export function inquiryVoiceTarget(raw: unknown): InquiryVoiceTarget {
  const value = object(raw); keys(value, ['requestId', 'inquiryId', 'captureId'])
  return { ...inquiryThreadRequest({ requestId: value.requestId, inquiryId: value.inquiryId }), captureId: backgroundPhotoId(value.captureId) }
}
export function inquiryVoiceRequest(raw: unknown): InquiryVoiceRequest {
  const value = object(raw); keys(value, ['requestId', 'inquiryId', 'messageId', 'duration', 'waveform', 'captureId', 'sha256', 'replyToId'])
  const target = inquiryTargetRequest({ requestId: value.requestId, inquiryId: value.inquiryId, messageId: value.messageId })
  if (!clientMessageId.test(target.messageId)) throw new Error(tr('음성 메시지를 다시 보내 주세요.'))
  if (typeof value.duration !== 'number' || !Number.isFinite(value.duration) || value.duration < .5 || value.duration > 61) throw new Error(tr('0.5초에서 60초 사이의 음성만 보낼 수 있습니다.'))
  if (!Array.isArray(value.waveform) || !value.waveform.length || value.waveform.length > 64 ||
      value.waveform.some(level => typeof level !== 'number' || !Number.isFinite(level) || level < 0 || level > 1)) throw new Error(tr('음성 파형을 확인할 수 없습니다.'))
  if (typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)) throw new Error(tr('녹음 원본을 다시 확인해 주세요.'))
  return { ...target, duration: value.duration, waveform: [...value.waveform as number[]], captureId: backgroundPhotoId(value.captureId), sha256: value.sha256, ...inquiryReplyTo(value.replyToId) }
}

// A video or file picked for an inquiry (ChannelInquiryChatView also sends these), staged in the main process.
export type InquiryAttachmentMode = 'video' | 'file'
export interface InquiryAttachmentRequest extends InquiryTargetRequest { draftId: string; itemId: string; caption: string; replyToId?: string }
export function inquiryAttachmentRequest(raw: unknown): InquiryAttachmentRequest {
  const value = object(raw); keys(value, ['requestId', 'inquiryId', 'messageId', 'draftId', 'itemId', 'caption', 'replyToId'])
  const target = inquiryTargetRequest({ requestId: value.requestId, inquiryId: value.inquiryId, messageId: value.messageId })
  if (!clientMessageId.test(target.messageId)) throw new Error(tr('첨부를 다시 보내 주세요.'))
  if (typeof value.caption !== 'string' || value.caption.length > maxInquiryCaption) throw new Error(tr('설명을 확인해 주세요.'))
  return { ...target, draftId: identifier(value.draftId), itemId: identifier(value.itemId), caption: value.caption.trim(), ...inquiryReplyTo(value.replyToId) }
}
export interface InquiryPhotoRequest extends InquiryTargetRequest { caption: string; replyToId?: string }
export function inquiryPhotoRequest(raw: unknown): InquiryPhotoRequest {
  const value = object(raw); keys(value, ['requestId', 'inquiryId', 'messageId', 'caption', 'replyToId'])
  const target = inquiryTargetRequest({ requestId: value.requestId, inquiryId: value.inquiryId, messageId: value.messageId })
  if (!clientMessageId.test(target.messageId)) throw new Error(tr('사진을 다시 보내 주세요.'))
  if (typeof value.caption !== 'string' || value.caption.length > maxInquiryCaption) throw new Error(tr('사진 설명을 확인해 주세요.'))
  return { ...target, caption: value.caption, ...inquiryReplyTo(value.replyToId) }
}
