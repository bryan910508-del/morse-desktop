import { backgroundPhotoId } from './chat-background'
import { identifier, object } from './validation'
import { tr } from './i18n'

// ChannelInquiryService: one 1:1 room per channel and subscriber (channelInquiries/{channelId}_{subscriberId}).
export type InquiryRole = 'owner' | 'subscriber'
export type InquiryMessageKind = 'text' | 'image' | 'video' | 'voice' | 'file' | 'sticker' | 'location' | 'event'
export interface InquirySummary { id: string; peerUid: string; channelId: string; channelName: string; peerName: string; lastMessage: string; lastMessageAt: number | null; unread: number; photo?: import('./group-photo').GroupPhotoImage | null }
export interface InquiryMessageItem { id: string; own: boolean; senderType: InquiryRole; kind: InquiryMessageKind; text: string; label: string; createdAt: number | null; edited: boolean
  // The room's auto-delete notice, written by the server as a system message.
  system?: true
  // A photo is opened the way a chat attachment is: the version pins the document the bytes belong to.
  version: string; attachments?: import('./media').AttachmentSummary[]
  // A video's size, length and placeholder, a voice message's length and waveform - read as a chat message's.
  mediaMetadata?: import('./media-metadata').MediaMetadata; circular?: true }
export interface InquiryListSnapshot { requestId: string; channelId: string; status: 'loading' | 'ready' | 'error'; items: InquirySummary[]; message: string }
export interface InquiryThreadSnapshot {
  requestId: string; inquiryId: string; channelId: string; role: InquiryRole; title: string; channelName: string
  status: 'loading' | 'ready' | 'error'; items: InquiryMessageItem[]; message: string
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
export function inquiryEditRequest(raw: unknown): InquiryTextRequest {
  const value = object(raw); keys(value, ['requestId', 'inquiryId', 'messageId', 'text'])
  return { ...inquiryTargetRequest({ requestId: value.requestId, inquiryId: value.inquiryId, messageId: value.messageId }), text: inquiryText(value.text) }
}
// ChannelInquiryService.sendMessage uses UUID().uuidString as the client message id.
const clientMessageId = /^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/
export function inquirySendRequest(raw: unknown): InquiryTextRequest {
  const request = inquiryEditRequest(raw)
  if (!clientMessageId.test(request.messageId)) throw new Error(tr('메시지를 다시 보내 주세요.'))
  return request
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
export interface InquiryVoiceRequest extends InquiryTargetRequest { duration: number; waveform: number[]; captureId: string; sha256: string }
// The microphone grant a recording holds, named by the recording's own id and its room.
export interface InquiryVoiceTarget extends InquiryThreadRequest { captureId: string }
export function inquiryVoiceTarget(raw: unknown): InquiryVoiceTarget {
  const value = object(raw); keys(value, ['requestId', 'inquiryId', 'captureId'])
  return { ...inquiryThreadRequest({ requestId: value.requestId, inquiryId: value.inquiryId }), captureId: backgroundPhotoId(value.captureId) }
}
export function inquiryVoiceRequest(raw: unknown): InquiryVoiceRequest {
  const value = object(raw); keys(value, ['requestId', 'inquiryId', 'messageId', 'duration', 'waveform', 'captureId', 'sha256'])
  const target = inquiryTargetRequest({ requestId: value.requestId, inquiryId: value.inquiryId, messageId: value.messageId })
  if (!clientMessageId.test(target.messageId)) throw new Error(tr('음성 메시지를 다시 보내 주세요.'))
  if (typeof value.duration !== 'number' || !Number.isFinite(value.duration) || value.duration < .5 || value.duration > 61) throw new Error(tr('0.5초에서 60초 사이의 음성만 보낼 수 있습니다.'))
  if (!Array.isArray(value.waveform) || !value.waveform.length || value.waveform.length > 64 ||
      value.waveform.some(level => typeof level !== 'number' || !Number.isFinite(level) || level < 0 || level > 1)) throw new Error(tr('음성 파형을 확인할 수 없습니다.'))
  if (typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)) throw new Error(tr('녹음 원본을 다시 확인해 주세요.'))
  return { ...target, duration: value.duration, waveform: [...value.waveform as number[]], captureId: backgroundPhotoId(value.captureId), sha256: value.sha256 }
}

// A video or file picked for an inquiry (ChannelInquiryChatView also sends these), staged in the main process.
export type InquiryAttachmentMode = 'video' | 'file'
export interface InquiryAttachmentRequest extends InquiryTargetRequest { draftId: string; itemId: string; caption: string }
export function inquiryAttachmentRequest(raw: unknown): InquiryAttachmentRequest {
  const value = object(raw); keys(value, ['requestId', 'inquiryId', 'messageId', 'draftId', 'itemId', 'caption'])
  const target = inquiryTargetRequest({ requestId: value.requestId, inquiryId: value.inquiryId, messageId: value.messageId })
  if (!clientMessageId.test(target.messageId)) throw new Error(tr('첨부를 다시 보내 주세요.'))
  if (typeof value.caption !== 'string' || value.caption.length > maxInquiryCaption) throw new Error(tr('설명을 확인해 주세요.'))
  return { ...target, draftId: identifier(value.draftId), itemId: identifier(value.itemId), caption: value.caption.trim() }
}
export interface InquiryPhotoRequest extends InquiryTargetRequest { caption: string }
export function inquiryPhotoRequest(raw: unknown): InquiryPhotoRequest {
  const value = object(raw); keys(value, ['requestId', 'inquiryId', 'messageId', 'caption'])
  const target = inquiryTargetRequest({ requestId: value.requestId, inquiryId: value.inquiryId, messageId: value.messageId })
  if (!clientMessageId.test(target.messageId)) throw new Error(tr('사진을 다시 보내 주세요.'))
  if (typeof value.caption !== 'string' || value.caption.length > maxInquiryCaption) throw new Error(tr('사진 설명을 확인해 주세요.'))
  return { ...target, caption: value.caption }
}
