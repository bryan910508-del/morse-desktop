import { createHash } from 'node:crypto'
import { voiceSendRequest, type VoiceSendRequest } from '../../shared/voice-send'
import type { MediaSendWire } from '../../shared/model'
import type { VideoFacts } from '../../shared/uploads'
import type { StoryReplyDetachCommand } from '../storage/story-reply-detach-table'
import type { StoryReplyDetachReceipt } from '../../shared/story-reply-detach'
import type { StoryReplySendCommand } from '../storage/story-reply-send-table'
import { storyReplyWire } from './story-reply-wire'
import type { PendingStoryReplyDraft } from '../../shared/story-reply-draft'
import type { StoryReplySendReceipt } from '../../shared/story-reply-send'
import type { StoryReplyDraftCommand } from '../storage/story-reply-draft-table'
import type { StoryViewReceiptCommand } from '../storage/story-view-receipt-table'
import type { StoryReactionChangeCommand } from '../storage/story-reaction-change-table'
import type { StoryPublicationCommand } from '../storage/story-publication-table'
import type { StoryComposerPhotoCommand } from '../storage/story-composer-photos'
import type { StoryComposerDraftCommand } from '../storage/story-composer-drafts'
import type { StoryHiddenChangeCommand } from '../storage/story-hidden-change-table'
import type { StoryPrivacyMoveCommand } from '../storage/story-privacy-move-table'
import type { StoryRemovalCommand } from '../storage/story-removal-table'
import type { StoryCaptionSaveCommand } from '../storage/story-caption-save-table'
import type { StoryCaptionDraftCommand } from '../storage/story-caption-drafts'
import type { NoteRemovalCommand } from '../storage/space-note-removal-table'
import type { NoteTextSaveCommand } from '../storage/space-note-text-save-table'
import type { NoteEditDraftCommand } from '../storage/space-note-edit-drafts'
import type { NoteCreationCommand } from '../storage/space-note-creation-table'
import type { NoteDraftCommand } from '../storage/space-note-drafts'
import type { ChannelCreationCommand } from '../storage/channel-creation-table'
import type { CommentCreationCommand } from '../storage/channel-comment-creation-table'
import type { PostCreationCommand } from '../storage/channel-post-creation-table'
import type { PostDraftCommand } from '../storage/channel-post-drafts'
import type { CommentDraftCommand } from '../storage/channel-comment-drafts'
import type { DiscussionJoinCommand } from '../storage/channel-discussion-join-table'
import type { PendingDiscussionJoin } from '../../shared/channel-discussion-join'
import type { DiscussionLeaveWorkDismiss } from '../../shared/channel-discussion-leave-work'
import type { DiscussionLeaveWorkCommand } from '../storage/discussion-leave-work'
import type { ChannelJoinDecisionCommand } from '../storage/channel-join-decision-table'
import type { ChannelAccessCommand } from '../storage/channel-access-table'
import type { ChannelPhotoUploadCommand } from '../storage/channel-photo-upload-table'
import type { DialogSummary, MessagePosition, SendAcknowledgement, SendWire, TextSendWire } from '../../shared/model'
import type { AttachmentMode, AttachmentDropMode } from '../../shared/uploads'
import { AttachmentStaging, type VideoEdit } from '../media/attachment-staging'
import { uploadAttachment, UploadFailure } from '../network/media-upload-api'
import type { ReadAcknowledgement } from '../../shared/read-receipts'
import type { ReadReceiptCommand } from '../storage/read-receipt-protocol'
import type { MessageActionCommand } from '../storage/message-action-protocol'
import type { NotificationCommand } from '../storage/notification-protocol'
import type { OutgoingSnapshot, PendingDirect } from '../../shared/delivery'
import type { ReplyBinding } from '../../shared/reply-draft'
import type { ForwardRequest } from '../../shared/forward'
import type { PreparedForwardMedia } from '../storage/forward-media-protocol'
import type { TextForwardBatchRequest } from '../../shared/forward-text-batch'
import type { ForwardBatchRequest } from '../../shared/forward-batch'
import { clearForwardBatch, type PreparedForwardItem } from '../storage/forward-batch-protocol'
import type { ReplyDraftCommand } from '../storage/reply-draft-table'
import type { MessageBookmarkCommand } from '../storage/message-bookmark-table'
import type { EventReminderCommand } from '../storage/event-reminder-table'
import type { ContactDetailsCommand } from '../storage/contact-details-table'
import type { ContactPhotoCommand } from '../storage/contact-photo-table'
import type { GroupPhotoUploadCommand } from '../storage/group-photo-upload-table'
import type { ChatBackgroundCommand } from '../storage/chat-background-table'
import type { ProfileUploadCommand } from '../storage/profile-photo-upload-table'
import { maxQueuedMessages } from '../../shared/delivery'
import { outgoingText } from '../../shared/validation'
import { DeliveryCommandFailure, DeliveryRepository, LocalDataKeyUnavailable } from '../storage/delivery-client'
import { recordDeliveryStep } from '../platform/delivery-diagnostics'
import type { DeliveryCommand, StoredIntent } from '../storage/delivery-protocol'
import { FirestoreReader, type ReadCredentials } from '../network/firestore-rpc'
import { documents, stringField } from '../network/firestore-values'
import { NotEmitted, ServerRejection } from '../network/contracts'
import { outgoingCategory } from '../../shared/forum'
import { stickerContentType, stickerSidePx, type StickerKind } from '../../shared/stickers'
import { definiteRejections, deliveryReason, retryableRejections, textDigest } from './text-identity'
import { draftPreviewChars } from '../../shared/chat-list-preview'
import { directChatId } from './direct-chat-id'
import { tr } from '../../shared/i18n'

// The delivery worker words a waiting attachment in Korean («사진 3장», «음성 메시지.m4a», «스티커.png»); the chat shows it in
// the app's language.
function pendingText(row: StoredIntent): string {
  if (row.parts && row.parts.length > 1) return tr('사진 {0}장', [row.parts.length])
  const named = row.upload ? /^(음성 메시지|스티커)\.(\w+)$/u.exec(row.upload.name) : null
  return named ? `${tr(named[1]!)}.${named[2]}` : row.text
}

export interface AccountAuthorization extends ReadCredentials {
  storageScope: string
  sender: { readonly ready: boolean; send(wire: SendWire, signal: AbortSignal): Promise<SendAcknowledgement>
    markRead(chatId: string, target: MessagePosition, signal: AbortSignal): Promise<ReadAcknowledgement>
    // The socket's setReaction, while the server offers it (docs/reaction-socket-contract-2026-09-22.md).
    readonly reactions?: boolean; react?(payload: Record<string, unknown>, signal: AbortSignal): Promise<unknown> }
}
interface ReadContext { ready: boolean; dialogs: Map<string, DialogSummary>; reader: FirestoreReader | null }

export class OutboxPump {
  private repository: DeliveryRepository | null = null
  private readonly opening: Promise<void>
  private storyCaptionDraftsKnown = new Set<string>()
  private noteEditDraftsKnown = new Set<string>()
  private storyComposerDraftsKnown = new Set<string>()
  private noteDraftsKnown = new Set<string>()
  private postDraftsKnown = new Set<string>()
  private commentDraftsKnown = new Set<string>()
  private joinChat: string | null = null
  private initialized = false
  private closed = false
  private storageFailed = false
  private storageReason: 'key' | 'storage' = 'storage'
  private generation = new AbortController()
  private task: Promise<void> | null = null
  private rerun = false
  private wake?: ReturnType<typeof setTimeout>
  private retryAt = new Map<string, { at: number; attempts: number }>()
  // Telegram never takes a sent message off the screen: the local item stays and only takes its server id
  // (Api::Updates updateMessageID → HistoryItem::setRealId). Morse's message is written under the id it was sent
  // with, but the history learns of it a moment after the server's answer; until then the sent item is kept here,
  // so the bubble does not leave and come back. The history showing the id, or a minute, ends it.
  private sent = new Map<string, { row: StoredIntent; timer: ReturnType<typeof setTimeout> }>()
  private busyId: string | null = null
  private views = new Set<string>()
  private known = new Set<string>()
  private revision = 0
  private pending = new Map<string, PendingDirect>()
  // Rooms this session folded into the pair's dialog: a window still showing one is sent to the dialog.
  private superseded = new Map<string, { peerUid: string; dialogId: string }>()
  private pendingRevision = 0
  private readonly staging = new AttachmentStaging()
  private uploadAbort: AbortController | null = null
  private uploadChatId: string | null = null
  private uploadProgress: { loaded: number; total: number; current: number; count: number } | undefined

  constructor(private readonly uid: string, directory: string, private readonly auth: AccountAuthorization,
    previousClose: Promise<void>, private readonly context: () => ReadContext,
    private readonly changed: (chatId: string, snapshot: OutgoingSnapshot) => void,
    private readonly pendingChanged: () => void,
    private readonly newChatAutoDelete: () => { seconds: number } = () => ({ seconds: 0 })) {
    this.opening = (async () => {
      await previousClose
      if (this.closed || auth.signal.aborted) return
      this.repository = new DeliveryRepository(directory, uid, auth.storageScope)
      await this.repository.call({ kind: 'ready' })
      const pending = await this.repository.call<PendingDirect[]>({ kind: 'direct-list' })
      this.pending = new Map(pending.map(row => [row.chatId, row]))
      const participation = await this.repository.call<PendingDiscussionJoin | null>({ kind: 'discussion-join-read' })
      this.joinChat = participation?.chatId ?? null
      this.initialized = true
      if (!this.closed) { this.resume(); void this.publish(); this.pendingChanged() }
    })().catch(error => {
      // Until now the reason was dropped here, so a refused keychain and a worker that never started
      // looked the same from the outside: «앱을 다시 열어 주세요» and nothing written down.
      const key = error instanceof LocalDataKeyUnavailable
      recordDeliveryStep('open-failed', key ? 'key' : error instanceof DeliveryCommandFailure ? `ready-${error.code}` : error instanceof Error ? error.name : 'unknown')
      this.blockStorage(key ? 'key' : 'storage')
    })
  }
  // A dialog is its peer (Telegram PeerId): a room whose pair already has a dialog under another id is that
  // dialog. It is reported with supersededBy, so it is not listed and a window showing it moves over.
  pendingDirects(): PendingDirect[] {
    const rows: PendingDirect[] = []
    for (const row of this.pending.values()) {
      if (this.matchesDirect(row)) continue
      // A room that already sent something keeps its row: its messages are stored under its id.
      const dialogId = row.canDiscard ? this.peerDialogId(row.peerUid) : null
      rows.push(dialogId ? { ...row, supersededBy: dialogId } : { ...row })
    }
    for (const [chatId, moved] of this.superseded) if (!this.pending.has(chatId)) rows.push({ chatId, peerUid: moved.peerUid, displayName: '', createdAt: 0, canDiscard: false, supersededBy: moved.dialogId })
    return rows
  }
  private peerDialogId(peerUid: string): string | null {
    for (const dialog of this.context().dialogs.values()) if (dialog.kind === 'direct' && dialog.participantUids.length === 2 &&
      dialog.participantUids.includes(this.uid) && dialog.participantUids.includes(peerUid)) return dialog.id
    return null
  }
  private matchesDirect(row: Pick<PendingDirect, 'chatId' | 'peerUid'>): boolean {
    const dialog = this.context().dialogs.get(row.chatId)
    return Boolean(dialog?.kind === 'direct' && dialog.participantUids.length === 2 &&
      dialog.participantUids.includes(this.uid) && dialog.participantUids.includes(row.peerUid))
  }
  private targetExists(chatId: string): boolean {
    const dialog = this.context().dialogs.get(chatId), pending = this.pending.get(chatId)
    if (dialog) return dialog.kind !== 'secret' && dialog.participantUids.includes(this.uid) && (!pending || this.matchesDirect(pending))
    return Boolean(pending)
  }
  private async refreshPending(): Promise<void> {
    const revision = ++this.pendingRevision
    const rows = await this.store<PendingDirect[]>({ kind: 'direct-list' })
    if (this.closed || revision !== this.pendingRevision) return
    // A room's compose state is a function of the dialogs and of these rows (targetExists). A 1:1 keeps its id,
    // so the room that lost its chat document and the room opened again with the same person are one view:
    // without a new frame it kept "대화와 연결을 확인한 뒤 전송할 수 있습니다." from the moment the document went.
    this.pending = new Map(rows.map(row => [row.chatId, row])); this.pendingChanged(); void this.publish()
  }
  async openDirect(peer: { uid: string; displayName: string }): Promise<string> {
    await this.opening
    if (!this.active(this.generation.signal)) throw new Error(tr('대화 목록과 연결을 확인해 주세요.'))
    const existing = [...this.context().dialogs.values()].find(chat => chat.kind === 'direct' && chat.participantUids.length === 2 &&
      chat.participantUids.includes(this.uid) && chat.participantUids.includes(peer.uid))
    if (existing) return existing.id
    let chatId: string
    try { chatId = await this.store<string>({ kind: 'direct-open', chatId: directChatId(this.uid, peer.uid), peerUid: peer.uid, displayName: peer.displayName }) }
    catch (error) {
      if (error instanceof DeliveryCommandFailure && error.code === 'capacity') throw new Error(tr('작성 중인 새 대화는 100개까지 보관할 수 있습니다.'))
      throw error
    }
    await this.refreshPending(); this.known.add(chatId); return chatId
  }
  async discardDirect(chatId: string): Promise<void> {
    if (!this.pending.has(chatId) || this.context().dialogs.has(chatId)) throw new Error(tr('작성 중인 새 대화를 다시 선택해 주세요.'))
    if (!await this.store<boolean>({ kind: 'direct-discard', chatId })) throw new Error(tr('이미 전송을 시작한 대화는 여기서 삭제할 수 없습니다.'))
    this.known.delete(chatId); await this.refreshPending()
  }
  // What this device can write into the queue: the storage is open and the room is one this account
  // may write to. The connection is not part of it — Telegram decides whether a person may write from
  // rights alone (HistoryWidget's _canSendMessages comes from Data::CanSendAnyOf(peer, restrictions);
  // neither it nor send() looks at the connection), and a message written while the connection is
  // coming back is queued and goes when it returns. That is what this outbox already does: enqueue
  // writes to the delivery store and the pump, which does check the connection, sends it later.
  private writable(chatId: string): boolean {
    return !this.closed && !this.auth.signal.aborted && !this.storageFailed && this.initialized &&
      this.targetExists(chatId) && this.joinChat !== chatId
  }
  private queueAvailable(chatId: string): boolean {
    return this.writable(chatId) && this.auth.sender.ready && this.context().ready
  }
  private composeAllowed(chatId: string): boolean { return this.context().dialogs.get(chatId)?.composeAccess !== false }
  private eligible(chatId: string): boolean { return this.writable(chatId) && this.composeAllowed(chatId) }
  private active(signal: AbortSignal): boolean {
    return !this.closed && !signal.aborted && !this.auth.signal.aborted && this.context().ready && this.auth.sender.ready && !this.storageFailed
  }
  private async store<T = void>(command: DeliveryCommand, validate: () => void = () => {}): Promise<T> {
    await this.opening
    // close() waits for the drain before closing the worker. During that wait,
    // only a proven pre-emission claim release may still write to local storage.
    if ((this.closed && command.kind !== 'release-unemitted') || this.storageFailed || !this.repository) throw new Error(tr('전송 저장소를 사용할 수 없습니다.'))
    validate()
    try { return await this.repository.call<T>(command) }
    // A command that failed is not a storage that is gone: only a store that has given up stops the
    // account from writing, as Telegram keeps its cache database after an operation returns an error.
    catch (error) { if (!this.repository?.usable) this.blockStorage('storage'); throw error }
  }
  // Read synchronization owns a separate coordinator/table and shares only the
  // account/session-scoped worker's storage lifetime and close barrier.
  readState<T>(command: ReadReceiptCommand): Promise<T> { return this.store<T>(command) }
  actionState<T>(command: MessageActionCommand): Promise<T> { return this.store<T>(command) }
  notificationState<T>(command: NotificationCommand): Promise<T> { return this.store<T>(command) }
  replyState<T>(command: ReplyDraftCommand): Promise<T> { return this.store<T>(command) }
  bookmarkState<T>(command: MessageBookmarkCommand): Promise<T> { return this.store<T>(command) }
  // Telegram's "Delete chat" for me only: the rooms this device hides, kept in the delivery store.
  hiddenChatState<T>(command: import('../storage/hidden-chat-table').HiddenChatCommand): Promise<T> { return this.store<T>(command) }
  hiddenMessageState<T>(command: import('../storage/hidden-message-table').HiddenMessageCommand): Promise<T> { return this.store<T>(command) }
  chatFlagState<T>(command: import('../storage/chat-flag-table').ChatFlagCommand): Promise<T> { return this.store<T>(command) }
  contactFlagState<T>(command: import('../storage/contact-flag-table').ContactFlagCommand): Promise<T> { return this.store<T>(command) }
  stickerState<T>(command: import('../storage/sticker-table').StickerCommand): Promise<T> { return this.store<T>(command) }
  // The picture cache is a copy of server pictures: its failures never block the delivery storage.
  async userpicState<T>(command: import('../storage/userpic-cache-table').UserpicCommand): Promise<T> {
    await this.opening
    if (this.closed || this.storageFailed || !this.repository) throw new Error(tr('전송 저장소를 사용할 수 없습니다.'))
    return this.repository.call<T>(command)
  }
  // Storage::Cache::Database: media already fetched. Like the picture cache it is a copy of what the server sent.
  async mediaCacheState<T>(command: import('../storage/media-cache-table').MediaCacheCommand): Promise<T> {
    await this.opening
    if (this.closed || this.storageFailed || !this.repository) throw new Error(tr('전송 저장소를 사용할 수 없습니다.'))
    return this.repository.call<T>(command)
  }
  // The addresses of pictures already seen: a copy of what the server showed, never a picture itself.
  peerPhotoState<T>(command: import('../storage/peer-photo-table').PeerPhotoCommand): Promise<T> { return this.store<T>(command) }
  reminderState<T>(command: EventReminderCommand): Promise<T> { return this.store<T>(command) }
  profilePhotoState<T>(command: ProfileUploadCommand, validate: () => void = () => {}): Promise<T> { return this.store<T>(command, validate) }
  voiceDraftStorageState<T>(command:import('../storage/voice-draft-storage-table').VoiceDraftStorageCommand,validate:()=>void):Promise<T>{return this.store<T>(command,validate)}
  async voiceDraftState<T>(command:import('../storage/voice-draft-table').VoiceDraftCommand,validate:()=>void):Promise<T>{
    const chatId=command.kind==='voice-draft-read'?command.chatId:command.kind==='voice-draft-source'?command.reference.chatId:command.request.chatId
    await this.opening;this.voiceQueueAccess(chatId);validate()
    const result=await this.store<T>(command,validate)
    try{this.voiceQueueAccess(chatId);validate();return result}catch(error){if(command.kind==='voice-draft-source')(result as import('../../shared/voice-draft').VoiceDraftSource)?.bytes.fill(0);throw error}
  }
  voiceQueueAccess(chatId:string):void{if(!this.queueAvailable(chatId) || !this.context().dialogs.has(chatId))throw new Error(tr('현재 대화의 전송 보관함을 확인해 주세요.'))}
  async voiceQueueSource(reference:import('../../shared/voice-queue-preview').VoiceQueueReference,validate:()=>void):Promise<import('../../shared/voice-queue-preview').VoiceQueueSource|null>{
    await this.opening;this.voiceQueueAccess(reference.chatId);validate()
    const source=await this.store<import('../../shared/voice-queue-preview').VoiceQueueSource|null>({kind:'voice-queue-source',reference},validate)
    try{this.voiceQueueAccess(reference.chatId);validate();return source}catch(error){source?.bytes.fill(0);throw error}
  }
  voiceCaptureAccess(chatId:string):void{if(!this.context().dialogs.has(chatId) || !this.eligible(chatId) || this.staging.hasWork(chatId))throw new Error(tr('현재 대화와 첨부 선택을 확인해 주세요.'))}
  hasLeaveAttachment(chatId: string): boolean { return this.staging.hasWork(chatId) }
  discussionLeaveWorkState<T>(command: DiscussionLeaveWorkCommand, validate: () => void): Promise<T> { return this.store<T>(command, validate) }
  requireLeaveReady(chatId: string): void {
    if (this.staging.hasWork(chatId)) throw new Error(tr('선택 중인 첨부를 보내거나 취소한 뒤 나가기를 준비해 주세요.'))
  }
  async discussionJoinState<T>(command: DiscussionJoinCommand, validate: () => void = () => {}): Promise<T> {
    await this.opening
    if (command.kind === 'discussion-join-prepare') {
      validate(); this.requireLeaveReady(command.request.chatId)
      this.joinChat = command.request.chatId; void this.publish()
    }
    try {
      const pending = await this.store<PendingDiscussionJoin | null>(command, validate)
      this.joinChat = pending?.chatId ?? null
      return pending as T
    } catch (error) {
      // A timed-out write may have committed. Only a successful worker read
      // can release the in-memory barrier; storage failure blocks all sending.
      try { this.joinChat = (await this.store<PendingDiscussionJoin | null>({ kind: 'discussion-join-read' }))?.chatId ?? null } catch { /* keep the barrier */ }
      throw error
    } finally { void this.publish() }
  }
  channelJoinDecisionState<T>(command: ChannelJoinDecisionCommand, validate: () => void = () => {}): Promise<T> { return this.store<T>(command, validate) }
  channelAccessState<T>(command: ChannelAccessCommand, validate: () => void = () => {}): Promise<T> { return this.store<T>(command, validate) }
  channelPhotoUploadState<T>(command: ChannelPhotoUploadCommand, validate: () => void = () => {}): Promise<T> { return this.store<T>(command, validate) }
  groupPhotoUploadState<T>(command: GroupPhotoUploadCommand, validate: () => void = () => {}): Promise<T> { return this.store<T>(command, validate) }
  async backgroundState<T>(command: ChatBackgroundCommand, validate: () => void): Promise<T> {
    try { return await this.store<T>(command, validate) }
    catch (error) {
      if (error instanceof DeliveryCommandFailure && error.code === 'capacity') throw new Error(tr('배경 저장 한도에 도달했습니다. 설정의 저장공간 → 대화별 사진 배경에서 보관 사진을 정리해 주세요.'))
      throw error
    }
  }
  private earlierForward(row: StoredIntent, rows: StoredIntent[]): boolean {
    return Boolean(row.forwardOperationId && rows.some(earlier => earlier.sequence < row.sequence && earlier.chatId === row.chatId && earlier.forwardOperationId === row.forwardOperationId))
  }
  private frame(chatId: string, rows: StoredIntent[], revision: number): OutgoingSnapshot {
    const visible = !this.closed && !this.auth.signal.aborted && this.targetExists(chatId)
    return { revision, canCompose: this.eligible(chatId), canDiscard: this.queueAvailable(chatId), policyHeld: !this.composeAllowed(chatId), writingBlocked: this.joinChat === chatId || !this.composeAllowed(chatId), message: this.storageFailed ? (this.storageReason === 'key' ? tr('키체인 접근을 허용한 뒤 앱을 다시 열어 주세요.') : tr('전송 저장소를 사용할 수 없습니다. 앱을 다시 열어 주세요.')) :
      !this.initialized ? tr('전송 기록을 불러오는 중…') : this.joinChat === chatId ? tr('토론방 참여 기록을 확인한 뒤 작성할 수 있습니다.') : !this.composeAllowed(chatId) ? this.context().dialogs.get(chatId)?.composeMessage || tr('토론방 작성 조건을 확인해 주세요.') : !this.eligible(chatId) ? tr('이 대화에는 지금 메시지를 보낼 수 없습니다.') : '',
      items: visible ? [...rows.filter(row => row.chatId === chatId), ...[...this.sent.values()].map(entry => entry.row)
        .filter(row => row.chatId === chatId && !rows.some(other => other.id === row.id))].map(row => this.sent.has(row.id) && !rows.some(other => other.id === row.id) ? {
        id: row.id, chatId, text: pendingText(row), replyToId: row.wire.replyToId, createdAt: row.createdAt, state: 'sent' as const, reason: '', busy: false,
        voicePreview: row.voicePreview, forwarded: row.forwarded, storyReply: Boolean(row.wire.replyStoryId), retryable: false } : ({ id: row.id, chatId, text: pendingText(row), replyToId: row.wire.replyToId, createdAt: row.createdAt,
        state: row.state, reason: this.earlierForward(row, rows) ? tr('앞선 전달 메시지의 결과 확인 또는 대기 정리가 필요합니다.') : row.state === 'uploading' ? tr('첨부 업로드 대기 중') : row.state === 'queued' ? tr('메시지 전송 대기 중') : deliveryReason(row.reason), busy: this.busyId === row.id,
        voicePreview:row.voicePreview, forwarded: row.forwarded, storyReply: Boolean(row.wire.replyStoryId), progress: this.busyId === row.id ? this.uploadProgress : undefined,
        retryable: row.state === 'upload-failed' || (row.state === 'failed' && retryableRejections.has(row.reason)) })) : [] }
  }
  private keepSent(row: StoredIntent): void {
    if (this.closed) return
    clearTimeout(this.sent.get(row.id)?.timer)
    const timer = setTimeout(() => { if (this.sent.get(row.id)?.timer === timer) { this.sent.delete(row.id); void this.publish() } }, 60000)
    this.sent.set(row.id, { row, timer })
  }
  // The open history now shows these messages: their sent items have handed over.
  shown(chatId: string, ids: ReadonlySet<string>): void {
    let changed = false
    for (const [id, entry] of this.sent) if (entry.row.chatId === chatId && ids.has(id)) { clearTimeout(entry.timer); this.sent.delete(id); changed = true }
    if (changed) void this.publish()
  }
  async snapshot(chatId: string): Promise<OutgoingSnapshot> {
    this.views.add(chatId)
    if (this.targetExists(chatId)) this.known.add(chatId)
    const revision = ++this.revision
    try { return this.frame(chatId, await this.store<StoredIntent[]>({ kind: 'list', chatId }), revision) }
    catch { return this.frame(chatId, [], revision) }
  }
  forget(chatId: string): void { this.views.delete(chatId) }
  private async publish(): Promise<void> {
    const revision = ++this.revision
    let rows: StoredIntent[] = [], drafts: Record<string, string> = {}
    if (this.initialized && !this.closed && !this.storageFailed) {
      try { rows = await this.store<StoredIntent[]>({ kind: 'list' }) } catch { /* frame exposes the storage failure */ }
      try { drafts = await this.store<Record<string, string>>({ kind: 'drafts' }) } catch { /* a row simply shows its last message */ }
    }
    this.noteChatSends(rows)
    this.noteChatDrafts(drafts)
    for (const chatId of this.views) this.changed(chatId, this.frame(chatId, rows, revision))
  }
  // iOS MorseChatListRowDisplay hasFailedOutgoing / hasSendingOutgoing: a room's row marks a message of mine that
  // did not go, and a clock while the newest of mine is still on its way.
  private chatSends = new Map<string, { failed: boolean; newest: number }>()
  private noteChatSends(rows: StoredIntent[]): void {
    const next = new Map<string, { failed: boolean; newest: number }>()
    for (const row of rows) {
      const entry = next.get(row.chatId) ?? { failed: false, newest: 0 }
      if (row.state === 'failed' || row.state === 'upload-failed') entry.failed = true
      else entry.newest = Math.max(entry.newest, row.createdAt)
      next.set(row.chatId, entry)
    }
    const same = next.size === this.chatSends.size && [...next].every(([id, value]) => {
      const old = this.chatSends.get(id); return old?.failed === value.failed && old.newest === value.newest
    })
    this.chatSends = next
    if (!same) this.pendingChanged()
  }
  // `top`: the room's last message on the server. Mine still going is the newest only if it came after that.
  chatSendState(chatId: string, top: number | null): { sending: boolean; failed: boolean } {
    const entry = this.chatSends.get(chatId)
    return { failed: Boolean(entry?.failed), sending: Boolean(entry?.newest && (top === null || entry.newest > top)) }
  }
  // Telegram's chat list shows what this account was writing in a room it left (dialogs_layout.cpp
  // paints lng_from_draft in place of the last message). The drafts are this device's own, so they are
  // kept here beside the sends and read back without touching the store.
  private chatDrafts = new Map<string, string>()
  private noteChatDrafts(next: Record<string, string>): void {
    const entries = Object.entries(next)
    const same = entries.length === this.chatDrafts.size && entries.every(([id, text]) => this.chatDrafts.get(id) === text)
    this.chatDrafts = new Map(entries)
    if (!same) this.pendingChanged()
  }
  private noteChatDraft(chatId: string, text: string): void {
    const kept = text.slice(0, draftPreviewChars)
    if ((this.chatDrafts.get(chatId) ?? '') === kept) return
    if (kept) this.chatDrafts.set(chatId, kept); else this.chatDrafts.delete(chatId)
    this.pendingChanged()
  }
  chatDraft(chatId: string): string { return this.chatDrafts.get(chatId) ?? '' }
  private blockStorage(reason: 'key' | 'storage'): void {
    if (this.storageFailed || this.closed) return
    recordDeliveryStep('blocked', reason)
    this.storageFailed = true; this.storageReason = reason; this.pause(); void this.publish()
  }
  async draft(chatId: string): Promise<string> {
    await this.opening
    if (!this.targetExists(chatId)) throw new Error(tr('대화를 다시 선택해 주세요.'))
    this.known.add(chatId)
    const text = await this.store<string>({ kind: 'draft', chatId })
    if (this.closed || this.auth.signal.aborted) throw new Error(tr('계정이 변경되었습니다.'))
    return text
  }
  commentCreationState<T>(command: CommentCreationCommand, validate: () => void): Promise<T> { return this.store<T>(command, validate) }
  storyReplyDraftState<T>(command: StoryReplyDraftCommand | StoryReplySendCommand | StoryReplyDetachCommand, validate: () => void): Promise<T> { return this.store<T>(command, validate) }
  storyViewReceiptState<T>(command: StoryViewReceiptCommand, validate: () => void): Promise<T> { return this.store<T>(command, validate) }
  storyReactionChangeState<T>(command: StoryReactionChangeCommand, validate: () => void): Promise<T> { return this.store<T>(command, validate) }
  storyHiddenChangeState<T>(command: StoryHiddenChangeCommand, validate: () => void): Promise<T> { return this.store<T>(command, validate) }
  storyPrivacyMoveState<T>(command: StoryPrivacyMoveCommand, validate: () => void): Promise<T> { return this.store<T>(command, validate) }
  storyRemovalState<T>(command: StoryRemovalCommand, validate: () => void): Promise<T> { return this.store<T>(command, validate) }
  noteRemovalState<T>(command: NoteRemovalCommand, validate: () => void): Promise<T> { return this.store<T>(command, validate) }
  storyCaptionSaveState<T>(command: StoryCaptionSaveCommand, validate: () => void): Promise<T> { return this.store<T>(command, validate) }
  noteTextSaveState<T>(command: NoteTextSaveCommand, validate: () => void): Promise<T> { return this.store<T>(command, validate) }
  noteCreationState<T>(command: NoteCreationCommand, validate: () => void): Promise<T> { return this.store<T>(command, validate) }
  channelCreationState<T>(command: ChannelCreationCommand, validate: () => void): Promise<T> { return this.store<T>(command, validate) }
  postCreationState<T>(command: PostCreationCommand, validate: () => void): Promise<T> { return this.store<T>(command, validate) }
  async storyCaptionDraftState<T>(command: StoryCaptionDraftCommand, validate: () => void = () => {}): Promise<T> {
    const key = command.kind === 'story-caption-draft-read' ? `${command.target.privacy}:${command.target.storyId}` : command.kind === 'story-caption-draft-write' ? `${command.request.privacy}:${command.request.storyId}` : null
    if (command.kind === 'story-caption-draft-write' && (!key || !this.storyCaptionDraftsKnown.has(key))) throw new Error(tr('편집 초안을 먼저 읽어 주세요.'))
    if (command.kind === 'story-caption-draft-read' && key && !this.storyCaptionDraftsKnown.has(key) && this.storyCaptionDraftsKnown.size >= 10000) throw new Error(tr('편집 초안 조회 범위를 넘었습니다.'))
    const value = await this.store<T>(command, validate)
    if (this.closed || this.auth.signal.aborted) throw new Error(tr('계정이 변경되었습니다.'))
    if (command.kind === 'story-caption-draft-read' && key) this.storyCaptionDraftsKnown.add(key)
    return value
  }
  async noteEditDraftState<T>(command: NoteEditDraftCommand, validate: () => void = () => {}): Promise<T> {
    const key = command.kind === 'note-edit-draft-read' ? command.target.noteId : command.kind === 'note-edit-draft-write' ? command.request.noteId : null
    if (command.kind === 'note-edit-draft-write' && (!key || !this.noteEditDraftsKnown.has(key))) throw new Error(tr('편집 초안을 먼저 읽어 주세요.'))
    if (command.kind === 'note-edit-draft-read' && key && !this.noteEditDraftsKnown.has(key) && this.noteEditDraftsKnown.size >= 10000) throw new Error(tr('편집 초안 조회 범위를 넘었습니다.'))
    const value = await this.store<T>(command, validate)
    if (this.closed || this.auth.signal.aborted) throw new Error(tr('계정이 변경되었습니다.'))
    if (command.kind === 'note-edit-draft-read' && key) this.noteEditDraftsKnown.add(key)
    return value
  }
  storyPublicationState<T>(command: StoryPublicationCommand, validate: () => void): Promise<T> { return this.store<T>(command, validate) }
  storyVideoPublicationState<T>(command: import('../storage/story-video-publication-table').StoryVideoPublicationCommand, validate: () => void): Promise<T> { return this.store<T>(command, validate) }
  storyComposerAudioState<T>(command:import('../storage/story-composer-audios').StoryComposerAudioCommand,validate:()=>void):Promise<T>{return this.store<T>(command,validate)}
  storyComposerVideoState<T>(command: import('../storage/story-composer-videos').StoryComposerVideoCommand, validate: () => void): Promise<T> { return this.store<T>(command, validate) }
  storyComposerPhotoState<T>(command: StoryComposerPhotoCommand, validate: () => void): Promise<T> { return this.store<T>(command, validate) }
  async storyComposerDraftState<T>(command: StoryComposerDraftCommand): Promise<T> {
    const key = command.kind === 'story-composer-draft-read' ? command.target.id : command.kind === 'story-composer-draft-write' ? command.request.id : null
    if (command.kind === 'story-composer-draft-write' && (!key || !this.storyComposerDraftsKnown.has(key))) throw new Error(tr('스토리 작성 초안을 먼저 읽어 주세요.'))
    if (command.kind === 'story-composer-draft-read' && key && !this.storyComposerDraftsKnown.has(key) && this.storyComposerDraftsKnown.size >= 10000) throw new Error(tr('스토리 작성 초안 조회 범위를 넘었습니다.'))
    const value = await this.store<T>(command)
    if (this.closed || this.auth.signal.aborted) throw new Error(tr('계정이 변경되었습니다.'))
    if (command.kind === 'story-composer-draft-read' && key) this.storyComposerDraftsKnown.add(key)
    return value
  }
  async noteDraftState<T>(command: NoteDraftCommand): Promise<T> {
    const key = command.kind === 'note-draft-read' ? command.target.id : command.kind === 'note-draft-write' ? command.request.id : null
    if (command.kind === 'note-draft-write' && (!key || !this.noteDraftsKnown.has(key))) throw new Error(tr('노트 초안을 먼저 읽어 주세요.'))
    if (command.kind === 'note-draft-read' && key && !this.noteDraftsKnown.has(key) && this.noteDraftsKnown.size >= 10000) throw new Error(tr('노트 초안 조회 범위를 넘었습니다.'))
    const value = await this.store<T>(command)
    if (this.closed || this.auth.signal.aborted) throw new Error(tr('계정이 변경되었습니다.'))
    if (command.kind === 'note-draft-read' && key) this.noteDraftsKnown.add(key)
    return value
  }
  async postDraftState<T>(command: PostDraftCommand): Promise<T> {
    const key = command.kind === 'post-draft-read' ? command.target.channelId : command.kind === 'post-draft-write' ? command.request.channelId : null
    if (command.kind === 'post-draft-write' && (!key || !this.postDraftsKnown.has(key))) throw new Error(tr('글 초안을 먼저 읽어 주세요.'))
    if (command.kind === 'post-draft-read' && key && !this.postDraftsKnown.has(key) && this.postDraftsKnown.size >= 10000) throw new Error(tr('글 초안 조회 범위를 넘었습니다.'))
    const value = await this.store<T>(command)
    if (this.closed || this.auth.signal.aborted) throw new Error(tr('계정이 변경되었습니다.'))
    if (command.kind === 'post-draft-read' && key) this.postDraftsKnown.add(key)
    return value
  }
  async commentDraftState<T>(command: CommentDraftCommand, validate: () => void = () => {}): Promise<T> {
    const target = command.kind === 'comment-draft-read' ? command.target : (command.kind === 'comment-draft-write' || command.kind === 'comment-draft-parent') ? command.request : null
    const key = target ? `${target.channelId}/${target.postId}` : null
    if ((command.kind === 'comment-draft-write' || command.kind === 'comment-draft-parent') && (!key || !this.commentDraftsKnown.has(key))) throw new Error(tr('댓글 초안을 먼저 읽어 주세요.'))
    if (command.kind === 'comment-draft-read' && key && !this.commentDraftsKnown.has(key) && this.commentDraftsKnown.size >= 10000) throw new Error(tr('댓글 초안 조회 범위를 넘었습니다.'))
    const value = await this.store<T>(command, validate)
    if (this.closed || this.auth.signal.aborted) throw new Error(tr('계정이 변경되었습니다.'))
    if (command.kind === 'comment-draft-read' && key) this.commentDraftsKnown.add(key)
    return value
  }
  async contactState<T>(command: ContactDetailsCommand | ContactPhotoCommand, validate: () => void = () => {}): Promise<T> {
    await this.opening
    return this.store<T>(command, validate)
  }
  async saveDraft(chatId: string, text: string): Promise<void> {
    // A view disappearing during a reconnect may flush the last local edit.
    // This authorizes local draft persistence only, never remote transmission.
    if (!this.known.has(chatId)) throw new Error(tr('대화를 다시 선택해 주세요.'))
    await this.store({ kind: 'save-draft', chatId, text })
    // The row keeps up with the keystrokes instead of waiting for the next publish to read them back.
    this.noteChatDraft(chatId, text)
  }
  async enqueue(chatId: string, rawText: string, id: string, reply: ReplyBinding | null = null, validateReply: () => void = () => {}, silent = false): Promise<void> {
    if (!this.eligible(chatId)) throw new Error(tr('이 대화에는 지금 메시지를 보낼 수 없습니다.'))
    // Send menu «무음 전송»: the recipient gets no notification sound.
    const wire: TextSendWire = { id, chatId, senderId: this.uid, type: 'text', text: outgoingText(rawText), isSilent: silent, isEncrypted: false, protocolVersion: 3 }
    const pending = this.pending.get(chatId)
    if (pending) {
      wire.peerUid = pending.peerUid; wire.chatType = 'direct'
      // AppState new chat: the device default applies when this message creates the chat.
      const policy = this.newChatAutoDelete()
      if (policy.seconds > 0) { wire.autoDeleteSeconds = policy.seconds; wire.autoDeleteMyOnly = false }
    }
    if (reply) wire.replyToId = reply.messageId
    const category = outgoingCategory(this.context().dialogs.get(chatId))
    if (category) wire.categoryId = category
    // A duplicate IPC with the same consumed ID remains a no-op even after
    // the atomic enqueue has cleared the draft reply or its original disappeared.
    if (await this.store<boolean>({ kind: 'text-known', wire })) {
      await this.store({ kind: 'enqueue', wire, expectedDraft: rawText, reply }); return
    }
    const rows = await this.store<StoredIntent[]>({ kind: 'list' })
    if (rows.length >= maxQueuedMessages && !rows.some(row => row.id === id)) throw new Error(tr('전송 대기 메시지가 100개입니다. 먼저 대기 목록을 정리해 주세요.'))
    if (!this.eligible(chatId)) throw new Error(tr('이 대화에는 지금 메시지를 보낼 수 없습니다.'))
    if (reply) validateReply()
    await this.store({ kind: 'enqueue', wire, expectedDraft: rawText, reply })
    if (pending) await this.refreshPending()
    void this.publish(); this.kick()
  }
  async detachStoryReply(pending: PendingStoryReplyDraft, validate: () => void): Promise<StoryReplyDetachReceipt> {
    validate()
    const previous = await this.store<StoryReplyDetachReceipt | null>({ kind: 'story-reply-detach-known', id: pending.id }, validate)
    validate(); if (previous) return previous
    const chatId = await this.openDirect({ uid: pending.ownerId, displayName: pending.ownerName })
    const guard = (): void => {
      validate()
      const dialog = this.context().dialogs.get(chatId), direct = this.pending.get(chatId)
      if (!this.active(this.generation.signal) || !this.targetExists(chatId) || this.views.has(chatId) || this.staging.hasWork(chatId) || this.joinChat === chatId || (dialog ? dialog.kind !== 'direct' || dialog.participantUids.length !== 2 || !dialog.participantUids.includes(this.uid) || !dialog.participantUids.includes(pending.ownerId) : direct?.peerUid !== pending.ownerId)) throw new Error(tr('대상 대화의 편집 화면과 첨부를 닫고 현재 계정·연결을 확인해 주세요.'))
    }
    guard()
    const receipt = await this.store<StoryReplyDetachReceipt>({ kind: 'story-reply-detach', request: { id: pending.id, revision: pending.revision }, chatId }, guard)
    await this.refreshPending(); this.known.add(chatId)
    return receipt // No intent and no sender kick: this is only a local draft transfer.
  }
  storyReplySendKnown(id: string, validate: () => void): Promise<StoryReplySendReceipt | null> { return this.store({ kind: 'story-reply-send-known', id }, validate) }
  async enqueueStoryReply(pending: PendingStoryReplyDraft, validate: () => void): Promise<StoryReplySendReceipt> {
    validate(); outgoingText(pending.text)
    const previous = await this.storyReplySendKnown(pending.id, validate)
    validate(); if (previous) return previous
    const chatId = await this.openDirect({ uid: pending.ownerId, displayName: pending.ownerName })
    const guard = (): void => {
      validate()
      const dialog = this.context().dialogs.get(chatId), direct = this.pending.get(chatId)
      if (!this.eligible(chatId) || (dialog ? dialog.kind !== 'direct' || dialog.participantUids.length !== 2 || !dialog.participantUids.includes(this.uid) || !dialog.participantUids.includes(pending.ownerId) : direct?.peerUid !== pending.ownerId)) throw new Error(tr('답장 대상과 현재 연결을 확인해 주세요.'))
    }
    guard()
    const wire = storyReplyWire(pending, chatId, this.pending.get(chatId)?.peerUid)
    const receipt = await this.store<StoryReplySendReceipt>({ kind: 'enqueue-story-reply', request: { id: pending.id, revision: pending.revision }, wire }, guard)
    await this.refreshPending(); void this.publish(); this.kick()
    return receipt
  }
  async enqueueForward(request: ForwardRequest, prepare: () => { text: string; isSilent: boolean }): Promise<void> {
    await this.opening
    if (!this.active(this.generation.signal)) throw new Error(tr('대화 목록과 연결을 확인해 주세요.'))
    // A receipt confirms an already accepted batch; it never recreates consumed
    // messages, even if the original or a destination has since disappeared.
    if (await this.store<boolean>({ kind: 'forward-known', request })) { void this.publish(); this.kick(); return }
    const validate = (): void => {
      if (request.targets.some(target => !this.context().dialogs.has(target.chatId) || !this.eligible(target.chatId))) throw new Error(tr('전달 대상과 연결 상태를 다시 확인해 주세요.'))
      prepare()
    }
    validate()
    const content = prepare()
    try { await this.store({ kind: 'enqueue-forward', request, ...content }, validate) }
    catch (error) {
      if (error instanceof DeliveryCommandFailure && error.code === 'capacity') throw new Error(tr('전송 대기 메시지는 100개까지 보관할 수 있습니다. 대기 목록을 정리한 뒤 다시 확인해 주세요.'))
      throw error
    }
    void this.publish(); this.kick()
  }
  async enqueueForwardTexts(request: TextForwardBatchRequest, prepare: () => { text: string; isSilent: boolean }[]): Promise<void> {
    await this.opening
    if (!this.active(this.generation.signal)) throw new Error(tr('대화 목록과 연결을 확인해 주세요.'))
    if (await this.store<boolean>({ kind: 'forward-texts-known', request })) { void this.publish(); this.kick(); return }
    const validate = (): void => {
      if (request.targets.some(target => !this.context().dialogs.has(target.chatId) || !this.eligible(target.chatId))) throw new Error(tr('전달 대상과 연결 상태를 다시 확인해 주세요.'))
      prepare()
    }
    validate()
    const content = prepare()
    try { await this.store({ kind: 'enqueue-forward-texts', request, content }, validate) }
    catch (error) {
      if (error instanceof DeliveryCommandFailure && error.code === 'capacity') throw new Error(tr('전체 전달을 저장할 공간이 부족합니다. 전송 대기 메시지는 100개까지 보관할 수 있습니다.'))
      throw error
    }
    void this.publish(); this.kick()
  }
  async enqueueForwardMedia(request: ForwardRequest, prepare: () => Promise<PreparedForwardMedia>, validate: () => void, committing: () => void): Promise<void> {
    await this.opening
    if (!this.active(this.generation.signal)) throw new Error(tr('대화 목록과 연결을 확인해 주세요.'))
    if (await this.store<boolean>({ kind: 'forward-known', request })) { void this.publish(); this.kick(); return }
    const current = (): void => {
      if (request.targets.some(target => !this.context().dialogs.has(target.chatId) || !this.eligible(target.chatId))) throw new Error(tr('전달 대상과 연결 상태를 다시 확인해 주세요.'))
      validate()
    }
    current()
    const media = await prepare()
    try { await this.store({ kind: 'enqueue-forward-media', request, media }, () => { current(); committing() }) }
    catch (error) {
      if (error instanceof DeliveryCommandFailure && error.code === 'capacity') throw new Error(tr('전송 대기 원본은 대상별 합계 250 MB, 메시지는 100개까지 보관할 수 있습니다.'))
      throw error
    }
    finally { for (const part of media.parts) part.bytes.fill(0) }
    void this.publish(); this.kick()
  }
  async enqueueForwardBatch(request: ForwardBatchRequest, prepare: () => Promise<PreparedForwardItem[]>, validate: () => void, committing: () => void): Promise<void> {
    await this.opening
    if (!this.active(this.generation.signal)) throw new Error(tr('대화 목록과 연결을 확인해 주세요.'))
    if (await this.store<boolean>({ kind: 'forward-batch-known', request })) { void this.publish(); this.kick(); return }
    const current = (): void => {
      if (request.targets.some(target => !this.context().dialogs.has(target.chatId) || !this.eligible(target.chatId))) throw new Error(tr('전달 대상과 연결 상태를 다시 확인해 주세요.'))
      validate()
    }
    current()
    const content = await prepare()
    try { await this.store({ kind: 'enqueue-forward-batch', request, content }, () => { current(); committing() }) }
    catch (error) {
      if (error instanceof DeliveryCommandFailure && error.code === 'capacity') throw new Error(tr('전체 전달을 저장할 공간이 부족합니다. 대기 메시지 100개와 대상별 원본 합계 250 MB 이내로 정리해 주세요.'))
      throw error
    }
    finally { clearForwardBatch(content) }
    void this.publish(); this.kick()
  }
  pickAttachment(chatId: string, mode: AttachmentMode, choose: () => Promise<string[] | null>) {
    return this.staging.pick(chatId, mode, () => this.context().dialogs.has(chatId) && this.eligible(chatId), choose)
  }
  discardAttachment(id?: string): void { this.staging.clear(id) }
  replaceAttachmentImage(chatId: string, id: string, itemId: string, bytes: Uint8Array) {
    if (!this.context().dialogs.has(chatId) || !this.eligible(chatId)) throw new Error(tr('대화와 연결을 확인해 주세요.'))
    return this.staging.replaceImage(chatId, id, itemId, bytes)
  }
  editAttachmentVideo(chatId: string, id: string, itemId: string, edit: VideoEdit) {
    if (!this.context().dialogs.has(chatId) || !this.eligible(chatId)) throw new Error(tr('대화와 연결을 확인해 주세요.'))
    return this.staging.editVideo(chatId, id, itemId, edit, () => this.context().dialogs.has(chatId) && this.eligible(chatId))
  }
  dropAttachments(chatId: string, paths: string[], mode: AttachmentDropMode) {
    return this.staging.drop(chatId, paths, mode, () => this.context().dialogs.has(chatId) && this.eligible(chatId))
  }
  pasteAttachments(chatId: string, items: { name: string; bytes: Uint8Array }[]) {
    return this.staging.receive(chatId, items, () => this.context().dialogs.has(chatId) && this.eligible(chatId))
  }
  attachmentPreview(chatId: string, path: string, request: Request): Response {
    return this.context().dialogs.has(chatId) && this.eligible(chatId) ? this.staging.response(chatId, path, request) : new Response(null, { status: 403 })
  }
  async enqueueVoice(raw:VoiceSendRequest,source:()=>Uint8Array,validate:()=>void):Promise<void>{
    const input=voiceSendRequest(raw),{id,chatId,reply}=input
    await this.opening;this.voiceCaptureAccess(chatId)
    const request={id,chatId,senderId:this.uid,caption:'',itemIds:[id],reply,voice:{duration:input.duration,sha256:input.sha256},...(input.draftRevision?{voiceDraftRevision:input.draftRevision}:{})}
    if(await this.store<boolean>({kind:'attachment-known',request})){void this.publish();this.kick();return}
    this.voiceCaptureAccess(chatId);validate()
    const bytes=source()
    try{
      const category=outgoingCategory(this.context().dialogs.get(chatId))
      const wire:MediaSendWire={id,chatId,senderId:this.uid,type:'voice',text:'',mediaUrl:'',isSilent:false,isEncrypted:false,protocolVersion:3,voiceDuration:Math.max(1,Math.round(input.duration)),...(reply?{replyToId:reply.messageId}:{}),...(category?{categoryId:category}:{})}
      const upload={id,chatId,name:'음성 메시지.m4a',kind:'voice' as const,size:bytes.byteLength,contentType:'application/octet-stream',path:`chat_files/${chatId}/${id}.m4a`,sha256:createHash('sha256').update(bytes).digest('hex'),md5:createHash('md5').update(bytes).digest('base64'),session:null}
      if(upload.sha256!==input.sha256)throw new Error(tr('음성 원본이 변경되었습니다.'))
      await this.store({kind:'enqueue-attachment',request,wire,parts:[{upload,bytes}]},validate)
    }catch(error){if(error instanceof DeliveryCommandFailure && error.code==='capacity')throw new Error(tr('전송 대기 원본은 합계250MiB, 메시지는100개까지 보관할 수 있습니다.'));throw error}finally{bytes.fill(0)}
    void this.publish();this.kick()
  }
  // ChatRoomView.sendStickerMessage: a sticker from this device's library goes out as a «sticker» message, 512 by 512,
  // its PNG or GIF under chat_media and its MP4 under chat_videos (MorsePendingMediaUploadManager).
  async enqueueSticker(chatId: string, id: string, stickerId: string, reply: ReplyBinding | null, validate: () => void): Promise<void> {
    await this.opening
    if (!this.context().dialogs.has(chatId) || !this.eligible(chatId)) throw new Error(tr('첫 텍스트 메시지를 보낸 뒤 스티커를 보낼 수 있습니다.'))
    const request = { id, chatId, senderId: this.uid, caption: '', itemIds: [id], reply, sticker: stickerId }
    if (await this.store<boolean>({ kind: 'attachment-known', request })) { void this.publish(); this.kick(); return }
    validate()
    const stored = await this.store<{ kind: StickerKind; data: Uint8Array } | null>({ kind: 'sticker-read', id: stickerId })
    if (!stored) throw new Error(tr('스티커를 찾지 못했습니다. 보관함을 확인해 주세요.'))
    const bytes = Buffer.from(stored.data)
    try {
      const category = outgoingCategory(this.context().dialogs.get(chatId))
      const wire: MediaSendWire = { id, chatId, senderId: this.uid, type: 'sticker', text: '', mediaUrl: '', isSilent: false, isEncrypted: false, protocolVersion: 3,
        mediaWidthPx: stickerSidePx, mediaHeightPx: stickerSidePx, ...(reply ? { replyToId: reply.messageId } : {}), ...(category ? { categoryId: category } : {}) }
      const root = stored.kind === 'mp4' ? 'chat_videos' : 'chat_media'
      const upload = { id, chatId, name: `스티커.${stored.kind}`, kind: 'sticker' as const, size: bytes.byteLength, contentType: stickerContentType[stored.kind],
        path: `${root}/${chatId}/${id}.${stored.kind}`, sha256: createHash('sha256').update(bytes).digest('hex'), md5: createHash('md5').update(bytes).digest('base64'), session: null }
      await this.store({ kind: 'enqueue-attachment', request, wire, parts: [{ upload, bytes }] }, validate)
    } catch (error) {
      if (error instanceof DeliveryCommandFailure && error.code === 'capacity') throw new Error(tr('전송 대기 원본은 합계 250 MB, 메시지는 100개까지 보관할 수 있습니다.'))
      throw error
    } finally { bytes.fill(0) }
    void this.publish(); this.kick()
  }
  // A video message recorded in the window: staged from its bytes, then sent like a picked video, as a circle.
  async enqueueRoundVideo(chatId: string, bytes: Uint8Array, video: VideoFacts, reply: ReplyBinding | null, validate: () => void): Promise<void> {
    await this.opening
    if (!this.context().dialogs.has(chatId) || !this.eligible(chatId)) throw new Error(tr('첫 텍스트 메시지를 보낸 뒤 영상 메시지를 보낼 수 있습니다.'))
    validate()
    const draft = this.staging.adopt(chatId, bytes, 'video-message.mp4')
    try { await this.enqueueAttachment(chatId, draft.id, '', [draft.items[0]!.id], reply, validate, video, true) }
    catch (error) { this.staging.clear(draft.id); throw error }
  }
  async enqueueAttachment(chatId: string, id: string, caption: string, itemIds: string[], reply: ReplyBinding | null, validate: () => void, video: VideoFacts | null = null, circular = false): Promise<void> {
    await this.opening
    if (!this.context().dialogs.has(chatId) || !this.eligible(chatId)) throw new Error(tr('첫 텍스트 메시지를 보낸 뒤 첨부할 수 있습니다.'))
    const request = { id, chatId, senderId: this.uid, caption, itemIds, reply }
    // Check the durable receipt before accessing staging: successful enqueue
    // clears its bytes, even if the renderer never receives the IPC response.
    if (await this.store<boolean>({ kind: 'attachment-known', request })) {
      this.staging.clear(id); void this.publish(); this.kick(); return
    }
    if (!this.context().dialogs.has(chatId) || !this.eligible(chatId)) throw new Error(tr('연결 상태가 변경되었습니다.'))
    validate()
    const { wire, parts } = this.staging.prepare(this.uid, chatId, id, caption, itemIds, video, circular)
    if (reply) wire.replyToId = reply.messageId
    const category = outgoingCategory(this.context().dialogs.get(chatId))
    if (category) wire.categoryId = category
    try { await this.store({ kind: 'enqueue-attachment', request, wire, parts }) }
    catch (error) {
      if (error instanceof DeliveryCommandFailure && error.code === 'capacity') throw new Error(tr('전송 대기 원본은 합계 250 MB, 메시지는 100개까지 보관할 수 있습니다.'))
      throw error
    }
    finally { for (const part of parts) part.bytes.fill(0) }
    this.staging.clear(id); void this.publish(); this.kick()
  }
  pause(): void {
    this.staging.clear(); this.uploadAbort?.abort()
    this.generation.abort(); this.generation = new AbortController(); this.retryAt.clear(); clearTimeout(this.wake)
    void this.publish()
  }
  resume(): void {
    if (this.closed) return
    if (this.uploadChatId && !this.eligible(this.uploadChatId)) this.uploadAbort?.abort()
    for (const dialog of this.context().dialogs.values()) if (dialog.kind !== 'secret') this.known.add(dialog.id)
    void this.publish()
    if (this.initialized && this.context().ready) {
      const allowed = [...this.context().dialogs.values()].filter(dialog => dialog.kind !== 'secret').map(dialog => dialog.id)
      for (const id of this.pending.keys()) this.known.add(id)
      void this.syncDirects().then(() => this.store({ kind: 'prune', allowed })).then(() => this.kick()).catch(() => {})
    }
  }
  private async syncDirects(): Promise<void> {
    const confirmed = [...this.pending.values()].filter(row => this.matchesDirect(row))
    const moved = [...this.pending.values()].flatMap(row => {
      const dialogId = this.matchesDirect(row) ? null : this.peerDialogId(row.peerUid)
      return dialogId && row.canDiscard ? [{ row, dialogId }] : []
    })
    if (!confirmed.length && !moved.length) return
    for (const { row, dialogId } of moved) {
      if (await this.store<boolean>({ kind: 'direct-supersede', chatId: row.chatId, peerUid: row.peerUid, dialogId }))
        this.superseded.set(row.chatId, { peerUid: row.peerUid, dialogId })
    }
    for (const row of confirmed) {
      await this.store({ kind: 'direct-confirm', chatId: row.chatId, peerUid: row.peerUid })
      // A previously absent chat may now authorize the canonical message lookup.
      const intents = await this.store<StoredIntent[]>({ kind: 'list', chatId: row.chatId })
      for (const intent of intents) this.retryAt.delete(intent.id)
    }
    await this.refreshPending()
  }
  private kick(): void {
    if (!this.initialized || !this.active(this.generation.signal)) return
    if (this.task) { this.rerun = true; return }
    const signal = this.generation.signal
    const task = this.drain(signal)
    this.task = task
    void task.catch(() => { /* store failures are reported by store() */ }).finally(() => {
      if (this.task !== task) return
      this.task = null; this.busyId = null; void this.publish()
      if (this.rerun) { this.rerun = false; this.kick() }
    })
  }
  private backoff(id: string): void {
    const attempts = Math.min(6, (this.retryAt.get(id)?.attempts ?? 0) + 1)
    this.retryAt.set(id, { at: Date.now() + Math.min(60000, 2000 * 2 ** (attempts - 1)), attempts })
  }
  // Telegram resends with the same random_id. The existing server has the same
  // contract: a stored message ID returns alreadyExisted, a different payload
  // is rejected as CONFLICT. Unconfirmed sends and interrupted uploads
  // therefore resume automatically; definite rejections wait for the user.
  private resumable(row: StoredIntent): boolean {
    return row.state === 'uploading' || row.state === 'queued' || row.state === 'uncertain' || (row.state === 'upload-failed' && row.reason === 'upload-network')
  }
  private async drain(signal: AbortSignal): Promise<void> {
    while (this.active(signal)) {
      const rows = await this.store<StoredIntent[]>({ kind: 'list' })
      if (!this.active(signal)) return
      for (const id of [...this.retryAt.keys()]) if (!rows.some(row => row.id === id)) this.retryAt.delete(id)
      const now = Date.now()
      const candidates = rows.filter(row => this.composeAllowed(row.chatId) && !this.earlierForward(row, rows) && this.resumable(row))
      const intent = candidates.find(row => (this.retryAt.get(row.id)?.at ?? 0) <= now)
      if (!intent) {
        if (candidates.length) {
          const next = Math.min(...candidates.map(row => this.retryAt.get(row.id)?.at ?? now))
          clearTimeout(this.wake); this.wake = setTimeout(() => this.kick(), Math.max(50, next - Date.now()))
        }
        return
      }
      if (!this.eligible(intent.chatId)) { await this.store({ kind: 'finish', id: intent.id, discarded: true }); continue }
      if (intent.wire.type === 'text' && intent.wire.peerUid && this.context().dialogs.has(intent.chatId) &&
          !this.matchesDirect({ chatId: intent.chatId, peerUid: intent.wire.peerUid })) {
        await this.store({ kind: 'state', id: intent.id, state: 'failed', reason: 'CONFLICT' }); continue
      }
      this.busyId = intent.id; void this.publish()
      if (intent.state === 'upload-failed') {
        await this.store({ kind: 'state', id: intent.id, state: 'uploading', reason: '' })
      } else if (intent.state === 'uploading') {
        await this.upload(intent, signal)
      } else if (intent.state === 'uncertain') {
        const result = await this.reconcile(intent, signal)
        if (!this.active(signal)) return
        if (result === 'missing' || result === 'unavailable') {
          this.backoff(intent.id)
          await this.store({ kind: 'state', id: intent.id, state: 'queued', reason: '' })
        }
      } else {
        if (!await this.store<boolean>({ kind: 'claim', id: intent.id })) continue
        if (!this.active(signal) || !this.eligible(intent.chatId)) {
          await this.store({ kind: 'release-unemitted', id: intent.id })
          return
        }
        try {
          await this.auth.sender.send(intent.wire, signal)
          if (!this.active(signal)) return
          this.retryAt.delete(intent.id)
          this.keepSent(intent)
          await this.store({ kind: 'finish', id: intent.id, discarded: false })
        } catch (error) {
          if (error instanceof NotEmitted) {
            await this.store({ kind: 'release-unemitted', id: intent.id })
            if (this.active(signal)) this.wake = setTimeout(() => this.kick(), 2000)
            return
          }
          if (!this.active(signal)) return
          if (error instanceof ServerRejection && definiteRejections.has(error.reason)) {
            await this.store({ kind: 'state', id: intent.id, state: 'failed', reason: error.reason })
          } else {
            this.backoff(intent.id)
            await this.store({ kind: 'state', id: intent.id, state: 'uncertain', reason: 'ack-pending' })
          }
        }
      }
      this.busyId = null; void this.publish()
    }
  }
  private async upload(intent: StoredIntent, ownerSignal: AbortSignal): Promise<void> {
    if (!intent.parts?.length) throw new Error('Missing upload source descriptors')
    const abort = new AbortController(), signal = AbortSignal.any([ownerSignal, abort.signal, this.auth.signal])
    this.uploadAbort = abort
    this.uploadChatId = intent.chatId
    let bytes: Buffer | null = null
    try {
      const total = intent.parts.reduce((sum, part) => sum + part.upload.size, 0)
      let completed = 0
      for (const part of intent.parts) {
        if (!this.active(signal) || !this.eligible(intent.chatId)) return
        this.uploadProgress = { loaded: completed, total, current: part.index + 1, count: intent.parts.length }; void this.publish()
        const source = await this.store<Uint8Array>({ kind: 'upload-source', id: intent.id, index: part.index })
        bytes = Buffer.from(source.buffer, source.byteOffset, source.byteLength)
        if (!this.active(signal) || !this.eligible(intent.chatId)) return
        const url = await uploadAttachment(this.auth, this.uid, part.upload, bytes,
          async session => {
            if (!this.active(signal) || !this.eligible(intent.chatId)) throw new Error('Upload cancelled')
            await this.store({ kind: 'upload-session', id: intent.id, index: part.index, session })
          }, loaded => {
            if (this.active(signal)) { this.uploadProgress = { loaded: completed + loaded, total, current: part.index + 1, count: intent.parts!.length }; void this.publish() }
          }, signal, Boolean(part.url))
        if (!this.active(signal) || !this.eligible(intent.chatId)) return
        await this.store({ kind: 'upload-complete', id: intent.id, index: part.index, url })
        completed += part.upload.size
        bytes.fill(0); bytes = null
      }
      if (!this.active(signal) || !this.eligible(intent.chatId)) return
      await this.store({ kind: 'upload-ready', id: intent.id })
      this.retryAt.delete(intent.id)
    } catch (error) {
      if (this.active(signal)) {
        this.backoff(intent.id)
        await this.store({ kind: 'state', id: intent.id, state: 'upload-failed', reason: error instanceof UploadFailure ? error.reason : 'upload-network' })
      }
    } finally { bytes?.fill(0); if (this.uploadAbort === abort) { this.uploadAbort = null; this.uploadChatId = null }; this.uploadProgress = undefined }
  }
  private async reconcile(intent: StoredIntent, signal: AbortSignal): Promise<'found' | 'missing' | 'unavailable' | 'conflict'> {
    const reader = this.context().reader
    if (!reader || !this.active(signal) || !this.eligible(intent.chatId)) return 'unavailable'
    try {
      const rows = await reader.query(`${documents}/chats/${intent.chatId}`, {
        from: [{ collectionId: 'messages' }], where: { fieldFilter: { field: { fieldPath: '__name__' }, op: 'EQUAL',
          value: { referenceValue: `${documents}/chats/${intent.chatId}/messages/${intent.id}` } } }, limit: { value: 1 }
      }, signal)
      if (!this.active(signal) || !this.eligible(intent.chatId)) return 'unavailable'
      const doc = rows[0]
      if (doc) {
        if (doc.name !== `${documents}/chats/${intent.chatId}/messages/${intent.id}` || stringField(doc.fields, 'senderId', 160) !== this.uid ||
            stringField(doc.fields, 'payloadDigest', 64) !== textDigest(intent.wire)) {
          await this.store({ kind: 'state', id: intent.id, state: 'failed', reason: 'CONFLICT' }); return 'conflict'
        }
        this.keepSent(intent)
        await this.store({ kind: 'finish', id: intent.id, discarded: false }); return 'found'
      }
      if (intent.state !== 'failed') await this.store({ kind: 'state', id: intent.id, state: 'uncertain', reason: 'not-found' })
      return 'missing'
    } catch {
      if (this.active(signal) && intent.state !== 'failed') await this.store({ kind: 'state', id: intent.id, state: 'uncertain', reason: 'lookup-failed' })
      return 'unavailable'
    }
  }
  async retry(chatId: string, id: string): Promise<void> {
    if (!this.eligible(chatId) || this.busyId === id || this.task) throw new Error(tr('진행 중인 전송이 끝난 뒤 다시 시도해 주세요.'))
    const signal = this.generation.signal
    const task = (async () => {
      this.busyId = id; void this.publish()
      const intent = (await this.store<StoredIntent[]>({ kind: 'list', chatId })).find(row => row.id === id)
      if (!intent || !this.active(signal)) return
      this.retryAt.delete(id)
      if (intent.state === 'upload-failed') { await this.store({ kind: 'state', id, state: 'uploading', reason: '' }); return }
      // The same durable ID is idempotent on the server, so a user resend of an
      // unconfirmed or retryable-rejected message never creates a duplicate.
      if (intent.state === 'uncertain' || (intent.state === 'failed' && retryableRejections.has(intent.reason))) {
        await this.store({ kind: 'state', id, state: 'queued', reason: '' }); return
      }
      if (intent.state !== 'queued' && intent.state !== 'uploading') throw new Error(tr('다시 전송할 수 없는 메시지입니다.'))
    })()
    this.task = task
    try { await task } finally { if (this.task === task) this.task = null; this.rerun = false; this.busyId = null; void this.publish(); this.kick() }
  }
  async discard(chatId: string, id: string, reviewed?: DiscussionLeaveWorkDismiss, validate: () => void = () => {}): Promise<void> {
    if (reviewed && (reviewed.kind !== 'outgoing' || reviewed.id !== id || reviewed.target.chatId !== chatId)) throw new Error(tr('정리할 전송 기록을 다시 선택해 주세요.'))
    if (!reviewed && this.queueAvailable(chatId) && this.busyId === id && this.uploadChatId === chatId && this.uploadAbort) {
      this.uploadAbort.abort()
      await this.store({ kind: 'finish', id, discarded: true })
      void this.publish(); return
    }
    if (!this.queueAvailable(chatId) || this.task) throw new Error(tr('진행 중인 전송이 끝난 뒤 정리해 주세요.'))
    const signal = this.generation.signal
    const task = (async () => {
      const intent = (await this.store<StoredIntent[]>({ kind: 'list', chatId })).find(row => row.id === id)
      if (intent && this.active(signal) && this.queueAvailable(chatId)) await this.store(reviewed ? { kind: 'discussion-leave-dismiss-record', request: reviewed } : { kind: 'finish', id, discarded: true }, validate)
      else if (reviewed) throw new Error(tr('전송 기록이 변경되었습니다. 다시 확인해 주세요.'))
    })()
    this.task = task
    try { await task } finally { if (this.task === task) this.task = null; this.rerun = false; void this.publish(); this.kick() }
  }
  async close(purge: boolean): Promise<void> {
    if (this.closed) return
    this.closed = true; this.pause(); this.known.clear()
    for (const entry of this.sent.values()) clearTimeout(entry.timer)
    this.sent.clear()
    await this.opening; await this.task?.catch(() => {})
    if (this.repository) await this.repository.close(purge)
    this.views.clear(); this.pending.clear(); this.commentDraftsKnown.clear(); this.postDraftsKnown.clear(); this.noteDraftsKnown.clear(); this.storyComposerDraftsKnown.clear(); this.noteEditDraftsKnown.clear(); this.storyCaptionDraftsKnown.clear()
  }
}
