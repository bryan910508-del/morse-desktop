import { createHash, randomUUID } from 'node:crypto'
import type { ChannelInquiriesSnapshot, InquiryAttachmentMode, InquiryAttachmentRequest, InquiryAutoDeleteRequest, InquiryVoiceRequest, InquiryListRequest, InquiryListSnapshot, InquiryMessageItem, InquiryMessageKind, InquiryPhotoRequest, InquiryReactionRequest, InquiryRole, InquirySummary,
  InquiryScheduleRequest, InquiryTargetRequest, InquiryTextRequest, InquiryThreadRequest, InquiryThreadSnapshot } from '../../shared/channel-inquiries'
import { inquiryChatMessage, inquiryPreviewText, inquiryQueueChatId, maxInquiryPhotoBytes } from '../../shared/channel-inquiries'
import type { HistoryClearRequest } from '../../shared/history-clears'
import type { ForwardMediaSource } from '../media/forward-media'
import type { PreparedForwardMedia } from '../storage/forward-media-protocol'
import { maxScheduleAheadMs } from '../../shared/deferred-send'
import { readCursor, type ReadCursor } from '../../shared/read-receipts'
import { DeferredMessages, deferredCollections, deferredFields, type DeferredWireValue } from './deferred-messages'
import { ExpiredMessages, nextExpiry } from './expired-messages'
import type { MediaRequest } from '../../shared/media'
import { positionMilliseconds, type ReplyPreview } from '../../shared/model'
import { mediaResources, type MediaResource } from '../media/media-document'
import { messageMediaMetadata } from '../media/message-media-metadata'
import { DocumentWriteFailure, FirestoreReader, type ReadCredentials } from '../network/firestore-rpc'
import { autoDeleteNoticeFields, boolField, documents, documentVersion, mapField, messageReactions, numberField, pinnedMessageIds, ReadFailure, stringField, timestamp, type FirestoreDocument, type WireObject } from '../network/firestore-values'
import { autoDeleteNoticeText, autoDeleteWirePrefix } from '../../shared/auto-delete-notice'
import { setMessageReaction } from '../network/message-reaction-api'
import { autoDeleteSecondsValue } from '../../shared/chat-auto-delete'
import { freePinLimit } from '../../shared/pinned-messages'
import { inquiryAttachmentExtension, inquiryAttachmentPath, maxInquiryAttachmentBytes } from '../network/inquiry-photo-upload-api'
import type { InquirySendRequest } from './inquiry-sends'
import { AttachmentStaging } from '../media/attachment-staging'
import { forwardMediaFormat } from '../media/forward-media-format'
import { mediaType } from '../media/media-type'
import { maxVoiceCaptureBytes } from '../../shared/voice-capture'
import { stickerSidePx } from '../../shared/stickers'
import type { AttachmentDraft, VideoFacts } from '../../shared/uploads'
import { callMorseFunction, MorseCallableFailure } from '../network/morse-callable'
import type { PeoplePhotoResolver } from './channel-people-photos'
import type { ContactCreateFields } from '../network/participant-contact-write'
import { ReactionUpdates } from './reaction-updates'
import { tr } from '../../shared/i18n'

interface Inquiry extends InquirySummary { role: InquiryRole; cutoff: number | null; autoDeleteSeconds: number; autoDeleteMyOnly: boolean; outboxRead: ReadCursor | null }
interface ListState { request: InquiryListRequest; stop: (() => void) | null; value: InquiryListSnapshot }
// The listened documents stay so an explicit photo selection can be resolved against the same row.
interface ThreadState { request: InquiryThreadRequest; stop: (() => void) | null; roomStop: (() => void) | null; inquiry: Inquiry | null; marked: string; marking: boolean
  // What the room keeps about the person on the other side: their photo address (ChannelPeoplePhotos
  // resolves it) and whether the account is gone.
  peer: { photo: string; deleted: boolean }
  rows: Map<string, FirestoreDocument>; value: InquiryThreadSnapshot; expiryTimer?: ReturnType<typeof setTimeout>; expired?: ExpiredMessages
  reactionUpdates: ReactionUpdates }

const kinds: readonly string[] = ['text', 'image', 'video', 'voice', 'file', 'sticker', 'location', 'event']
const labels: Record<string, string> = { image: tr('사진'), video: tr('동영상'), voice: tr('음성 메시지'), sticker: tr('스티커') }
function time(fields: Record<string, WireObject>, key: string): number | null {
  const raw = fields[key]?.timestampValue
  if (!raw) return null
  try { return positionMilliseconds(timestamp(raw, '')) } catch { return null }
}
// ChannelInquiryChatView inquiryLastReadAtByRole / markMorseInquiryRead: the room document keeps lastReadAt and
// lastReadMessageId per uid, as a chat does; what this account sent is read up to where the other side has come.
function inquiryOutboxRead(f: Record<string, WireObject>, peer: string): ReadCursor | null {
  if (!peer) return null
  const raw = mapField(f, 'lastReadAt')[peer]?.timestampValue
  if (!raw) return null
  try {
    const id = stringField(mapField(f, 'lastReadMessageId'), peer, 160)
    const cursor = readCursor(timestamp(raw, id))
    return cursor.at > 0 ? cursor : null
  } catch { return null }
}
// The person the room keeps for the side this account is talking to. Only an owner has one: a subscriber's
// side of the room is the channel, whose picture is a channel photo, not a person's.
function inquiryPeerRecord(doc: FirestoreDocument, uid: string): { photo: string; deleted: boolean } {
  const f = doc.fields
  if (stringField(f, 'channelOwnerId', 160) !== uid) return { photo: '', deleted: false }
  const deleted = boolField(f, 'subscriberAccountDeleted')
  return { photo: deleted ? '' : stringField(f, 'subscriberPhotoURL', 10000), deleted }
}
function decodeInquiry(doc: FirestoreDocument, uid: string): Inquiry {
  const prefix = `${documents}/channelInquiries/`, id = doc.name.slice(prefix.length), f = doc.fields
  if (!doc.name.startsWith(prefix) || id.includes('/')) throw new ReadFailure('data')
  const ownerId = stringField(f, 'channelOwnerId', 160), subscriberId = stringField(f, 'subscriberId', 160)
  const role: InquiryRole | null = ownerId === uid ? 'owner' : subscriberId === uid ? 'subscriber' : null
  if (!role) throw new ReadFailure('permission')
  const channelName = boolField(f, 'channelDeleted') ? tr('알 수 없는 채널') : stringField(f, 'channelName', 512) || tr('채널')
  const subscriberName = boolField(f, 'subscriberAccountDeleted') ? tr('탈퇴한 계정') : stringField(f, 'subscriberName', 512) || tr('구독자')
  return { id, role, peerUid: role === 'owner' ? subscriberId : '', channelId: stringField(f, 'channelId', 160), channelName, peerName: role === 'owner' ? subscriberName : channelName,
    lastMessage: inquiryPreviewText(stringField(f, 'lastMessage', 100000).slice(0, 300)), lastMessageAt: time(f, 'lastMessageAt'),
    unread: Math.max(0, Math.trunc(numberField(f, role === 'owner' ? 'unreadForOwner' : 'unreadForSubscriber'))), cutoff: time(f, 'historyRevokedAt'),
    // The room's own auto-delete policy; the server stamps every accepted message with its deleteAt.
    autoDeleteSeconds: autoDeleteSecondsValue(Math.trunc(numberField(f, 'autoDeleteSeconds'))), autoDeleteMyOnly: boolField(f, 'autoDeleteMyOnly'),
    outboxRead: inquiryOutboxRead(f, role === 'owner' ? subscriberId : ownerId) }
}
export function decodeInquiryMessage(doc: FirestoreDocument, inquiry: Pick<Inquiry, 'id' | 'cutoff'>, uid: string): InquiryMessageItem | null {
  const prefix = `${documents}/channelInquiries/${inquiry.id}/messages/`, id = doc.name.slice(prefix.length), f = doc.fields
  if (!doc.name.startsWith(prefix) || id.includes('/')) throw new ReadFailure('data')
  if (boolField(f, 'isDeleted') || f.deletedAt?.timestampValue) return null
  const createdAt = time(f, 'createdAt')
  if (inquiry.cutoff !== null && createdAt !== null && createdAt <= inquiry.cutoff) return null
  // The server stamps every message of a room with an auto-delete policy; a message past its time is not shown.
  const expires = time(f, 'deleteAt')
  if (expires !== null && expires <= Date.now()) return null
  // onInquiryAutoDeletePolicyUpdated writes the policy notice as a system message, as it does in a chat.
  const stored = stringField(f, 'text', 100000)
  if (boolField(f, 'isSystem') || stored.startsWith(autoDeleteWirePrefix)) {
    return { id, own: false, senderType: stringField(f, 'senderType', 32) === 'owner' ? 'owner' : 'subscriber', kind: 'text', system: true,
      text: autoDeleteNoticeText(autoDeleteNoticeFields(f), stored) || tr('시스템 메시지'), label: '', createdAt, edited: false, version: documentVersion(doc) }
  }
  const raw = stringField(f, 'type', 32) || 'text', kind = (kinds.includes(raw) ? raw : 'text') as InquiryMessageKind
  const caption = stringField(f, 'imageCaption', 100000) || stringField(f, 'videoCaption', 100000)
  const label = kind === 'text' ? '' : kind === 'file' ? stringField(f, 'fileName', 512) || tr('파일') : kind === 'location' ? stringField(f, 'locationName', 512) || tr('위치')
    : kind === 'event' ? stringField(f, 'eventTitle', 512) || tr('일정') : labels[kind] ?? tr('메시지')
  const attachments = mediaResources(doc, inquiry.id, kind, false, 'inquiry').map(resource => resource.summary)
  const circular = boolField(f, 'isCircleVideo'), metadata = attachments.length ? messageMediaMetadata(doc, kind, attachments.length, circular) : null
  const replyToId = stringField(f, 'replyToId', 160).trim()
  const reactions = messageReactions(doc, uid)
  return { id, own: stringField(f, 'senderId', 160) === uid, senderType: stringField(f, 'senderType', 32) === 'owner' ? 'owner' : 'subscriber', kind,
    ...(replyToId && replyToId !== id ? { replyToId } : {}),
    text: kind === 'text' ? stringField(f, 'text', 30000) : caption, label, createdAt, edited: boolField(f, 'isEdited'),
    version: documentVersion(doc), ...(attachments.length ? { attachments } : {}),
    ...(metadata && Object.keys(metadata).length ? { mediaMetadata: metadata } : {}), ...(circular && kind === 'video' ? { circular: true as const } : {}),
    ...(reactions.length ? { reactions } : {}) }
}

// HistoryMessageReply: the answered message as the bubble quotes it. A room holds its latest messages, so the
// original is looked for among them; one that is no longer there says so, exactly as a chat's quote does.
export function attachInquiryReplies(items: InquiryMessageItem[], peerName: string): InquiryMessageItem[] {
  if (!items.some(item => item.replyToId)) return items
  const byId = new Map(items.map(item => [item.id, item]))
  return items.map(item => {
    if (!item.replyToId) return item
    const original = byId.get(item.replyToId)
    const reply: ReplyPreview = !original || original.system ? { state: 'unavailable' }
      : { state: 'ready', senderName: original.own ? tr('나') : peerName || tr('상대방'), kind: original.kind, text: original.text || original.label }
    return { ...item, reply }
  })
}

// What a video or file message says besides its URL, as ChannelInquiryService.sendMessage sends it:
// a video's caption in text with its whole seconds, a file's name in text and fileName with its size.
// A video also carries its display size and thumbnail, which the server keeps (canonicalMessage).
export function inquiryAttachmentFields(kind: 'video' | 'file', name: string, size: number, caption: string, video: VideoFacts | null): Record<string, unknown> {
  if (kind === 'file') return { type: 'file', text: name, fileName: name, fileSize: size }
  return { type: 'video', text: caption, ...(caption ? { videoCaption: caption } : {}),
    ...(video ? { videoDuration: Math.round(video.duration), videoWidthPx: video.width, videoHeightPx: video.height, ...(video.thumb ? { thumbData: video.thumb } : {}) } : {}) }
}

// A voice message as iOS sends it: no text, whole seconds with at least one, and the levels as recorded.
export function inquiryVoiceFields(url: string, duration: number, waveform: number[]): Record<string, unknown> {
  return { type: 'voice', mediaUrl: url, voiceDuration: Math.max(1, Math.round(duration)), voiceWaveform: waveform.map(level => Math.round(level * 1000) / 1000) }
}

// The queue document of a scheduled inquiry message: what a chat queues, naming the room. The server reads the
// text through the same canonicalMessage, so nothing else of the shape differs (talky-scheduled-online-messages).
export function inquiryQueueFields(request: InquiryScheduleRequest, uid: string): Record<string, DeferredWireValue> {
  const chatId = inquiryQueueChatId(request.inquiryId)
  return { ...deferredFields({ chatId, messageId: request.messageId, kind: 'scheduled', text: request.text, scheduledAt: request.scheduledAt, silent: false, reply: null }, uid, request.text, ''),
    inquiryId: { stringValue: request.inquiryId } }
}

// ChannelInquiryService on Desktop: the owner's list for one channel and one open room, both live.
// The newest message of a room sent by the other side, whether or not this side deleted it for itself.
export function newestFromOther(rows: Iterable<FirestoreDocument>, uid: string): { id: string } | null {
  let best: { id: string; at: number } | null = null
  for (const doc of rows) {
    if (stringField(doc.fields, 'senderId', 160) === uid) continue
    const raw = doc.fields.createdAt?.timestampValue
    let at = Number.MAX_SAFE_INTEGER
    if (raw) { try { at = positionMilliseconds(timestamp(raw, '')) } catch { continue } }
    const id = doc.name.slice(doc.name.lastIndexOf('/') + 1)
    if (!best || at > best.at || (at === best.at && id > best.id)) best = { id, at }
  }
  return best
}
export class ChannelInquiries {
  // The video or file picked for the open room, held here until it is sent or put down.
  private readonly attachments = new AttachmentStaging('__inquiry-draft')
  // Photos of the people listed, from the photo address this record keeps (see ChannelPeoplePhotos).
  people: PeoplePhotoResolver | null = null
  private photos = new Map<string, string>()
  private reader: FirestoreReader | null = null
  private list: ListState | null = null
  private thread: ThreadState | null = null
  private locked = false
  private closed = false
  // The room's own queue of «예약 전송», watched like a chat's while the room is open.
  private readonly scheduled: DeferredMessages
  constructor(private readonly uid: string, private readonly auth: ReadCredentials, private readonly allowed: () => void,
    private readonly author: () => { authorName: string; authorPhotoURL: string | null }, private readonly foreground: () => boolean, private readonly changed: () => void,
    // The device's queue a message is handed to (inquiry-sends.ts), and what a deleted room leaves in it.
    private readonly enqueue: (request: InquirySendRequest) => Promise<void>, private readonly forgetRoom: (inquiryId: string) => Promise<void>,
    // «나에게만 삭제»: a message this device hides, kept on the server for the other side.
    private readonly hidden: (inquiryId: string, messageId: string) => boolean = () => false,
    // «대화 기록 모두 삭제»: the device queue that sends it with its fixed boundary until answered (history-clears.ts, A4).
    private readonly clearHistory: (request: HistoryClearRequest) => Promise<'done' | 'unconfirmed'> = async () => 'unconfirmed') {
    this.scheduled = new DeferredMessages(uid, auth.signal, () => this.changed())
  }

  get snapshot(): ChannelInquiriesSnapshot | null {
    if (!this.list && !this.thread) return null
    return { list: this.list ? { ...this.list.value, items: this.list.value.items.map(item => ({ ...item, photo: this.people?.(item.peerUid, this.photos.get(item.id) ?? null) ?? null })) } : null,
      thread: this.thread ? { ...this.thread.value, items: this.thread.value.items.map(item => ({ ...item })),
        photo: this.people?.(this.thread.value.peerUid, this.thread.peer.photo || null) ?? null,
        scheduled: this.scheduled.snapshot(inquiryQueueChatId(this.thread.request.inquiryId))?.items ?? [] } : null }
  }
  // «연락처에 추가» from the room that is open: the person's name and picture are the room's own copy, the
  // one this account is already looking at. iOS makes the same stub of them
  // (ChannelInquiryChatView.subscriberMorseUserStubForOwnerProfile) — a room carries no Morse ID, so the
  // contact is saved without one and takes it from their profile once they can be read.
  contactSource(inquiryId: string, uid: string): ContactCreateFields {
    const state = this.thread, inquiry = state?.inquiry
    if (this.closed || this.locked || !state || state.request.inquiryId !== inquiryId || !inquiry || inquiry.id !== inquiryId ||
      inquiry.role !== 'owner' || state.peer.deleted || !inquiry.peerUid || inquiry.peerUid !== uid || uid === this.uid ||
      !inquiry.peerName.trim()) throw new Error(tr('현재 문의방에서 상대를 확인할 수 없습니다.'))
    return { uid, userId: '', displayName: inquiry.peerName.trim(), photoURL: state.peer.photo }
  }
  private get source(): FirestoreReader {
    if (this.closed) throw new Error(tr('계정이 변경되었습니다.'))
    this.reader ??= new FirestoreReader(this.auth)
    return this.reader
  }
  private signal(): AbortSignal { return AbortSignal.any([this.auth.signal, AbortSignal.timeout(35000)]) }

  // ChannelInquiryService.getOrCreateInquiry: the subscriber creates the room with the channel's current owner.
  async openSubscriber(channelId: string): Promise<string> {
    this.allowed()
    const id = `${channelId}_${this.uid}`, path = `${documents}/channelInquiries/${id}`, reader = this.source
    const existing = await reader.getDocument(path, this.signal()).catch(() => { throw new Error(tr('문의를 불러오지 못했습니다. 연결을 확인해 주세요.')) })
    if (existing) { decodeInquiry(existing, this.uid); return id }
    const channel = await reader.getDocument(`${documents}/channels/${channelId}`, this.signal()).catch(() => null)
    const ownerId = channel ? stringField(channel.fields, 'ownerId', 160) : ''
    if (!channel || !ownerId) throw new Error(tr('채널 정보를 확인하지 못했습니다.'))
    if (ownerId === this.uid) throw new Error(tr('내 채널에는 문의할 수 없습니다.'))
    const me = this.author(), fields: Record<string, WireObject> = {
      channelId: { stringValue: channelId }, channelName: { stringValue: stringField(channel.fields, 'name', 512) }, channelOwnerId: { stringValue: ownerId },
      subscriberId: { stringValue: this.uid }, subscriberName: { stringValue: me.authorName }, unreadForOwner: { integerValue: '0' }, unreadForSubscriber: { integerValue: '0' }
    }
    const channelPhoto = stringField(channel.fields, 'photoURL', 10000)
    if (channelPhoto) fields.channelPhotoURL = { stringValue: channelPhoto }
    if (me.authorPhotoURL) fields.subscriberPhotoURL = { stringValue: me.authorPhotoURL }
    try { await reader.createChannelInquiry(id, fields, this.signal()) }
    catch (error) {
      // Another device of this account may have created the same room first.
      const again = await reader.getDocument(path, this.signal()).catch(() => null)
      if (!again) throw new Error(error instanceof DocumentWriteFailure && !error.uncertain ? tr('구독 중인 채널에서만 문의할 수 있습니다.') : tr('문의를 만들지 못했습니다. 연결을 확인해 주세요.'))
    }
    return id
  }

  openList(request: InquiryListRequest): void {
    this.closeList()
    const state: ListState = { request, stop: null, value: { ...request, status: 'loading', items: [], message: '' } }
    this.list = state
    this.startList(state)
    this.changed()
  }
  private startList(state: ListState): void {
    if (this.locked || this.closed) return
    try { this.allowed() } catch { state.value = { ...state.value, status: 'error', message: tr('연결을 확인한 뒤 다시 열어 주세요.') }; return }
    // loadInquirySummariesForOwner: the owner's rooms by latest message; this channel is kept here.
    state.stop = this.source.watch({ query: { parent: documents, structuredQuery: { from: [{ collectionId: 'channelInquiries' }],
      where: { fieldFilter: { field: { fieldPath: 'channelOwnerId' }, op: 'EQUAL', value: { stringValue: this.uid } } },
      orderBy: [{ field: { fieldPath: 'lastMessageAt' }, direction: 'DESCENDING' }, { field: { fieldPath: '__name__' }, direction: 'DESCENDING' }], limit: { value: 500 } } } }, this.auth.signal, {
      snapshot: rows => {
        if (this.list !== state) return
        const items: InquirySummary[] = [], photos = new Map<string, string>()
        for (const doc of rows.values()) {
          try {
            const { role, cutoff: _cutoff, ...summary } = decodeInquiry(doc, this.uid)
            if (role === 'owner' && summary.channelId === state.request.channelId) {
              items.push(summary)
              const photo = boolField(doc.fields, 'subscriberAccountDeleted') ? '' : stringField(doc.fields, 'subscriberPhotoURL', 10000)
              if (photo) photos.set(summary.id, photo)
            }
          } catch { /* An unreadable room is left out of the list. */ }
        }
        items.sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0))
        state.value = { ...state.value, status: 'ready', items, message: '' }
        this.photos = photos
        this.changed()
      },
      // The channel's rooms stay listed while their watch reconnects.
      reconnecting: () => {},
      state: status => {
        if (this.list !== state || status === 'ready') return
        state.value = { ...state.value, status, message: status === 'error' ? tr('문의 목록을 불러오지 못했습니다.') : '' }
        this.changed()
      }
    }, 500, 8 * 1024 * 1024)
  }
  closeList(requestId?: string): void {
    if (!this.list || (requestId && this.list.request.requestId !== requestId)) return
    this.list.stop?.(); this.list = null
    this.changed()
  }

  openThread(request: InquiryThreadRequest): void {
    this.closeThread()
    const state: ThreadState = { request, stop: null, roomStop: null, inquiry: null, marked: '', marking: false, rows: new Map(), reactionUpdates: new ReactionUpdates(),
      peer: { photo: '', deleted: false },
      value: { ...request, channelId: '', role: 'subscriber', title: '', channelName: '', peerUid: '', status: 'loading', items: [], message: '', pinnedIds: [], autoDeleteSeconds: 0, autoDeleteMyOnly: false, scheduled: [], outboxRead: null } }
    this.thread = state
    this.changed()
    void this.startThread(state)
  }
  private async startThread(state: ThreadState): Promise<void> {
    if (this.locked || this.closed) return
    try {
      this.allowed()
      const reader = this.source, doc = await reader.getDocument(`${documents}/channelInquiries/${state.request.inquiryId}`, this.signal())
      if (this.thread !== state || this.locked) return
      if (!doc) { state.value = { ...state.value, status: 'error', message: tr('문의를 찾을 수 없습니다.') }; this.changed(); return }
      const inquiry = decodeInquiry(doc, this.uid)
      state.inquiry = inquiry
      state.peer = inquiryPeerRecord(doc, this.uid)
      state.value = { ...state.value, channelId: inquiry.channelId, role: inquiry.role, title: inquiry.peerName, channelName: inquiry.channelName, peerUid: inquiry.peerUid, pinnedIds: pinnedMessageIds(doc.fields), outboxRead: inquiry.outboxRead }
      // Only a scheduled queue exists for a room: an inquiry has no «온라인시 보내기».
      this.scheduled.bind(inquiryQueueChatId(state.request.inquiryId), reader, ['scheduled'])
      // checkTTLs(): the open room takes an expired message from both sides, as ChatRoomView does for a chat.
      state.expired = new ExpiredMessages(
        entry => reader.deleteInquiryMessage(state.request.inquiryId, entry.id, this.signal()),
        () => this.thread === state && !this.closed && !this.locked)
      // The room document carries what both sides change — «모두에게 고정» above all — so it is followed, not read once.
      state.roomStop = reader.watch({ documents: { documents: [doc.name] } }, this.auth.signal, {
        snapshot: rows => {
          const room = rows.get(doc.name)
          if (this.thread !== state || !room) return
          try {
            const current = decodeInquiry(room, this.uid)
            state.inquiry = { ...current, cutoff: current.cutoff }
            state.peer = inquiryPeerRecord(room, this.uid)
            state.value = { ...state.value, title: current.peerName, channelName: current.channelName, peerUid: current.peerUid, pinnedIds: pinnedMessageIds(room.fields),
              autoDeleteSeconds: current.autoDeleteSeconds, autoDeleteMyOnly: current.autoDeleteMyOnly, outboxRead: current.outboxRead }
            this.changed()
          } catch { /* The room stays as it was read. */ }
        },
        // A stream renewal reads the same document again; what is known stays until then.
        reconnecting: () => {},
        state: () => {}
      }, 1, 2 * 1024 * 1024)
      // ChannelInquiryService.listenToMessages: the latest 300 messages.
      state.stop = reader.watch({ query: { parent: doc.name, structuredQuery: { from: [{ collectionId: 'messages' }],
        orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }, { field: { fieldPath: '__name__' }, direction: 'DESCENDING' }], limit: { value: 300 } } } }, this.auth.signal, {
        snapshot: rows => {
          if (this.thread !== state || !state.inquiry) return
          const current = state.inquiry
          state.rows = new Map(rows)
          const items = [...rows.values()].flatMap(row => { try {
            const item = decodeInquiryMessage(row, current, this.uid)
            const updated = item && !item.system ? state.reactionUpdates.reactions(item.id, row, this.uid) : null
            return item && !this.hidden(current.id, item.id) ? [updated ? { ...item, reactions: updated } : item] : []
          } catch { return [] } })
          items.sort((a, b) => (a.createdAt ?? Number.MAX_SAFE_INTEGER) - (b.createdAt ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id))
          state.value = { ...state.value, status: 'ready', items: attachInquiryReplies(items, state.value.title), message: '' }
          this.expireMessages(state)
          this.changed(); this.markRead(state)
        },
        // The room's messages stay on screen while their watch reconnects, and an empty room stays open to write in.
        reconnecting: () => {},
        state: status => {
          if (this.thread !== state || status === 'ready') return
          state.value = { ...state.value, status: status === 'error' ? 'error' : state.value.items.length ? 'ready' : 'loading', message: status === 'error' ? tr('메시지를 불러오지 못했습니다.') : '' }
          this.changed()
        }
      }, 300, 16 * 1024 * 1024)
    } catch {
      if (this.thread !== state) return
      state.value = { ...state.value, status: 'error', message: tr('문의를 열지 못했습니다. 연결을 확인해 주세요.') }
      this.changed()
    }
  }
  closeThread(requestId?: string): void {
    if (!this.thread || (requestId && this.thread.request.requestId !== requestId)) return
    clearTimeout(this.thread.expiryTimer); this.thread.expired?.close()
    this.thread.stop?.(); this.thread.roomStop?.(); this.thread = null; this.attachments.clear(); this.scheduled.clear()
    this.changed()
  }
  // The microphone is granted to a recording only while its room is open, as a chat's is to its chat.
  requireOpenThread(request: InquiryThreadRequest): void { this.requireThread(request); this.allowed() }
  private requireThread(request: InquiryThreadRequest): ThreadState {
    const state = this.thread
    if (!state || state.request.requestId !== request.requestId || state.request.inquiryId !== request.inquiryId || !state.inquiry || state.value.status !== 'ready') throw new Error(tr('문의를 다시 열어 주세요.'))
    return state
  }
  // A message written into the room needs only the room itself: who this account is in it. Its messages may still be
  // loading or reconnecting, and the connection may be down: what is written goes to the device queue, which sends it
  // when it can (inquiry-sends.ts), as Telegram lets a chat be written in while it connects.
  private requireRoom(request: InquiryThreadRequest): ThreadState {
    const state = this.thread
    if (!state || state.request.requestId !== request.requestId || state.request.inquiryId !== request.inquiryId || !state.inquiry || state.value.status === 'error') throw new Error(tr('문의를 다시 열어 주세요.'))
    return state
  }

  // scheduleNextTTLs(): the room comes back exactly when its next message expires, drops what has expired from the
  // screen and takes it from the server too, so both sides lose it at the same moment.
  private expireMessages(state: ThreadState): void {
    clearTimeout(state.expiryTimer); state.expiryTimer = undefined
    if (this.thread !== state || !state.inquiry || state.value.status !== 'ready') return
    const now = Date.now(), current = state.inquiry
    const items = state.value.items.filter(item => { const doc = state.rows.get(`${documents}/channelInquiries/${current.id}/messages/${item.id}`); return !doc || (time(doc.fields, 'deleteAt') ?? Number.MAX_SAFE_INTEGER) > now })
    if (items.length !== state.value.items.length) state.value = { ...state.value, items }
    state.expired?.sweep(state.rows.values())
    const next = nextExpiry(state.rows.values(), now)
    if (next !== null) state.expiryTimer = setTimeout(() => { if (this.thread === state) { this.expireMessages(state); this.changed() } }, Math.min(2147483647, Math.max(1, next - now + 1)))
  }

  // A message hidden on this device leaves the open room at once, as it leaves a chat's history.
  refreshHidden(): void {
    const state = this.thread
    if (!state?.inquiry || state.value.status !== 'ready') return
    const current = state.inquiry
    const items = state.value.items.filter(item => !this.hidden(current.id, item.id))
    if (items.length === state.value.items.length) return
    state.value = { ...state.value, items }
    this.changed()
  }

  // The room being read right now, so nothing announces what is already on screen.
  get openThreadId(): string | null { return this.thread && !this.locked && !this.closed ? this.thread.request.inquiryId : null }

  activity(): void { if (this.thread) this.markRead(this.thread) }

  // MediaSession resolver: a photo of the open room, pinned to the document the renderer saw.
  mediaResource(inquiryId: string, request: MediaRequest): MediaResource | null {
    const state = this.thread
    if (this.closed || this.locked || !state?.inquiry || state.request.inquiryId !== inquiryId || state.value.status !== 'ready') return null
    const doc = state.rows.get(`${documents}/channelInquiries/${inquiryId}/messages/${request.messageId}`)
    const item = state.value.items.find(entry => entry.id === request.messageId)
    if (!doc || !item?.attachments?.length || documentVersion(doc) !== request.version || item.version !== request.version) return null
    return mediaResources(doc, inquiryId, item.kind, false, 'inquiry')[request.index] ?? null
  }

  // A message of the open room as a forward source: what a chat message carries, and the objects it points at, so
  // the same preparation a chat forward uses downloads and re-sends them (Telegram forwards by re-sending content).
  forwardSource(inquiryId: string, messageId: string, version: string): ForwardMediaSource {
    const state = this.thread
    if (this.closed || this.locked || !state?.inquiry || state.request.inquiryId !== inquiryId || state.value.status !== 'ready') throw new Error(tr('문의를 다시 열어 주세요.'))
    const item = state.value.items.find(entry => entry.id === messageId)
    const doc = state.rows.get(`${documents}/channelInquiries/${inquiryId}/messages/${messageId}`)
    if (!item || !doc || item.system || item.version !== version || documentVersion(doc) !== version) throw new Error(tr('원본이 변경되었거나 만료되었습니다. 최신 메시지를 다시 선택해 주세요.'))
    const parts = item.attachments?.length ? mediaResources(doc, inquiryId, item.kind, false, 'inquiry') : []
    const resources = (item.attachments ?? []).map(part => {
      const resource = parts[part.index]
      if (!resource?.path || !resource.summary.available) throw new Error(tr('첨부 원본을 확인하지 못했습니다.'))
      return resource
    })
    return { message: inquiryChatMessage(item, inquiryId), resources }
  }

  // ChannelInquiryChatView uploadAndSendImage: the bytes reach storage first, then the same canonical send the text
  // path uses carries the download URL (iOS keeps it in text as well). Both are the queue's (inquiry-sends.ts): the
  // photo is handed over with the message and goes when it can, under the message's id.
  async sendPhoto(request: InquiryPhotoRequest, bytes: Uint8Array): Promise<'queued'> {
    const state = this.requireRoom(request)
    if (!bytes.byteLength || bytes.byteLength >= maxInquiryPhotoBytes) throw new Error(tr('10 MB 미만의 사진만 보낼 수 있습니다.'))
    inquiryAttachmentPath(request.inquiryId, request.messageId, 'jpg')
    await this.enqueue({ id: request.messageId, inquiryId: request.inquiryId,
      message: { senderType: state.value.role, type: 'image', ...(request.caption ? { imageCaption: request.caption } : {}), ...this.replyFields(state, request.replyToId) },
      preview: { kind: 'image', text: tr('사진') }, media: { bytes, extension: 'jpg', noun: tr('사진'), urlInText: true } })
    return 'queued'
  }
  // A sticker of this device's library, sent into a room as it is sent into a chat: the object goes to the room's
  // own folder and the message is a «sticker» of the usual 512 by 512 (ChatRoomView.sendStickerMessage).
  async sendSticker(request: InquiryTargetRequest, sticker: { extension: 'png' | 'gif' | 'webp' | 'mp4'; bytes: Buffer }): Promise<'queued'> {
    const state = this.requireRoom(request)
    inquiryAttachmentPath(request.inquiryId, request.messageId, sticker.extension)
    if (!sticker.bytes.byteLength || sticker.bytes.byteLength >= maxInquiryAttachmentBytes) throw new Error(tr('스티커를 보내지 못했습니다.'))
    await this.enqueue({ id: request.messageId, inquiryId: request.inquiryId,
      message: { senderType: state.value.role, type: 'sticker', text: '', mediaWidthPx: stickerSidePx, mediaHeightPx: stickerSidePx },
      preview: { kind: 'sticker', text: tr('스티커') }, media: { bytes: sticker.bytes, extension: sticker.extension, noun: tr('스티커'), urlInText: false } })
    return 'queued'
  }
  // ChannelInquiryChatView also sends videos and files. One is picked into this room's staging; a
  // video must be one (the picker also lists photos, which go through the photo send instead).
  async pickAttachment(request: InquiryThreadRequest, mode: InquiryAttachmentMode, choose: () => Promise<string[] | null>): Promise<AttachmentDraft | null> {
    this.requireThread(request)
    this.allowed()
    const current = (): boolean => !this.closed && !this.locked && this.thread?.request.requestId === request.requestId
    const draft = await this.attachments.pick(request.inquiryId, mode === 'file' ? 'file' : 'media', current, choose)
    if (draft && mode === 'video' && draft.kind !== 'video') { this.attachments.clear(draft.id); throw new Error(tr('MP4 또는 MOV 동영상을 선택해 주세요.')) }
    return draft
  }
  discardAttachment(id: string): void { this.attachments.clear(id) }
  attachmentPreview(path: string, request: Request): Response {
    const state = this.thread
    if (this.closed || this.locked || !state) return new Response(null, { status: 403 })
    return this.attachments.response(state.request.inquiryId, path, request)
  }
  // Stored the way iOS stores it, then sent with the fields iOS sends (ChannelInquiryService.sendMessage):
  // a video's caption in text with its length, a file's name in text and fileName with its size. A video
  // also carries its size and thumbnail, which the server keeps and Telegram clients send. The staged file is put down
  // only once the queue holds it.
  async sendAttachment(request: InquiryAttachmentRequest, video: VideoFacts | null): Promise<'queued'> {
    const state = this.requireRoom(request)
    const part = this.attachments.take(request.inquiryId, request.draftId, request.itemId)
    if (!part || (part.kind !== 'video' && part.kind !== 'file')) throw new Error(tr('첨부를 다시 선택해 주세요.'))
    const kind = part.kind, noun = kind === 'video' ? tr('동영상') : tr('파일')
    try {
      if (!part.bytes.byteLength || part.bytes.byteLength >= maxInquiryAttachmentBytes) throw new Error(tr('50 MB 미만의 {0}만 보낼 수 있습니다.', [noun]))
      const extension = kind === 'file' ? 'bin' : part.extension === 'mov' ? 'mov' : 'mp4'
      inquiryAttachmentPath(request.inquiryId, request.messageId, extension)
      await this.enqueue({ id: request.messageId, inquiryId: request.inquiryId,
        message: { senderType: state.value.role, ...inquiryAttachmentFields(kind, part.name, part.size, request.caption, video), ...this.replyFields(state, request.replyToId) },
        preview: { kind, text: kind === 'video' ? tr('동영상') : part.name }, media: { bytes: part.bytes, extension, noun, urlInText: false } })
      this.attachments.clear(request.draftId)
      return 'queued'
    } finally { part.bytes.fill(0) }
  }
  // ChannelInquiryChatView.uploadAndSendVideo(isCircle: true): a video message recorded here, stored as MP4 and
  // sent as a round video with its square size, whole seconds and thumbnail.
  async sendRoundVideo(request: InquiryTargetRequest & { replyToId?: string }, bytes: Uint8Array, facts: { duration: number; thumb: string }, side: number): Promise<'queued'> {
    const state = this.requireRoom(request)
    const source = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const type = mediaType(source)
    if (type.kind !== 'video' || type.extension !== 'mp4' || source.length >= 50 * 1024 * 1024) throw new Error(tr('녹화한 영상 메시지의 형식이나 크기를 확인해 주세요.'))
    inquiryAttachmentPath(request.inquiryId, request.messageId, 'mp4')
    await this.enqueue({ id: request.messageId, inquiryId: request.inquiryId,
      message: { senderType: state.value.role, ...inquiryAttachmentFields('video', 'video-message.mp4', source.length, '', { duration: facts.duration, width: side, height: side, thumb: facts.thumb }), isCircleVideo: true,
        ...this.replyFields(state, request.replyToId) },
      preview: { kind: 'video', text: tr('영상 메시지') }, media: { bytes: source, extension: 'mp4', noun: tr('영상 메시지'), urlInText: false } })
    return 'queued'
  }
  // ChannelInquiryChatView.uploadAndSendVoice: the recording is stored as M4A, then sent with its whole
  // seconds and waveform and no text. The capture is put down by the caller only once the queue holds it.
  async sendVoice(request: InquiryVoiceRequest, bytes: Uint8Array): Promise<'queued'> {
    const state = this.requireRoom(request)
    const source = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    if (source.length < 16 || source.length >= maxVoiceCaptureBytes) throw new Error(tr('녹음 크기를 확인해 주세요.'))
    forwardMediaFormat('voice', source)
    inquiryAttachmentPath(request.inquiryId, request.messageId, 'm4a')
    const { mediaUrl: _url, ...voice } = inquiryVoiceFields('', request.duration, request.waveform)
    const seconds = Math.max(1, Math.round(request.duration))
    await this.enqueue({ id: request.messageId, inquiryId: request.inquiryId,
      message: { senderType: state.value.role, ...voice, ...this.replyFields(state, request.replyToId) },
      preview: { kind: 'voice', text: tr('음성 메시지 · {0}:{1}', [Math.floor(seconds / 60), String(seconds % 60).padStart(2, '0')]) },
      media: { bytes: source, extension: 'm4a', noun: tr('음성 메시지'), urlInText: false } })
    return 'queued'
  }
  // markMorseInquiryRead: the newest message from the other side, once, while the room is on screen. One this side
  // deleted for itself counts too: deleting it is past reading it, and the server counts unread messages after the
  // position it is given, so a room whose unread messages were all deleted here would otherwise keep counting them
  // (Telegram leaves deleted messages out of the unread count).
  private markRead(state: ThreadState): void {
    const latest = newestFromOther(state.rows.values(), this.uid)
    if (!latest || state.marked === latest.id || state.marking || this.locked || this.closed || !this.foreground()) return
    state.marking = true
    void callMorseFunction(this.auth, 'markMorseInquiryRead', { inquiryId: state.request.inquiryId, messageId: latest.id, expectedUid: this.uid }, AbortSignal.timeout(65000))
      .then(() => { state.marking = false; state.marked = latest.id; if (this.thread === state) this.markRead(state) }, () => { state.marking = false })
  }

  // sendMorseInquiryMessage accepts one message per client id, so the queue sends it again under that id until the
  // server has it (inquiry-sends.ts).
  async send(request: InquiryTextRequest & { replyToId?: string }): Promise<'queued'> {
    const state = this.requireRoom(request)
    await this.enqueue({ id: request.messageId, inquiryId: request.inquiryId,
      message: { senderType: state.value.role, type: 'text', text: request.text, ...this.replyFields(state, request.replyToId) },
      preview: { kind: 'text', text: request.text } })
    return 'queued'
  }
  // The message a send answers must be one of this room, and not a notice line: what the room shows, the send says.
  private replyFields(state: ThreadState, replyToId?: string): { replyToId?: string } {
    if (!replyToId) return {}
    const original = state.value.items.find(item => item.id === replyToId)
    if (!original || original.system) throw new Error(tr('답장할 메시지를 다시 선택해 주세요.'))
    return { replyToId }
  }

  // A message forwarded into a room, from a chat or from another room. Telegram re-sends the content, so it goes in
  // through the room's own send (sendMorseInquiryMessage) — the room does not have to be open, and the server decides
  // the sender's side from the room document, as it does for every message of a room. Each part is handed to the queue
  // under an id of its own, which it keeps however many times it has to go.
  async deliverForward(inquiryId: string, content: { kind: 'text'; text: string } | { kind: 'media'; media: PreparedForwardMedia }, validate: () => void): Promise<void> {
    this.allowed(); validate()
    const doc = await this.source.getDocument(`${documents}/channelInquiries/${inquiryId}`, this.signal())
    if (!doc) throw new Error(tr('문의를 찾을 수 없습니다.'))
    const inquiry = decodeInquiry(doc, this.uid)
    validate()
    if (content.kind === 'text') {
      await this.enqueue({ id: randomUUID().toUpperCase(), inquiryId, message: { senderType: inquiry.role, type: 'text', text: content.text }, preview: { kind: 'text', text: content.text } })
      return
    }
    const media = content.media
    if (media.kind === 'sticker') throw new Error(tr('스티커는 문의방으로 전달할 수 없습니다.'))
    const noun = media.kind === 'video' ? tr('동영상') : media.kind === 'voice' ? tr('음성 메시지') : media.kind === 'file' ? tr('파일') : tr('사진')
    for (const [index, part] of media.parts.entries()) {
      validate()
      const messageId = randomUUID().toUpperCase(), extension = inquiryAttachmentExtension(part.extension)
      if (!part.bytes.byteLength || part.bytes.byteLength >= maxInquiryAttachmentBytes) throw new Error(tr('50 MB 미만의 {0}만 보낼 수 있습니다.', [noun]))
      // Only the first message of an album carries the caption, as one message carried it before.
      const caption = index === 0 ? media.caption : ''
      const voice = media.kind === 'voice' ? (({ mediaUrl: _url, ...fields }) => fields)(inquiryVoiceFields('', media.metadata.voiceDuration ?? 1, media.metadata.voiceWaveform ?? [])) : null
      const message = media.kind === 'image' ? { type: 'image', ...(caption ? { imageCaption: caption } : {}) }
        : voice ?? inquiryAttachmentFields(media.kind === 'video' ? 'video' : 'file', part.name, part.bytes.length, caption,
          media.kind === 'video' ? { duration: media.metadata.videoDuration ?? 0, width: media.metadata.videoWidthPx ?? 0, height: media.metadata.videoHeightPx ?? 0, thumb: media.metadata.thumbData ?? '' } : null)
      const kind = media.kind === 'image' ? 'image' : media.kind === 'voice' ? 'voice' : media.kind === 'video' ? 'video' : 'file'
      await this.enqueue({ id: messageId, inquiryId, message: { senderType: inquiry.role, ...message },
        preview: { kind, text: kind === 'file' ? part.name : noun }, media: { bytes: part.bytes, extension, noun, urlInText: media.kind === 'image' } })
    }
  }
  // «모두에게 고정» / «고정 해제»: the room document keeps the ids, as a chat does (AppState.pinMessageForAll).
  async setPinned(request: InquiryTargetRequest & { pinned: boolean }): Promise<void> {
    const state = this.requireThread(request)
    if (!state.value.items.some(item => item.id === request.messageId && !item.system)) throw new Error(tr('고정할 메시지를 다시 선택해 주세요.'))
    if (request.pinned && state.value.pinnedIds.length >= freePinLimit) throw new Error(tr('고정은 {0}개까지 할 수 있습니다. 먼저 하나를 해제해 주세요.', [freePinLimit]))
    this.allowed()
    try { await this.source.setInquiryPinnedForAll(request.inquiryId, request.messageId, request.pinned, this.signal()) }
    catch (error) { throw new Error(error instanceof DocumentWriteFailure && error.uncertain ? tr('고정 결과를 확인하지 못했습니다. 잠시 후 대화를 확인해 주세요.') : tr('메시지를 고정하지 못했습니다.')) }
  }
  // The room's auto-delete policy, as a chat's. The change names its actor, which firestore.rules requires
  // (autoDeletePolicyActorOk), and the server writes the notice line and stamps the messages.
  async setAutoDelete(request: InquiryAutoDeleteRequest): Promise<void> {
    const state = this.requireThread(request)
    const inquiry = state.inquiry!
    if (inquiry.autoDeleteSeconds === request.seconds) return
    this.allowed()
    try { await this.source.setInquiryAutoDelete(this.uid, request.inquiryId, request.seconds, this.signal()) }
    catch (error) { throw new Error(error instanceof DocumentWriteFailure && error.uncertain ? tr('자동 삭제 설정 결과를 확인하지 못했습니다. 잠시 후 대화를 확인해 주세요.') : tr('자동 삭제 설정을 저장할 수 없어요. 연결을 확인해 주세요.')) }
  }
  // «예약 전송»: the server sends the text into this room at its time (talky-scheduled-online-messages).
  // The queue document names the room, and its chatId is the room's client id, as the rules require.
  async schedule(request: InquiryScheduleRequest): Promise<void> {
    this.requireThread(request)
    if (request.scheduledAt <= Date.now() || request.scheduledAt > Date.now() + maxScheduleAheadMs) throw new Error(tr('예약 시간은 지금 이후 1년 안으로 골라 주세요.'))
    this.allowed()
    try { await this.source.createDeferredMessage('scheduledMessages', request.messageId, inquiryQueueFields(request, this.uid), this.signal()) }
    catch (error) { throw new Error(error instanceof DocumentWriteFailure && error.uncertain ? tr('예약 결과를 확인하지 못했습니다. 예약된 메시지 목록을 확인해 주세요.') : tr('메시지를 예약하지 못했습니다.')) }
  }
  async cancelScheduled(request: InquiryTargetRequest): Promise<void> {
    this.requireThread(request)
    if (!this.scheduled.has(inquiryQueueChatId(request.inquiryId), 'scheduled', request.messageId)) throw new Error(tr('예약된 메시지를 다시 확인해 주세요.'))
    this.allowed()
    try { await this.source.deleteDeferredMessage(deferredCollections.scheduled, request.messageId, this.signal()) }
    catch { throw new Error(tr('예약 취소에 실패했어요')) }
  }
  async edit(request: InquiryTextRequest): Promise<void> {
    const state = this.requireThread(request), item = state.value.items.find(entry => entry.id === request.messageId)
    if (!item || !item.own || item.kind !== 'text') throw new Error(tr('내가 보낸 텍스트 메시지만 수정할 수 있습니다.'))
    this.allowed()
    try { await this.source.editInquiryMessage(request.inquiryId, request.messageId, request.text, this.signal()) }
    catch (error) { throw new Error(error instanceof DocumentWriteFailure && error.uncertain ? tr('수정 결과를 확인하지 못했습니다. 잠시 후 대화를 확인해 주세요.') : tr('메시지를 수정하지 못했습니다.')) }
  }
  // ChannelInquiryService.toggleReaction → setMorseMessageReaction with the inquiry: the whole selection of this
  // account goes, and the message's watch brings the result back.
  async react(request: InquiryReactionRequest): Promise<void> {
    const state = this.requireThread(request), item = state.value.items.find(entry => entry.id === request.messageId)
    if (!item || item.system) throw new Error(tr('최신 메시지를 다시 선택해 주세요.'))
    this.allowed()
    await setMessageReaction(this.auth, this.uid, { id: randomUUID(), chatId: inquiryQueueChatId(request.inquiryId), messageId: request.messageId, reactions: request.reactions },
      this.signal(), request.inquiryId)
  }
  // reactionUpdated for a message of the open room: its item takes the event's reactions until the document catches up.
  reactionUpdated(inquiryId: string, messageId: string, map: Record<string, unknown>, version: number): void {
    const state = this.thread
    if (!state || this.closed || state.request.inquiryId !== inquiryId) return
    const doc = state.rows.get(`${documents}/channelInquiries/${inquiryId}/messages/${messageId}`)
    if (!doc || !state.reactionUpdates.remember(messageId, map, version, doc)) return
    const reactions = state.reactionUpdates.reactions(messageId, doc, this.uid)
    if (!reactions) return
    state.value = { ...state.value, items: state.value.items.map(item => item.id === messageId ? { ...item, reactions } : item) }
    this.changed()
  }
  async remove(request: InquiryTargetRequest): Promise<void> {
    const state = this.requireThread(request), item = state.value.items.find(entry => entry.id === request.messageId)
    if (!item || !item.own) throw new Error(tr('내가 보낸 메시지만 삭제할 수 있습니다.'))
    this.allowed()
    try { await this.source.deleteInquiryMessage(request.inquiryId, request.messageId, this.signal()) }
    catch (error) { throw new Error(error instanceof DocumentWriteFailure && error.uncertain ? tr('삭제 결과를 확인하지 못했습니다. 잠시 후 대화를 확인해 주세요.') : tr('메시지를 삭제하지 못했습니다.')) }
  }
  // A4: the boundary is the newest message this device has from the server when the person presses (not one still on
  // its way), and the room here drops everything up to it at once, as Telegram does up to max_id. What stays after that
  // follows the room document's own boundary (historyRevokedAt), not the answer's.
  async clear(request: InquiryThreadRequest): Promise<'done' | 'unconfirmed'> {
    const state = this.requireThread(request)
    this.allowed()
    const newest = state.value.items.filter(item => item.createdAt !== null).reduce<InquiryMessageItem | null>((last, item) => !last || item.createdAt! > last.createdAt! ? item : last, null)
    const upTo = newest ? { messageId: newest.id, createdAtMillis: Math.floor(newest.createdAt!) } : null
    if (newest && this.thread === state) {
      state.value = { ...state.value, items: state.value.items.filter(item => item.createdAt === null || item.createdAt > newest.createdAt!) }
      this.changed()
    }
    return this.clearHistory({ id: randomUUID(), kind: 'inquiry-clear', targetId: request.inquiryId, seen: null, upTo })
  }

  // iOS ChannelInquiryService.deleteInquiry: the room is one document both sides read, so removing it
  // removes the conversation for the other person as well. Its messages go through the same server call
  // «대화 기록 모두 삭제» uses — it pages through them and leaves a cleanup job behind — and then the
  // room itself. A room already gone is not an error.
  async deleteRoom(inquiryId: string): Promise<'done' | 'unconfirmed'> {
    this.allowed()
    const reader = this.source
    const doc = await reader.getDocument(`${documents}/channelInquiries/${inquiryId}`, this.signal())
      .catch(() => { throw new Error(tr('문의를 불러오지 못했습니다. 연결을 확인해 주세요.')) })
    if (!doc) return 'done'
    decodeInquiry(doc, this.uid)
    try { await callMorseFunction(this.auth, 'clearMorseInquiryHistory', { inquiryId }, AbortSignal.timeout(65000)) }
    catch (error) {
      if (error instanceof MorseCallableFailure && error.uncertain) return 'unconfirmed'
      throw new Error(tr('문의를 삭제하지 못했습니다.'))
    }
    try { await reader.deleteInquiryRoom(inquiryId, this.signal()) } catch { return 'unconfirmed' }
    if (this.thread?.request.inquiryId === inquiryId) this.closeThread()
    await this.forgetRoom(inquiryId).catch(() => {})
    return 'done'
  }

  setLocked(locked: boolean): void {
    if (this.locked === locked) return
    this.locked = locked
    if (locked) {
      this.attachments.clear(); this.scheduled.clear()
      if (this.list) { this.list.stop?.(); this.list.stop = null }
      if (this.thread) { this.thread.stop?.(); this.thread.stop = null; clearTimeout(this.thread.expiryTimer); this.thread.expiryTimer = undefined }
      return
    }
    if (this.list) this.startList(this.list)
    if (this.thread) { this.thread.value = { ...this.thread.value, status: 'loading' }; void this.startThread(this.thread) }
  }
  close(): void {
    if (this.closed) return
    this.closed = true
    clearTimeout(this.thread?.expiryTimer); this.thread?.expired?.close()
    this.list?.stop?.(); this.thread?.stop?.(); this.thread?.roomStop?.(); this.list = null; this.thread = null
    this.attachments.clear(); this.scheduled.clear()
    this.reader?.close(); this.reader = null
  }
}
