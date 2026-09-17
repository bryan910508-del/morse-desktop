import { createHash } from 'node:crypto'
import type { ChannelInquiriesSnapshot, InquiryAttachmentMode, InquiryAttachmentRequest, InquiryVoiceRequest, InquiryListRequest, InquiryListSnapshot, InquiryMessageItem, InquiryMessageKind, InquiryPhotoRequest, InquiryRole, InquirySummary,
  InquiryTargetRequest, InquiryTextRequest, InquiryThreadRequest, InquiryThreadSnapshot } from '../../shared/channel-inquiries'
import type { MediaRequest } from '../../shared/media'
import { positionMilliseconds } from '../../shared/model'
import { mediaResources, type MediaResource } from '../media/media-document'
import { messageMediaMetadata } from '../media/message-media-metadata'
import { DocumentWriteFailure, FirestoreReader, type ReadCredentials } from '../network/firestore-rpc'
import { autoDeleteNoticeFields, boolField, documents, documentVersion, numberField, ReadFailure, stringField, timestamp, type FirestoreDocument, type WireObject } from '../network/firestore-values'
import { autoDeleteNoticeText, autoDeleteWirePrefix } from '../../shared/auto-delete-notice'
import { uploadInquiryAttachment, uploadInquiryPhoto } from '../network/inquiry-photo-upload-api'
import { AttachmentStaging } from '../media/attachment-staging'
import { forwardMediaFormat } from '../media/forward-media-format'
import { mediaType } from '../media/media-type'
import { maxVoiceCaptureBytes } from '../../shared/voice-capture'
import type { AttachmentDraft, VideoFacts } from '../../shared/uploads'
import { callMorseFunction, MorseCallableFailure } from '../network/morse-callable'
import type { PeoplePhotoResolver } from './channel-people-photos'
import { tr } from '../../shared/i18n'

interface Inquiry extends InquirySummary { role: InquiryRole; cutoff: number | null }
interface ListState { request: InquiryListRequest; stop: (() => void) | null; value: InquiryListSnapshot }
// The listened documents stay so an explicit photo selection can be resolved against the same row.
interface ThreadState { request: InquiryThreadRequest; stop: (() => void) | null; inquiry: Inquiry | null; marked: string; marking: boolean
  rows: Map<string, FirestoreDocument>; value: InquiryThreadSnapshot }

const kinds: readonly string[] = ['text', 'image', 'video', 'voice', 'file', 'sticker', 'location', 'event']
const labels: Record<string, string> = { image: tr('사진'), video: tr('동영상'), voice: tr('음성 메시지'), sticker: tr('스티커') }
function time(fields: Record<string, WireObject>, key: string): number | null {
  const raw = fields[key]?.timestampValue
  if (!raw) return null
  try { return positionMilliseconds(timestamp(raw, '')) } catch { return null }
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
    // A media message keeps its download URL in lastMessage (iOS stores the URL in text as well).
    lastMessage: (raw => /^https:\/\/firebasestorage\.googleapis\.com\//.test(raw) ? tr('사진') : raw)(stringField(f, 'lastMessage', 100000).slice(0, 300)), lastMessageAt: time(f, 'lastMessageAt'),
    unread: Math.max(0, Math.trunc(numberField(f, role === 'owner' ? 'unreadForOwner' : 'unreadForSubscriber'))), cutoff: time(f, 'historyRevokedAt') }
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
  return { id, own: stringField(f, 'senderId', 160) === uid, senderType: stringField(f, 'senderType', 32) === 'owner' ? 'owner' : 'subscriber', kind,
    text: kind === 'text' ? stringField(f, 'text', 30000) : caption, label, createdAt, edited: boolField(f, 'isEdited'),
    version: documentVersion(doc), ...(attachments.length ? { attachments } : {}),
    ...(metadata && Object.keys(metadata).length ? { mediaMetadata: metadata } : {}), ...(circular && kind === 'video' ? { circular: true as const } : {}) }
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

// ChannelInquiryService on Desktop: the owner's list for one channel and one open room, both live.
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
  constructor(private readonly uid: string, private readonly auth: ReadCredentials, private readonly allowed: () => void,
    private readonly author: () => { authorName: string; authorPhotoURL: string | null }, private readonly foreground: () => boolean, private readonly changed: () => void) {}

  get snapshot(): ChannelInquiriesSnapshot | null {
    if (!this.list && !this.thread) return null
    return { list: this.list ? { ...this.list.value, items: this.list.value.items.map(item => ({ ...item, photo: this.people?.(item.peerUid, this.photos.get(item.id) ?? null) ?? null })) } : null,
      thread: this.thread ? { ...this.thread.value, items: this.thread.value.items.map(item => ({ ...item })) } : null }
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
    const state: ThreadState = { request, stop: null, inquiry: null, marked: '', marking: false, rows: new Map(),
      value: { ...request, channelId: '', role: 'subscriber', title: '', channelName: '', status: 'loading', items: [], message: '' } }
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
      state.value = { ...state.value, channelId: inquiry.channelId, role: inquiry.role, title: inquiry.peerName, channelName: inquiry.channelName }
      // ChannelInquiryService.listenToMessages: the latest 300 messages.
      state.stop = reader.watch({ query: { parent: doc.name, structuredQuery: { from: [{ collectionId: 'messages' }],
        orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }, { field: { fieldPath: '__name__' }, direction: 'DESCENDING' }], limit: { value: 300 } } } }, this.auth.signal, {
        snapshot: rows => {
          if (this.thread !== state || !state.inquiry) return
          const current = state.inquiry
          state.rows = new Map(rows)
          const items = [...rows.values()].flatMap(row => { try { const item = decodeInquiryMessage(row, current, this.uid); return item ? [item] : [] } catch { return [] } })
          items.sort((a, b) => (a.createdAt ?? Number.MAX_SAFE_INTEGER) - (b.createdAt ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id))
          state.value = { ...state.value, status: 'ready', items, message: '' }
          this.changed(); this.markRead(state)
        },
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
    this.thread.stop?.(); this.thread = null; this.attachments.clear()
    this.changed()
  }
  // The microphone is granted to a recording only while its room is open, as a chat's is to its chat.
  requireOpenThread(request: InquiryThreadRequest): void { this.requireThread(request); this.allowed() }
  private requireThread(request: InquiryThreadRequest): ThreadState {
    const state = this.thread
    if (!state || state.request.requestId !== request.requestId || state.request.inquiryId !== request.inquiryId || !state.inquiry || state.value.status !== 'ready') throw new Error(tr('문의를 다시 열어 주세요.'))
    return state
  }

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

  // ChannelInquiryChatView uploadAndSendImage: the bytes reach storage first, then the same
  // canonical send the text path uses carries the download URL (iOS keeps it in text as well).
  async sendPhoto(request: InquiryPhotoRequest, bytes: Uint8Array): Promise<'sent' | 'unconfirmed'> {
    const state = this.requireThread(request)
    const validate = (): void => {
      this.allowed()
      if (this.closed || this.locked || this.thread !== state) throw new Error(tr('문의를 다시 열어 주세요.'))
    }
    validate()
    const url = await uploadInquiryPhoto(this.auth, this.uid,
      { inquiryId: request.inquiryId, messageId: request.messageId, bytes,
        sha256: createHash('sha256').update(bytes).digest('hex'), md5: createHash('md5').update(bytes).digest('base64') },
      AbortSignal.any([this.auth.signal, AbortSignal.timeout(180000)]), () => {}, validate)
    const payload = { inquiryId: request.inquiryId, clientMessageId: request.messageId, senderId: this.uid, senderType: state.value.role,
      type: 'image', text: url, mediaUrl: url, ...(request.caption ? { imageCaption: request.caption } : {}) }
    for (let attempt = 0; ; attempt++) {
      validate()
      try { await callMorseFunction(this.auth, 'sendMorseInquiryMessage', payload, AbortSignal.timeout(65000)); return 'sent' }
      catch (error) {
        if (!(error instanceof MorseCallableFailure && error.uncertain)) throw new Error(tr('사진을 보내지 못했습니다. 연결과 채널 구독 상태를 확인해 주세요.'))
        if (attempt >= 2) return 'unconfirmed'
        await new Promise(resolve => setTimeout(resolve, 1500 * (attempt + 1)))
        if (this.closed) return 'unconfirmed'
      }
    }
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
  // also carries its size and thumbnail, which the server keeps and Telegram clients send.
  async sendAttachment(request: InquiryAttachmentRequest, video: VideoFacts | null): Promise<'sent' | 'unconfirmed'> {
    const state = this.requireThread(request)
    const validate = (): void => {
      this.allowed()
      if (this.closed || this.locked || this.thread !== state) throw new Error(tr('문의를 다시 열어 주세요.'))
    }
    validate()
    const part = this.attachments.take(request.inquiryId, request.draftId, request.itemId)
    if (!part || (part.kind !== 'video' && part.kind !== 'file')) throw new Error(tr('첨부를 다시 선택해 주세요.'))
    const kind = part.kind, noun = kind === 'video' ? tr('동영상') : tr('파일')
    try {
      const extension = kind === 'file' ? 'bin' : part.extension === 'mov' ? 'mov' : 'mp4'
      const url = await uploadInquiryAttachment(this.auth, this.uid,
        { inquiryId: request.inquiryId, messageId: request.messageId, bytes: part.bytes, extension, noun,
          sha256: createHash('sha256').update(part.bytes).digest('hex'), md5: createHash('md5').update(part.bytes).digest('base64') },
        AbortSignal.any([this.auth.signal, AbortSignal.timeout(600000)]), () => {}, validate)
      const payload = { inquiryId: request.inquiryId, clientMessageId: request.messageId, senderId: this.uid, senderType: state.value.role, mediaUrl: url,
        ...inquiryAttachmentFields(kind, part.name, part.size, request.caption, video) }
      for (let attempt = 0; ; attempt++) {
        validate()
        try { await callMorseFunction(this.auth, 'sendMorseInquiryMessage', payload, AbortSignal.timeout(65000)); this.attachments.clear(request.draftId); return 'sent' }
        catch (error) {
          if (!(error instanceof MorseCallableFailure && error.uncertain)) throw new Error(tr('{0}을(를) 보내지 못했습니다. 연결과 채널 구독 상태를 확인해 주세요.', [noun]))
          if (attempt >= 2) { this.attachments.clear(request.draftId); return 'unconfirmed' }
          await new Promise(resolve => setTimeout(resolve, 1500 * (attempt + 1)))
          if (this.closed) return 'unconfirmed'
        }
      }
    } finally { part.bytes.fill(0) }
  }
  // ChannelInquiryChatView.uploadAndSendVideo(isCircle: true): a video message recorded here, stored as MP4 and
  // sent as a round video with its square size, whole seconds and thumbnail.
  async sendRoundVideo(request: InquiryTargetRequest, bytes: Uint8Array, facts: { duration: number; thumb: string }, side: number): Promise<'sent' | 'unconfirmed'> {
    const state = this.requireThread(request)
    const validate = (): void => {
      this.allowed()
      if (this.closed || this.locked || this.thread !== state) throw new Error(tr('문의를 다시 열어 주세요.'))
    }
    validate()
    const source = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const type = mediaType(source)
    if (type.kind !== 'video' || type.extension !== 'mp4' || source.length >= 50 * 1024 * 1024) throw new Error(tr('녹화한 영상 메시지의 형식이나 크기를 확인해 주세요.'))
    const url = await uploadInquiryAttachment(this.auth, this.uid,
      { inquiryId: request.inquiryId, messageId: request.messageId, bytes: source, extension: 'mp4', noun: tr('영상 메시지'),
        sha256: createHash('sha256').update(source).digest('hex'), md5: createHash('md5').update(source).digest('base64') },
      AbortSignal.any([this.auth.signal, AbortSignal.timeout(600000)]), () => {}, validate)
    const payload = { inquiryId: request.inquiryId, clientMessageId: request.messageId, senderId: this.uid, senderType: state.value.role, mediaUrl: url,
      ...inquiryAttachmentFields('video', 'video-message.mp4', source.length, '', { duration: facts.duration, width: side, height: side, thumb: facts.thumb }), isCircleVideo: true }
    for (let attempt = 0; ; attempt++) {
      validate()
      try { await callMorseFunction(this.auth, 'sendMorseInquiryMessage', payload, AbortSignal.timeout(65000)); return 'sent' }
      catch (error) {
        if (!(error instanceof MorseCallableFailure && error.uncertain)) throw new Error(tr('영상 메시지를 보내지 못했습니다. 연결과 채널 구독 상태를 확인해 주세요.'))
        if (attempt >= 2) return 'unconfirmed'
        await new Promise(resolve => setTimeout(resolve, 1500 * (attempt + 1)))
        if (this.closed) return 'unconfirmed'
      }
    }
  }
  // ChannelInquiryChatView.uploadAndSendVoice: the recording is stored as M4A, then sent with its whole
  // seconds and waveform and no text.
  async sendVoice(request: InquiryVoiceRequest, bytes: Uint8Array): Promise<'sent' | 'unconfirmed'> {
    const state = this.requireThread(request)
    const validate = (): void => {
      this.allowed()
      if (this.closed || this.locked || this.thread !== state) throw new Error(tr('문의를 다시 열어 주세요.'))
    }
    validate()
    const source = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    if (source.length < 16 || source.length >= maxVoiceCaptureBytes) throw new Error(tr('녹음 크기를 확인해 주세요.'))
    forwardMediaFormat('voice', source)
    const url = await uploadInquiryAttachment(this.auth, this.uid,
      { inquiryId: request.inquiryId, messageId: request.messageId, bytes: source, extension: 'm4a', noun: tr('음성 메시지'),
        sha256: createHash('sha256').update(source).digest('hex'), md5: createHash('md5').update(source).digest('base64') },
      AbortSignal.any([this.auth.signal, AbortSignal.timeout(180000)]), () => {}, validate)
    const payload = { inquiryId: request.inquiryId, clientMessageId: request.messageId, senderId: this.uid, senderType: state.value.role,
      ...inquiryVoiceFields(url, request.duration, request.waveform) }
    for (let attempt = 0; ; attempt++) {
      validate()
      try { await callMorseFunction(this.auth, 'sendMorseInquiryMessage', payload, AbortSignal.timeout(65000)); return 'sent' }
      catch (error) {
        if (!(error instanceof MorseCallableFailure && error.uncertain)) throw new Error(tr('음성 메시지를 보내지 못했습니다. 연결과 채널 구독 상태를 확인해 주세요.'))
        if (attempt >= 2) return 'unconfirmed'
        await new Promise(resolve => setTimeout(resolve, 1500 * (attempt + 1)))
        if (this.closed) return 'unconfirmed'
      }
    }
  }
  // markMorseInquiryRead: the newest message from the other side, once, while the room is on screen.
  private markRead(state: ThreadState): void {
    const latest = [...state.value.items].reverse().find(item => !item.own)
    if (!latest || state.marked === latest.id || state.marking || this.locked || this.closed || !this.foreground()) return
    state.marking = true
    void callMorseFunction(this.auth, 'markMorseInquiryRead', { inquiryId: state.request.inquiryId, messageId: latest.id, expectedUid: this.uid }, AbortSignal.timeout(65000))
      .then(() => { state.marking = false; state.marked = latest.id; if (this.thread === state) this.markRead(state) }, () => { state.marking = false })
  }

  // sendMorseInquiryMessage accepts one message per client id, so an unconfirmed attempt is repeated with the same id.
  async send(request: InquiryTextRequest): Promise<'sent' | 'unconfirmed'> {
    const state = this.requireThread(request)
    const payload = { inquiryId: request.inquiryId, clientMessageId: request.messageId, senderId: this.uid, senderType: state.value.role, type: 'text', text: request.text }
    for (let attempt = 0; ; attempt++) {
      this.allowed()
      try { await callMorseFunction(this.auth, 'sendMorseInquiryMessage', payload, AbortSignal.timeout(65000)); return 'sent' }
      catch (error) {
        if (!(error instanceof MorseCallableFailure && error.uncertain)) throw new Error(tr('메시지를 보내지 못했습니다. 연결과 채널 구독 상태를 확인해 주세요.'))
        if (attempt >= 2) return 'unconfirmed'
        await new Promise(resolve => setTimeout(resolve, 1500 * (attempt + 1)))
        if (this.closed) return 'unconfirmed'
      }
    }
  }
  async edit(request: InquiryTextRequest): Promise<void> {
    const state = this.requireThread(request), item = state.value.items.find(entry => entry.id === request.messageId)
    if (!item || !item.own || item.kind !== 'text') throw new Error(tr('내가 보낸 텍스트 메시지만 수정할 수 있습니다.'))
    this.allowed()
    try { await this.source.editInquiryMessage(request.inquiryId, request.messageId, request.text, this.signal()) }
    catch (error) { throw new Error(error instanceof DocumentWriteFailure && error.uncertain ? tr('수정 결과를 확인하지 못했습니다. 잠시 후 대화를 확인해 주세요.') : tr('메시지를 수정하지 못했습니다.')) }
  }
  async remove(request: InquiryTargetRequest): Promise<void> {
    const state = this.requireThread(request), item = state.value.items.find(entry => entry.id === request.messageId)
    if (!item || !item.own) throw new Error(tr('내가 보낸 메시지만 삭제할 수 있습니다.'))
    this.allowed()
    try { await this.source.deleteInquiryMessage(request.inquiryId, request.messageId, this.signal()) }
    catch (error) { throw new Error(error instanceof DocumentWriteFailure && error.uncertain ? tr('삭제 결과를 확인하지 못했습니다. 잠시 후 대화를 확인해 주세요.') : tr('메시지를 삭제하지 못했습니다.')) }
  }
  async clear(request: InquiryThreadRequest): Promise<'done' | 'unconfirmed'> {
    const state = this.requireThread(request)
    this.allowed()
    let result: Record<string, unknown>
    try { result = await callMorseFunction(this.auth, 'clearMorseInquiryHistory', { inquiryId: request.inquiryId }, AbortSignal.timeout(65000)) }
    catch (error) {
      if (error instanceof MorseCallableFailure && error.uncertain) return 'unconfirmed'
      throw new Error(tr('대화 기록을 삭제하지 못했습니다.'))
    }
    if (this.thread === state && state.inquiry) {
      const cutoff = typeof result.cutoff === 'number' ? result.cutoff : Date.now()
      state.inquiry.cutoff = cutoff
      state.value = { ...state.value, items: state.value.items.filter(item => item.createdAt !== null && item.createdAt > cutoff) }
      this.changed()
    }
    return 'done'
  }

  setLocked(locked: boolean): void {
    if (this.locked === locked) return
    this.locked = locked
    if (locked) {
      this.attachments.clear()
      if (this.list) { this.list.stop?.(); this.list.stop = null }
      if (this.thread) { this.thread.stop?.(); this.thread.stop = null }
      return
    }
    if (this.list) this.startList(this.list)
    if (this.thread) { this.thread.value = { ...this.thread.value, status: 'loading' }; void this.startThread(this.thread) }
  }
  close(): void {
    if (this.closed) return
    this.closed = true
    this.list?.stop?.(); this.thread?.stop?.(); this.list = null; this.thread = null
    this.attachments.clear()
    this.reader?.close(); this.reader = null
  }
}
