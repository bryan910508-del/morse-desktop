import { randomBytes } from 'node:crypto'
import { channelStoryCreateWrite, channelStoryDeleteWrite, channelStoryReactionWrite, channelStoryViewedWrite } from './channel-story-write'
import { writeStoryViewReceipt, StoryViewReceiptWriteFailure } from './story-view-receipt-write'
import { writeDialogPreference, DialogPreferenceWriteFailure, type DialogPreferenceWrite } from './dialog-preference-write'
import { writeStickerPackInstall, writeStickerPackUninstall, StickerPackInstallFailure } from './sticker-pack-install-write'
import type { StickerPack } from '../../shared/sticker-packs'
import type { StoryViewReceiptRequest } from '../../shared/story-view-receipt'
import { writeStoryReaction, StoryReactionWriteFailure } from './story-reaction-write'
import type { StoryReactionChangeRequest } from '../../shared/story-reaction-change'
import { writeStoryVideoPublication, StoryVideoPublicationFailure } from './story-video-publication-write'
import type { StoryVideoPublicationCommitRequest } from '../../shared/story-video-publication-commit'
import { writeStoryPublication, StoryPublicationFailure } from './story-publication-write'
import type { StoryPublicationCommitRequest } from '../../shared/story-publication-commit'
import { writeStoryHiddenChange, StoryHiddenChangeFailure } from './story-hidden-change-write'
import type { StoryHiddenChangeRequest } from '../../shared/story-hidden-change'
import { writeStoryPrivacyMove, StoryPrivacyMoveFailure } from './story-privacy-move-write'
import type { StoryPrivacyMoveRequest } from '../../shared/story-privacy-move'
import { writeCloseFriendChange, CloseFriendChangeFailure } from './close-friend-change-write'
import type { CloseFriendChangeRequest } from '../../shared/close-friend-change'
import { writeStoryRemoval, StoryRemovalFailure } from './story-removal-write'
import type { StoryRemovalRequest } from '../../shared/story-removal'
import { writeStoryCaptionSave, StoryCaptionSaveFailure } from './story-caption-save-write'
import type { StoryCaptionSaveRequest } from '../../shared/story-caption-save'
import { ownStoryCollections, ownStoryFromDocument } from './own-story-document'
import { positionMilliseconds } from '../../shared/model'
import { writeNoteRemoval, NoteRemovalFailure } from './space-note-removal-write'
import type { NoteRemovalRequest } from '../../shared/space-note-removal'
import { writeNoteTextSave, NoteTextSaveFailure } from './space-note-text-save-write'
import type { NoteTextSaveRequest } from '../../shared/space-note-text-save'
import { writeSpaceNotePin, NotePinFailure } from './space-note-pin-write'
import type { NotePinRequest } from '../../shared/space-note-pin'
import { writeNoteCreation, NoteCreationFailure } from './space-note-creation-write'
import type { NoteCreationRequest } from '../../shared/space-note-creation'
import { queryPublicChannels, type DiscoveryQuery } from './channel-discovery-query'
import { writeChannelCreation, ChannelCreationFailure } from './channel-creation-write'
import type { ChannelCreationRequest } from '../../shared/channel-creation'
import { writeChannelPostVisibility, ChannelPostVisibilityFailure, type PostVisibilitySource } from './channel-post-visibility-write'
import type { PostVisibilityRequest } from '../../shared/channel-post-visibility'
import { writeChannelPostRemoval, ChannelPostRemovalFailure, type PostRemovalSource } from './channel-post-removal-write'
import type { PostRemovalTarget } from '../../shared/channel-post-removal'
import { writeChannelPostCreation, ChannelPostCreationFailure, type PostCreationSource } from './channel-post-creation-write'
import type { PostCreationRequest } from '../../shared/channel-post-creation'
import { writeChannelPostPinResolution, ChannelPostPinResolutionFailure, type PinResolutionWriteSource } from './channel-post-pin-resolution-write'
import type { ChannelPostPinResolution } from '../../shared/channel-post-pin-resolution'
import { writeChannelPostExtraPin, ChannelPostExtraPinFailure, type ExtraPinWriteSource } from './channel-post-extra-pin-write'
import type { ChannelPostExtraPinRequest } from '../../shared/channel-post-extra-pin'
import { writeChannelPostPin, ChannelPostPinFailure, type ChannelPinWriteSource } from './channel-post-pin-write'
import type { ChannelPostPinEdit } from '../../shared/channel-post-pin-edit'
import { writeChannelPostText, ChannelPostTextFailure } from './channel-post-text-write'
import type { ChannelPostTextEdit } from '../../shared/channel-post-text-edit'
import { writeChannelCommentCreation, ChannelCommentCreationFailure } from './channel-comment-creation-write'
import type { CommentCreationRequest } from '../../shared/channel-comment-creation'
import { writeChannelCommentRemoval, ChannelCommentRemovalFailure, type CommentRemovalSource } from './channel-comment-removal-write'
import type { ChannelCommentRemoval } from '../../shared/channel-comment-removal'
import { writeChannelPostLike, ChannelPostLikeFailure } from './channel-post-like-write'
import type { ChannelPostLikeRequest } from '../../shared/channel-post-like'
import { writeChannelAdminAppointment, ChannelAdminAppointmentWriteFailure } from './channel-admin-appointment-write'
import type { ChannelAdminAppointment } from '../../shared/channel-admin-appointment'
import { writeChannelAdminRemoval, ChannelAdminRemovalWriteFailure } from './channel-admin-removal-write'
import type { ChannelAdminRemoval } from '../../shared/channel-admin-removal'
import { writeChannelAdminPermissions, ChannelAdminPermissionsWriteFailure } from './channel-admin-permissions-write'
import type { ChannelAdminPermissionsEdit } from '../../shared/channel-admin-permissions'
import { writeChannelAccess, ChannelAccessFailure } from './channel-access-write'
import type { ChannelAccessRequest } from '../../shared/channel-access-edit'
import { writeChannelTags, ChannelTagsWriteFailure } from './channel-tags-write'
import type { ChannelTagsEdit } from '../../shared/channel-tags'
import { writeChannelIntroduction, ChannelIntroductionWriteFailure } from './channel-introduction-write'
import type { ChannelIntroductionEdit } from '../../shared/channel-introduction'
import { writeChannelName, ChannelNameWriteFailure } from './channel-name-write'
import type { ChannelNameEdit } from '../../shared/channel-name'
import { writeChannelMetadata, ChannelMetadataWriteFailure } from './channel-metadata-write'
import type { ChannelPhotoClear } from '../../shared/channel-photo-clear'
import type { ChannelPhotoKind } from '../../shared/channel-photo-bytes'
import { Client, credentials, loadPackageDefinition, Metadata, status, type ClientDuplexStream, type ClientReadableStream, type ClientUnaryCall, type ServiceError } from '@grpc/grpc-js'
import { fromJSON } from '@grpc/proto-loader'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { database, document, documents, timestamp, ReadFailure, type FirestoreDocument, type WireObject } from './firestore-values'
import { object } from '../../shared/validation'
import { MessageMutationFailure, NotEmitted } from './contracts'
import type { PublicContact } from './contact-lookup'
import { createParticipantContact, type ContactCreateFields } from './participant-contact-write'
import type { DialogPinRequest } from '../../shared/dialog-pins'
import { DialogPinWriteFailure, writeDialogPin } from './dialog-pin-write'
import type { GroupNameEdit } from '../../shared/group-name'
import { GroupNameWriteFailure, writeGroupName } from './group-name-write'
import type { GroupPhotoClear } from '../../shared/group-photo'
import { GroupPhotoApplyFailure, applyGroupPhoto } from './group-photo-apply'
import { GroupPhotoWriteFailure, clearGroupPhoto } from './group-photo-write'
import type { GroupAnnouncementEdit } from '../../shared/group-announcement'
import { GroupAnnouncementWriteFailure, writeGroupAnnouncement } from './group-announcement-write'
import { ProfileDisplayWriteFailure, writeProfileDisplay, type ProfileDisplayEdit } from './profile-display-write'
import { tr } from '../../shared/i18n'
export class ContactWriteFailure extends Error {
  constructor(readonly uncertain: boolean) { super(uncertain ? tr('연락처 저장 결과를 확인하지 못했습니다. 목록을 다시 확인해 주세요.') : tr('연락처를 저장하지 못했습니다. 연결과 권한을 확인해 주세요.')) }
}
export class ProfileWriteFailure extends Error {
  constructor(readonly uncertain: boolean) { super(uncertain ? tr('소개 저장 결과를 확인하지 못했습니다. 서버 정보를 다시 불러와 확인해 주세요.') : tr('프로필이 변경되었거나 저장 권한이 없습니다. 최신 정보를 확인해 주세요.')) }
}

export interface ReadAuthorization { idToken: string; appCheckToken: string; expiresAt: number }
export interface ReadCredentials {
  signal: AbortSignal
  authorize(signal: AbortSignal, force: boolean): Promise<ReadAuthorization>
}
interface FirestoreClient extends Client {
  getDocument(request: WireObject, metadata: Metadata, options: { deadline: Date }, callback: (error: ServiceError | null, response: WireObject) => void): ClientUnaryCall
  beginTransaction(request: WireObject, metadata: Metadata, options: { deadline: Date }, callback: (error: ServiceError | null, response: WireObject) => void): ClientUnaryCall
  batchGetDocuments(request: WireObject, metadata: Metadata, options: { deadline: Date }): ClientReadableStream<WireObject>
  rollback(request: WireObject, metadata: Metadata, options: { deadline: Date }, callback: (error: ServiceError | null, response: WireObject) => void): ClientUnaryCall
  listen(metadata: Metadata, options: { deadline: Date }): ClientDuplexStream<WireObject, WireObject>
  runQuery(request: WireObject, metadata: Metadata, options: { deadline: Date }): ClientReadableStream<WireObject>
  commit(request: WireObject, metadata: Metadata, options: { deadline: Date }, callback: (error: ServiceError | null, response: WireObject) => void): ClientUnaryCall
}
export interface WatchEvents {
  snapshot(documents: Map<string, FirestoreDocument>): void
  state(state: 'loading' | 'ready' | 'error', error?: ReadFailure): void
  // Called instead of state('loading') when a target that was already current re-listens
  // (renewal, retry, RESET); a watcher that provides it keeps its last snapshot.
  reconnecting?(error?: ReadFailure): void
}
function failure(error: unknown): ReadFailure {
  if (error instanceof ReadFailure) return error
  const code = error && typeof error === 'object' ? (error as { code?: number }).code : undefined
  return new ReadFailure(code === status.PERMISSION_DENIED || code === status.UNAUTHENTICATED ? 'permission' :
    code === status.FAILED_PRECONDITION ? 'index' : 'network')
}
function metadata(authorization: ReadAuthorization): Metadata {
  const result = new Metadata()
  result.set('authorization', `Bearer ${authorization.idToken}`)
  result.set('x-firebase-appcheck', authorization.appCheckToken)
  result.set('google-cloud-resource-prefix', database)
  return result
}

// A Firebase user client over Google's published Firestore v1 protocol. There
// is no ADC, service account, Admin SDK or local authorization. Conditional
// writes are limited to existing message edit/delete, own-profile fields
// and create-only/version-conditional delete documents in the current user's contacts collection.
// A refused write explains itself in words that can name a document, so every identifier-looking
// run of characters is masked; what is left is the wording a diagnostics log may keep.
export function writeDetail(error: { details?: string; message?: string }): string {
  return `${error.details || error.message || ''}`.replace(/[A-Za-z0-9_-]{12,}/g, '*').slice(0, 120)
}
// `code` is the gRPC status of a refused write (0 when the call never reached the server) and
// `detail` its masked wording, kept so a caller can write them to its diagnostics log.
export class DocumentWriteFailure extends Error { constructor(readonly uncertain: boolean, readonly code = 0, readonly detail = '') { super(uncertain ? tr('저장 결과를 확인하지 못했습니다.') : tr('저장하지 못했습니다.')) } }

export class FirestoreReader {
  private readonly client: FirestoreClient
  private closed = false
  private readonly abort = new AbortController()
  constructor(private readonly auth: ReadCredentials) {
    const definition = fromJSON(JSON.parse(readFileSync(join(__dirname, '../../resources/firestore-v1.json'), 'utf8')), {
      longs: String, enums: String, bytes: Buffer, defaults: false, oneofs: true,
    })
    const loaded = loadPackageDefinition(definition) as unknown as { google: { firestore: { v1: { Firestore: new (address: string, channelCredentials: ReturnType<typeof credentials.createSsl>, options: object) => FirestoreClient } } } }
    this.client = new loaded.google.firestore.v1.Firestore('firestore.googleapis.com:443', credentials.createSsl(), {
      'grpc.max_receive_message_length': 2 * 1024 * 1024,
      'grpc.max_send_message_length': 2 * 1024 * 1024,
      // Telegram Desktop `Api::Updates::_noUpdatesTimer` (kNoUpdatesTimeout, 60s):
      // a session that received nothing for a minute pings, and a failed ping
      // reconnects and requests the difference. A Listen stream past CURRENT
      // has no watchdog of its own, so a transport that died without a close
      // (network path change, sleep the socket survived) would stay silent
      // until the 45-minute renewal. HTTP/2 keepalive ends such a stream, and
      // `watch` re-issues the target, which re-reads the whole result set.
      'grpc.keepalive_time_ms': 60000,
      'grpc.keepalive_timeout_ms': 20000,
      'grpc.keepalive_permit_without_calls': 1,
    })
  }
  private bounded(signal: AbortSignal): AbortSignal { return AbortSignal.any([signal, this.abort.signal, this.auth.signal]) }
  async getDocument(path: string, signal: AbortSignal, validate: () => void = () => {}): Promise<FirestoreDocument | null> {
    if (!path.startsWith(`${documents}/`)) throw new ReadFailure('data')
    const bounded = AbortSignal.any([this.bounded(signal), AbortSignal.timeout(35000)])
    bounded.throwIfAborted(); validate()
    const authorization = await this.auth.authorize(bounded, false)
    bounded.throwIfAborted(); validate()
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (error: unknown, value: FirestoreDocument | null = null): void => {
        if (settled) return
        settled = true; bounded.removeEventListener('abort', cancel)
        if (!error) { try { validate() } catch (scopeError) { error = scopeError } }
        if (error) reject(failure(error)); else resolve(value)
      }
      const cancel = (): void => { call.cancel(); finish(new ReadFailure('cancelled')) }
      const call = this.client.getDocument({ name: path }, metadata(authorization), { deadline: new Date(Date.now() + 30000) }, (error, response) => {
        if (error?.code === status.NOT_FOUND) { finish(null); return }
        if (error) { finish(error); return }
        try { const doc = document(response); if (doc.name !== path) throw new ReadFailure('data'); finish(null, doc) }
        catch (error) { finish(error) }
      })
      bounded.addEventListener('abort', cancel, { once: true }); if (bounded.aborted) cancel()
    })
  }
  async applyUploadedGroupPhoto(request: { id: string; chatId: string; version: string; url: string }, signal: AbortSignal,
    source: () => FirestoreDocument, beforeCommit: () => Promise<void>): Promise<void> {
    const bounded = AbortSignal.any([this.bounded(signal), AbortSignal.timeout(60000)])
    let authorization: ReadAuthorization, doc: FirestoreDocument
    try {
      bounded.throwIfAborted(); source()
      authorization = await this.auth.authorize(bounded, false)
      bounded.throwIfAborted(); source()
      await beforeCommit()
      bounded.throwIfAborted(); doc = source()
    } catch { throw new GroupPhotoApplyFailure(false) }
    try { await applyGroupPhoto(this.client, metadata(authorization), request, doc, bounded) }
    catch (error) { throw error instanceof GroupPhotoApplyFailure ? error : new GroupPhotoApplyFailure(true) }
  }
  async clearGroupPhoto(request: GroupPhotoClear, signal: AbortSignal, source: () => FirestoreDocument): Promise<void> {
    const bounded = AbortSignal.any([this.bounded(signal), AbortSignal.timeout(60000)])
    let authorization: ReadAuthorization, doc: FirestoreDocument
    try {
      bounded.throwIfAborted(); source()
      authorization = await this.auth.authorize(bounded, false)
      bounded.throwIfAborted(); doc = source()
    } catch { throw new GroupPhotoWriteFailure(false) }
    try { await clearGroupPhoto(this.client, metadata(authorization), request, doc, bounded) }
    catch (error) { throw error instanceof GroupPhotoWriteFailure ? error : new GroupPhotoWriteFailure(true) }
  }
  async applyUploadedChannelPhoto(uid: string, request: { id: string; channelId: string; version: string; url: string; kind: ChannelPhotoKind }, signal: AbortSignal,
    source: () => FirestoreDocument, beforeCommit: () => Promise<void>): Promise<void> {
    const bounded = AbortSignal.any([this.bounded(signal), AbortSignal.timeout(60000)])
    let authorization: ReadAuthorization
    try {
      bounded.throwIfAborted(); source()
      authorization = await this.auth.authorize(bounded, false)
      bounded.throwIfAborted(); source()
    } catch { throw new ChannelMetadataWriteFailure(false, tr('채널 사진 적용을 시작하지 못했습니다. 최신 채널 정보를 확인해 주세요.')) }
    await writeChannelMetadata(this.client, metadata(authorization), uid, { kind: 'apply-photo', edit: request, beforeCommit }, bounded, () => { source() })
  }
  async clearChannelPhoto(uid: string, request: ChannelPhotoClear, signal: AbortSignal, source: () => FirestoreDocument): Promise<number> {
    const bounded = AbortSignal.any([this.bounded(signal), AbortSignal.timeout(60000)])
    let authorization: ReadAuthorization
    try {
      bounded.throwIfAborted(); source()
      authorization = await this.auth.authorize(bounded, false)
      bounded.throwIfAborted(); source()
    } catch { throw new ChannelMetadataWriteFailure(false, tr('채널 사진 해제를 시작하지 못했습니다. 연결과 최신 채널 정보를 확인해 주세요.')) }
    return writeChannelMetadata(this.client, metadata(authorization), uid, { kind: 'clear-photo', edit: request }, bounded, () => { source() })
  }
  async setChannelName(uid: string, request: ChannelNameEdit, signal: AbortSignal, source: () => FirestoreDocument): Promise<number> {
    const bounded = AbortSignal.any([this.bounded(signal), AbortSignal.timeout(60000)])
    let authorization: ReadAuthorization
    try {
      bounded.throwIfAborted(); source()
      authorization = await this.auth.authorize(bounded, false)
      bounded.throwIfAborted(); source()
    } catch { throw new ChannelNameWriteFailure(false, tr('채널 이름 저장을 시작하지 못했습니다. 연결과 최신 채널 정보를 확인해 주세요.')) }
    return writeChannelName(this.client, metadata(authorization), uid, request, bounded, () => { source() })
  }
  async setChannelAccess(uid: string, request: ChannelAccessRequest, signal: AbortSignal, source: () => FirestoreDocument): Promise<void> {
    const bounded = AbortSignal.any([this.bounded(signal), AbortSignal.timeout(60000)])
    let authorization: ReadAuthorization, doc: FirestoreDocument
    try {
      bounded.throwIfAborted(); source()
      authorization = await this.auth.authorize(bounded, false)
      bounded.throwIfAborted(); doc = source()
    } catch { throw new ChannelAccessFailure(false) }
    try { await writeChannelAccess(this.client, metadata(authorization), uid, request, doc, bounded) }
    catch (error) { throw error instanceof ChannelAccessFailure ? error : new ChannelAccessFailure(true) }
  }
  async setChannelAdminAppointment(uid: string, request: ChannelAdminAppointment, signal: AbortSignal, source: () => FirestoreDocument): Promise<void> {
    const bounded = AbortSignal.any([this.bounded(signal), AbortSignal.timeout(60000)])
    let authorization: ReadAuthorization, channel: FirestoreDocument, subscriber: FirestoreDocument
    try {
      bounded.throwIfAborted(); source()
      authorization = await this.auth.authorize(bounded, false)
      bounded.throwIfAborted(); source()
      const current = await this.getDocument(`${documents}/channels/${request.channelId}/subscribers/${request.userId}`, bounded)
      bounded.throwIfAborted(); source()
      if (!current) throw new Error('Subscriber no longer exists')
      const admin = await this.getDocument(`${documents}/channels/${request.channelId}/admins/${request.userId}`, bounded)
      bounded.throwIfAborted(); channel = source()
      if (admin) throw new Error('Administrator already exists')
      subscriber = current
    } catch { throw new ChannelAdminAppointmentWriteFailure(false) }
    try { await writeChannelAdminAppointment(this.client, metadata(authorization), uid, request, channel, subscriber, bounded) }
    catch (error) { throw error instanceof ChannelAdminAppointmentWriteFailure ? error : new ChannelAdminAppointmentWriteFailure(true) }
  }
  async setChannelAdminRemoval(uid: string, request: ChannelAdminRemoval, signal: AbortSignal, source: () => FirestoreDocument): Promise<void> {
    const bounded = AbortSignal.any([this.bounded(signal), AbortSignal.timeout(60000)])
    let authorization: ReadAuthorization, channel: FirestoreDocument, admin: FirestoreDocument
    try {
      bounded.throwIfAborted(); source()
      authorization = await this.auth.authorize(bounded, false)
      bounded.throwIfAborted(); source()
      const current = await this.getDocument(`${documents}/channels/${request.channelId}/admins/${request.userId}`, bounded)
      bounded.throwIfAborted(); channel = source()
      if (!current) throw new Error('Administrator no longer exists')
      admin = current
    } catch { throw new ChannelAdminRemovalWriteFailure(false) }
    try { await writeChannelAdminRemoval(this.client, metadata(authorization), uid, request, channel, admin, bounded) }
    catch (error) { throw error instanceof ChannelAdminRemovalWriteFailure ? error : new ChannelAdminRemovalWriteFailure(true) }
  }
  async setChannelAdminPermissions(uid: string, request: ChannelAdminPermissionsEdit, signal: AbortSignal, source: () => FirestoreDocument): Promise<void> {
    const bounded = AbortSignal.any([this.bounded(signal), AbortSignal.timeout(60000)])
    let authorization: ReadAuthorization, channel: FirestoreDocument, admin: FirestoreDocument
    try {
      bounded.throwIfAborted(); source()
      authorization = await this.auth.authorize(bounded, false)
      bounded.throwIfAborted(); source()
      const current = await this.getDocument(`${documents}/channels/${request.channelId}/admins/${request.userId}`, bounded)
      bounded.throwIfAborted(); channel = source()
      if (!current) throw new Error('Administrator no longer exists')
      admin = current
    } catch { throw new ChannelAdminPermissionsWriteFailure(false) }
    try { await writeChannelAdminPermissions(this.client, metadata(authorization), uid, request, channel, admin, bounded) }
    catch (error) { throw error instanceof ChannelAdminPermissionsWriteFailure ? error : new ChannelAdminPermissionsWriteFailure(true) }
  }
  async setChannelTags(request: ChannelTagsEdit, signal: AbortSignal, source: () => FirestoreDocument): Promise<void> {
    const bounded = AbortSignal.any([this.bounded(signal), AbortSignal.timeout(60000)])
    let authorization: ReadAuthorization, doc: FirestoreDocument
    try {
      bounded.throwIfAborted(); source()
      authorization = await this.auth.authorize(bounded, false)
      bounded.throwIfAborted(); doc = source()
    } catch { throw new ChannelTagsWriteFailure(false) }
    try { await writeChannelTags(this.client, metadata(authorization), request, doc, bounded) }
    catch (error) { throw error instanceof ChannelTagsWriteFailure ? error : new ChannelTagsWriteFailure(true) }
  }
  async setChannelIntroduction(request: ChannelIntroductionEdit, signal: AbortSignal, source: () => FirestoreDocument): Promise<void> {
    const bounded = AbortSignal.any([this.bounded(signal), AbortSignal.timeout(60000)])
    let authorization: ReadAuthorization, doc: FirestoreDocument
    try {
      bounded.throwIfAborted(); source()
      authorization = await this.auth.authorize(bounded, false)
      bounded.throwIfAborted(); doc = source()
    } catch { throw new ChannelIntroductionWriteFailure(false) }
    try { await writeChannelIntroduction(this.client, metadata(authorization), request, doc, bounded) }
    catch (error) { throw error instanceof ChannelIntroductionWriteFailure ? error : new ChannelIntroductionWriteFailure(true) }
  }
  async setSpaceNotePin(uid: string, request: NotePinRequest, signal: AbortSignal, source: () => FirestoreDocument): Promise<void> {
    const bounded = AbortSignal.any([this.bounded(signal), AbortSignal.timeout(60000)])
    let authorization: ReadAuthorization, doc: FirestoreDocument
    try {
      bounded.throwIfAborted(); source()
      authorization = await this.auth.authorize(bounded, false)
      bounded.throwIfAborted(); doc = source()
    } catch { throw new NotePinFailure(false) }
    try { await writeSpaceNotePin(this.client, metadata(authorization), uid, request, doc, bounded) }
    catch (error) { throw error instanceof NotePinFailure ? error : new NotePinFailure(true) }
  }
  async setChannelPostLike(uid: string, request: ChannelPostLikeRequest, signal: AbortSignal, source: () => FirestoreDocument): Promise<void> {
    const bounded = AbortSignal.any([this.bounded(signal), AbortSignal.timeout(60000)])
    let authorization: ReadAuthorization, doc: FirestoreDocument
    try {
      bounded.throwIfAborted(); source()
      authorization = await this.auth.authorize(bounded, false)
      bounded.throwIfAborted(); doc = source()
    } catch { throw new ChannelPostLikeFailure(false) }
    try { await writeChannelPostLike(this.client, metadata(authorization), uid, request, doc, bounded) }
    catch (error) { throw error instanceof ChannelPostLikeFailure ? error : new ChannelPostLikeFailure(true) }
  }
  async resolveChannelPostPin(uid: string, request: ChannelPostPinResolution, signal: AbortSignal, source: () => PinResolutionWriteSource): Promise<void> {
    const bounded = AbortSignal.any([this.bounded(signal), AbortSignal.timeout(60000)])
    let authorization: ReadAuthorization, current: PinResolutionWriteSource
    try { bounded.throwIfAborted(); source(); authorization = await this.auth.authorize(bounded, false); bounded.throwIfAborted(); current = source() }
    catch { throw new ChannelPostPinResolutionFailure(false) }
    try { await writeChannelPostPinResolution(this.client, metadata(authorization), uid, request, current, bounded) }
    catch (error) { throw error instanceof ChannelPostPinResolutionFailure ? error : new ChannelPostPinResolutionFailure(true) }
  }
  async clearChannelPostExtraPin(uid: string, request: ChannelPostExtraPinRequest, signal: AbortSignal, source: () => ExtraPinWriteSource): Promise<void> {
    const bounded = AbortSignal.any([this.bounded(signal), AbortSignal.timeout(60000)])
    let authorization: ReadAuthorization, current: ExtraPinWriteSource
    try { bounded.throwIfAborted(); source(); authorization = await this.auth.authorize(bounded, false); bounded.throwIfAborted(); current = source() }
    catch { throw new ChannelPostExtraPinFailure(false) }
    try { await writeChannelPostExtraPin(this.client, metadata(authorization), uid, request, current, bounded) }
    catch (error) { throw error instanceof ChannelPostExtraPinFailure ? error : new ChannelPostExtraPinFailure(true) }
  }
  async saveChannelPostPin(uid: string, request: ChannelPostPinEdit, signal: AbortSignal, source: () => ChannelPinWriteSource): Promise<void> {
    const bounded = AbortSignal.any([this.bounded(signal), AbortSignal.timeout(60000)])
    let authorization: ReadAuthorization, current: ChannelPinWriteSource
    try { bounded.throwIfAborted(); source(); authorization = await this.auth.authorize(bounded, false); bounded.throwIfAborted(); current = source() }
    catch { throw new ChannelPostPinFailure(false) }
    try { await writeChannelPostPin(this.client, metadata(authorization), uid, request, current, bounded) }
    catch (error) { throw error instanceof ChannelPostPinFailure ? error : new ChannelPostPinFailure(true) }
  }
  async saveChannelPostText(uid: string, request: ChannelPostTextEdit, signal: AbortSignal, source: () => FirestoreDocument): Promise<void> {
    const bounded = AbortSignal.any([this.bounded(signal), AbortSignal.timeout(60000)])
    let authorization: ReadAuthorization, post: FirestoreDocument
    try { bounded.throwIfAborted(); source(); authorization = await this.auth.authorize(bounded, false); bounded.throwIfAborted(); post = source() }
    catch { throw new ChannelPostTextFailure(false) }
    try { await writeChannelPostText(this.client, metadata(authorization), uid, request, post, bounded) }
    catch (error) { throw error instanceof ChannelPostTextFailure ? error : new ChannelPostTextFailure(true) }
  }
  async setChannelPostVisibility(uid: string, request: PostVisibilityRequest, signal: AbortSignal, source: () => PostVisibilitySource): Promise<void> {
    const bounded = AbortSignal.any([this.bounded(signal), AbortSignal.timeout(60000)])
    let authorization: ReadAuthorization, current: PostVisibilitySource
    try { bounded.throwIfAborted(); source(); authorization = await this.auth.authorize(bounded, false); bounded.throwIfAborted(); current = source() }
    catch { throw new ChannelPostVisibilityFailure(false) }
    try { await writeChannelPostVisibility(this.client, metadata(authorization), uid, request, current, bounded) }
    catch (error) { throw error instanceof ChannelPostVisibilityFailure ? error : new ChannelPostVisibilityFailure(true) }
  }
  async removeChannelPost(uid: string, request: PostRemovalTarget, signal: AbortSignal, source: () => PostRemovalSource): Promise<void> {
    const bounded = AbortSignal.any([this.bounded(signal), AbortSignal.timeout(60000)])
    let authorization: ReadAuthorization, current: PostRemovalSource
    try { bounded.throwIfAborted(); source(); authorization = await this.auth.authorize(bounded, false); bounded.throwIfAborted(); current = source() }
    catch { throw new ChannelPostRemovalFailure(false) }
    try { await writeChannelPostRemoval(this.client, metadata(authorization), uid, request, current, bounded) }
    catch (error) { throw error instanceof ChannelPostRemovalFailure ? error : new ChannelPostRemovalFailure(true) }
  }
  async publishVideoStory(uid: string, request: StoryVideoPublicationCommitRequest, signal: AbortSignal, validate: () => void): Promise<void> {
    const bounded = AbortSignal.any([this.bounded(signal), AbortSignal.timeout(60000)])
    let authorization: ReadAuthorization
    try { bounded.throwIfAborted(); validate(); authorization = await this.auth.authorize(bounded, false); bounded.throwIfAborted(); validate() }
    catch { throw new StoryVideoPublicationFailure(false) }
    try { await writeStoryVideoPublication(this.client, metadata(authorization), uid, request, bounded) }
    catch (error) { throw error instanceof StoryVideoPublicationFailure ? error : new StoryVideoPublicationFailure(true) }
  }
  async publishStory(uid: string, request: StoryPublicationCommitRequest, signal: AbortSignal, validate: () => void): Promise<void> {
    const bounded = AbortSignal.any([this.bounded(signal), AbortSignal.timeout(60000)])
    let authorization: ReadAuthorization
    try { bounded.throwIfAborted(); validate(); authorization = await this.auth.authorize(bounded, false); bounded.throwIfAborted(); validate() }
    catch { throw new StoryPublicationFailure(false) }
    try { await writeStoryPublication(this.client, metadata(authorization), uid, request, bounded) }
    catch (error) { throw error instanceof StoryPublicationFailure ? error : new StoryPublicationFailure(true) }
  }
  async saveStoryCaption(uid: string, request: StoryCaptionSaveRequest, signal: AbortSignal, validate: () => void): Promise<void> {
    const bounded = AbortSignal.any([this.bounded(signal), AbortSignal.timeout(60000)])
    let authorization: ReadAuthorization
    try {
      bounded.throwIfAborted(); validate()
      const doc = await this.getDocument(`${documents}/users/${uid}/${ownStoryCollections[request.privacy]}/${request.storyId}`, bounded, validate)
      bounded.throwIfAborted(); validate()
      if (!doc || request.ownerId !== uid) throw new Error('Current own story missing')
      const current = ownStoryFromDocument(doc, uid, request.privacy), expiresAt = positionMilliseconds(current.expires)
      if (current.version !== request.draft.baseVersion || current.caption !== request.draft.baseCaption || expiresAt <= Date.now()) throw new Error('Story changed or expired')
      authorization = await this.auth.authorize(bounded, false); bounded.throwIfAborted(); validate()
      if (expiresAt <= Date.now()) throw new Error('Story expired before commit')
    } catch { throw new StoryCaptionSaveFailure(false) }
    try { await writeStoryCaptionSave(this.client, metadata(authorization), uid, request, bounded) }
    catch (error) { throw error instanceof StoryCaptionSaveFailure ? error : new StoryCaptionSaveFailure(true) }
  }
  async saveSpaceNoteText(uid: string, request: NoteTextSaveRequest, signal: AbortSignal, validate: () => void): Promise<void> {
    const bounded = AbortSignal.any([this.bounded(signal), AbortSignal.timeout(60000)])
    let authorization: ReadAuthorization
    try { bounded.throwIfAborted(); validate(); authorization = await this.auth.authorize(bounded, false); bounded.throwIfAborted(); validate() }
    catch { throw new NoteTextSaveFailure(false) }
    try { await writeNoteTextSave(this.client, metadata(authorization), uid, request, bounded) }
    catch (error) { throw error instanceof NoteTextSaveFailure ? error : new NoteTextSaveFailure(true) }
  }
  async changeCloseFriend(uid: string, request: CloseFriendChangeRequest, signal: AbortSignal, validate: () => void): Promise<void> {
    const bounded = AbortSignal.any([this.bounded(signal), AbortSignal.timeout(60000)])
    let authorization: ReadAuthorization
    try { bounded.throwIfAborted(); validate(); authorization = await this.auth.authorize(bounded, false); bounded.throwIfAborted(); validate() }
    catch { throw new CloseFriendChangeFailure(false) }
    try { await writeCloseFriendChange(this.client, metadata(authorization), uid, request, bounded) }
    catch (error) { throw error instanceof CloseFriendChangeFailure ? error : new CloseFriendChangeFailure(true) }
  }
  // users/{uid}/stickerSets/{setId}: install or remove a sticker set for this account.
  async installStickerPack(uid: string, pack: StickerPack, signal: AbortSignal, validate: () => void): Promise<void> {
    const bounded = AbortSignal.any([this.bounded(signal), AbortSignal.timeout(60000)])
    let authorization: ReadAuthorization
    try { bounded.throwIfAborted(); validate(); authorization = await this.auth.authorize(bounded, false); bounded.throwIfAborted(); validate() }
    catch { throw new StickerPackInstallFailure(false) }
    try { await writeStickerPackInstall(this.client, metadata(authorization), uid, pack, bounded, validate) }
    catch (error) { throw error instanceof StickerPackInstallFailure ? error : new StickerPackInstallFailure(true) }
  }
  async uninstallStickerPack(uid: string, setId: string, signal: AbortSignal, validate: () => void): Promise<void> {
    const bounded = AbortSignal.any([this.bounded(signal), AbortSignal.timeout(60000)])
    let authorization: ReadAuthorization
    try { bounded.throwIfAborted(); validate(); authorization = await this.auth.authorize(bounded, false); bounded.throwIfAborted(); validate() }
    catch { throw new StickerPackInstallFailure(false) }
    try { await writeStickerPackUninstall(this.client, metadata(authorization), uid, setId, bounded, validate) }
    catch (error) { throw error instanceof StickerPackInstallFailure ? error : new StickerPackInstallFailure(true) }
  }
  // users/{uid}/settings/dialog_{chatId}: this account's chat mute/archive, read by the push functions.
  async writeDialogPreference(uid: string, request: DialogPreferenceWrite, signal: AbortSignal, validate: () => void): Promise<void> {
    const bounded = AbortSignal.any([this.bounded(signal), AbortSignal.timeout(60000)])
    let authorization: ReadAuthorization
    try { bounded.throwIfAborted(); validate(); authorization = await this.auth.authorize(bounded, false); bounded.throwIfAborted(); validate() }
    catch { throw new DialogPreferenceWriteFailure(false) }
    try { await writeDialogPreference(this.client, metadata(authorization), uid, request, bounded, validate) }
    catch (error) { throw error instanceof DialogPreferenceWriteFailure ? error : new DialogPreferenceWriteFailure(true) }
  }
  async writeStoryViewReceipt(uid: string, request: StoryViewReceiptRequest, signal: AbortSignal, validate: () => void): Promise<void> {
    const bounded = AbortSignal.any([this.bounded(signal), AbortSignal.timeout(60000)])
    let authorization: ReadAuthorization
    try { bounded.throwIfAborted(); validate(); authorization = await this.auth.authorize(bounded, false); bounded.throwIfAborted(); validate() }
    catch { throw new StoryViewReceiptWriteFailure(false) }
    try { await writeStoryViewReceipt(this.client, metadata(authorization), uid, request, bounded, validate) }
    catch (error) { throw error instanceof StoryViewReceiptWriteFailure ? error : new StoryViewReceiptWriteFailure(true) }
  }
  async changeStoryReaction(uid: string, request: StoryReactionChangeRequest, signal: AbortSignal, validate: () => void): Promise<void> {
    const bounded = AbortSignal.any([this.bounded(signal), AbortSignal.timeout(60000)])
    let authorization: ReadAuthorization
    try { bounded.throwIfAborted(); validate(); authorization = await this.auth.authorize(bounded, false); bounded.throwIfAborted(); validate() }
    catch { throw new StoryReactionWriteFailure(false) }
    try { await writeStoryReaction(this.client, metadata(authorization), uid, request, bounded, validate) }
    catch (error) { throw error instanceof StoryReactionWriteFailure ? error : new StoryReactionWriteFailure(true) }
  }
  async changeStoryHiddenAudience(uid: string, request: StoryHiddenChangeRequest, signal: AbortSignal, validate: () => void): Promise<void> {
    const bounded = AbortSignal.any([this.bounded(signal), AbortSignal.timeout(60000)])
    let authorization: ReadAuthorization, current: FirestoreDocument
    try {
      bounded.throwIfAborted(); validate()
      const doc = await this.getDocument(`${documents}/users/${uid}/${ownStoryCollections[request.privacy]}/${request.storyId}`, bounded, validate)
      bounded.throwIfAborted(); validate()
      if (!doc) throw new Error('Source story missing')
      current = doc; authorization = await this.auth.authorize(bounded, false); bounded.throwIfAborted(); validate()
    } catch { throw new StoryHiddenChangeFailure(false) }
    try { await writeStoryHiddenChange(this.client, metadata(authorization), uid, request, current, bounded) }
    catch (error) { throw error instanceof StoryHiddenChangeFailure ? error : new StoryHiddenChangeFailure(true) }
  }
  async moveStoryPrivacy(uid: string, request: StoryPrivacyMoveRequest, signal: AbortSignal, validate: () => void): Promise<void> {
    const bounded = AbortSignal.any([this.bounded(signal), AbortSignal.timeout(60000)])
    let authorization: ReadAuthorization, current: FirestoreDocument
    try {
      bounded.throwIfAborted(); validate()
      const doc = await this.getDocument(`${documents}/users/${uid}/${ownStoryCollections[request.privacy]}/${request.storyId}`, bounded, validate)
      bounded.throwIfAborted(); validate()
      if (!doc) throw new Error('Source story missing')
      current = doc; authorization = await this.auth.authorize(bounded, false); bounded.throwIfAborted(); validate()
    } catch { throw new StoryPrivacyMoveFailure(false) }
    try { await writeStoryPrivacyMove(this.client, metadata(authorization), uid, request, current, bounded) }
    catch (error) { throw error instanceof StoryPrivacyMoveFailure ? error : new StoryPrivacyMoveFailure(true) }
  }
  async removeStory(uid: string, request: StoryRemovalRequest, signal: AbortSignal, validate: () => void): Promise<void> {
    const bounded = AbortSignal.any([this.bounded(signal), AbortSignal.timeout(60000)])
    let authorization: ReadAuthorization
    try { bounded.throwIfAborted(); validate(); authorization = await this.auth.authorize(bounded, false); bounded.throwIfAborted(); validate() }
    catch { throw new StoryRemovalFailure(false) }
    try { await writeStoryRemoval(this.client, metadata(authorization), uid, request, bounded) }
    catch (error) { throw error instanceof StoryRemovalFailure ? error : new StoryRemovalFailure(true) }
  }
  async removeSpaceNote(uid: string, request: NoteRemovalRequest, signal: AbortSignal, validate: () => void): Promise<void> {
    const bounded = AbortSignal.any([this.bounded(signal), AbortSignal.timeout(60000)])
    let authorization: ReadAuthorization
    try { bounded.throwIfAborted(); validate(); authorization = await this.auth.authorize(bounded, false); bounded.throwIfAborted(); validate() }
    catch { throw new NoteRemovalFailure(false) }
    try { await writeNoteRemoval(this.client, metadata(authorization), uid, request, bounded) }
    catch (error) { throw error instanceof NoteRemovalFailure ? error : new NoteRemovalFailure(true) }
  }
  async createSpaceNote(uid: string, request: NoteCreationRequest, signal: AbortSignal, validate: () => void): Promise<void> {
    const bounded = AbortSignal.any([this.bounded(signal), AbortSignal.timeout(60000)])
    let authorization: ReadAuthorization
    try { bounded.throwIfAborted(); validate(); authorization = await this.auth.authorize(bounded, false); bounded.throwIfAborted(); validate() }
    catch { throw new NoteCreationFailure(false) }
    try { await writeNoteCreation(this.client, metadata(authorization), uid, request, bounded) }
    catch (error) { throw error instanceof NoteCreationFailure ? error : new NoteCreationFailure(true) }
  }
  async createChannel(uid: string, request: ChannelCreationRequest, signal: AbortSignal, validate: () => void): Promise<void> {
    const bounded = AbortSignal.any([this.bounded(signal), AbortSignal.timeout(60000)])
    let authorization: ReadAuthorization
    try { bounded.throwIfAborted(); validate(); authorization = await this.auth.authorize(bounded, false); bounded.throwIfAborted(); validate() }
    catch { throw new ChannelCreationFailure(false) }
    try { await writeChannelCreation(this.client, metadata(authorization), uid, request, bounded) }
    catch (error) { throw error instanceof ChannelCreationFailure ? error : new ChannelCreationFailure(true) }
  }
  async createChannelPost(uid: string, request: PostCreationRequest, signal: AbortSignal, source: () => PostCreationSource): Promise<void> {
    const bounded = AbortSignal.any([this.bounded(signal), AbortSignal.timeout(60000)])
    let authorization: ReadAuthorization, current: PostCreationSource
    try { bounded.throwIfAborted(); source(); authorization = await this.auth.authorize(bounded, false); bounded.throwIfAborted(); current = source() }
    catch { throw new ChannelPostCreationFailure(false) }
    try { await writeChannelPostCreation(this.client, metadata(authorization), uid, request, current, bounded) }
    catch (error) { throw error instanceof ChannelPostCreationFailure ? error : new ChannelPostCreationFailure(true) }
  }
  async createChannelComment(uid: string, request: CommentCreationRequest, signal: AbortSignal, source: () => FirestoreDocument): Promise<void> {
    const bounded = AbortSignal.any([this.bounded(signal), AbortSignal.timeout(60000)])
    let authorization: ReadAuthorization, post: FirestoreDocument
    try { bounded.throwIfAborted(); source(); authorization = await this.auth.authorize(bounded, false); bounded.throwIfAborted(); post = source() }
    catch { throw new ChannelCommentCreationFailure(false) }
    try { await writeChannelCommentCreation(this.client, metadata(authorization), uid, request, post, bounded) }
    catch (error) { throw error instanceof ChannelCommentCreationFailure ? error : new ChannelCommentCreationFailure(true) }
  }
  async removeChannelComment(uid: string, request: ChannelCommentRemoval, signal: AbortSignal, source: () => CommentRemovalSource): Promise<void> {
    const bounded = AbortSignal.any([this.bounded(signal), AbortSignal.timeout(60000)])
    let authorization: ReadAuthorization, doc: CommentRemovalSource
    try {
      bounded.throwIfAborted(); source()
      authorization = await this.auth.authorize(bounded, false)
      bounded.throwIfAborted(); doc = source()
    } catch { throw new ChannelCommentRemovalFailure(false) }
    try { await writeChannelCommentRemoval(this.client, metadata(authorization), uid, request, doc, bounded) }
    catch (error) { throw error instanceof ChannelCommentRemovalFailure ? error : new ChannelCommentRemovalFailure(true) }
  }
  async setGroupAnnouncement(request: GroupAnnouncementEdit, signal: AbortSignal, source: () => FirestoreDocument): Promise<void> {
    const bounded = AbortSignal.any([this.bounded(signal), AbortSignal.timeout(60000)])
    let authorization: ReadAuthorization, doc: FirestoreDocument
    try {
      bounded.throwIfAborted(); source()
      authorization = await this.auth.authorize(bounded, false)
      bounded.throwIfAborted(); doc = source()
    } catch { throw new GroupAnnouncementWriteFailure(false) }
    try { await writeGroupAnnouncement(this.client, metadata(authorization), request, doc, bounded) }
    catch (error) { throw error instanceof GroupAnnouncementWriteFailure ? error : new GroupAnnouncementWriteFailure(true) }
  }
  async setGroupName(request: GroupNameEdit, signal: AbortSignal, source: () => FirestoreDocument): Promise<void> {
    const bounded = AbortSignal.any([this.bounded(signal), AbortSignal.timeout(60000)])
    let authorization: ReadAuthorization, doc: FirestoreDocument
    try {
      bounded.throwIfAborted(); source()
      authorization = await this.auth.authorize(bounded, false)
      bounded.throwIfAborted(); doc = source()
    } catch { throw new GroupNameWriteFailure(false) }
    try { await writeGroupName(this.client, metadata(authorization), request, doc, bounded) }
    catch (error) { throw error instanceof GroupNameWriteFailure ? error : new GroupNameWriteFailure(true) }
  }
  async setDialogPin(uid: string, request: DialogPinRequest, rank: number, signal: AbortSignal, source: () => FirestoreDocument | undefined): Promise<void> {
    const bounded = AbortSignal.any([this.bounded(signal), AbortSignal.timeout(60000)])
    let authorization: ReadAuthorization, doc: FirestoreDocument | undefined
    try {
      bounded.throwIfAborted(); source()
      authorization = await this.auth.authorize(bounded, false)
      bounded.throwIfAborted(); doc = source()
    } catch { throw new DialogPinWriteFailure(false) }
    try { await writeDialogPin(this.client, metadata(authorization), uid, request, rank, doc, bounded) }
    catch (error) { throw error instanceof DialogPinWriteFailure ? error : new DialogPinWriteFailure(true) }
  }
  async addParticipantContact(uid: string, chatId: string, peerUid: string, signal: AbortSignal, resolve: (doc?: FirestoreDocument) => ContactCreateFields): Promise<'added' | 'exists'> {
    const bounded = AbortSignal.any([this.bounded(signal), AbortSignal.timeout(60000)])
    bounded.throwIfAborted(); resolve()
    const authorization = await this.auth.authorize(bounded, false)
    bounded.throwIfAborted(); resolve()
    return createParticipantContact(this.client, metadata(authorization), uid, chatId, peerUid, bounded, resolve)
  }
  async addContact(uid: string, peer: PublicContact, signal: AbortSignal): Promise<'added' | 'exists'> {
    const bounded = this.bounded(signal)
    let authorization: ReadAuthorization
    try { bounded.throwIfAborted(); authorization = await this.auth.authorize(bounded, false); bounded.throwIfAborted() }
    catch { throw new ContactWriteFailure(false) }
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (result?: 'added' | 'exists', error?: ContactWriteFailure): void => {
        if (settled) return
        settled = true; bounded.removeEventListener('abort', cancel)
        if (error) reject(error); else resolve(result!)
      }
      const cancel = (): void => { call.cancel(); finish(undefined, new ContactWriteFailure(true)) }
      const call = this.client.commit({ database, writes: [{
        update: { name: `${documents}/users/${uid}/contacts/${peer.uid}`, fields: {
          userId: { stringValue: peer.userId }, displayName: { stringValue: peer.displayName }, photoURL: { stringValue: peer.photoURL }
        } }, updateTransforms: [{ fieldPath: 'addedAt', setToServerValue: 'REQUEST_TIME' }], currentDocument: { exists: false }
      }] }, metadata(authorization), { deadline: new Date(Date.now() + 30000) }, (error, response) => {
        if (error?.code === status.ALREADY_EXISTS) { finish('exists'); return }
        if (error) {
          finish(undefined, new ContactWriteFailure(![status.PERMISSION_DENIED, status.UNAUTHENTICATED, status.FAILED_PRECONDITION, status.INVALID_ARGUMENT].includes(error.code))); return
        }
        try {
          if (!Array.isArray(response.writeResults) || response.writeResults.length !== 1 || !response.commitTime) throw new Error('Invalid commit')
          timestamp(response.commitTime, ''); finish('added')
        } catch { finish(undefined, new ContactWriteFailure(true)) }
      })
      bounded.addEventListener('abort', cancel, { once: true }); if (bounded.aborted) cancel()
    })
  }
  // users/{uid}/blocked/{peer}: the same document the iOS app writes when blocking.
  async setBlockedUser(uid: string, peer: { uid: string; userId: string; displayName: string }, signal: AbortSignal): Promise<void> {
    await this.commitWrites([{ update: { name: `${documents}/users/${uid}/blocked/${peer.uid}`, fields: {
      userId: { stringValue: peer.userId }, displayName: { stringValue: peer.displayName }, photoURL: { stringValue: '' }
    } }, updateTransforms: [{ fieldPath: 'blockedAt', setToServerValue: 'REQUEST_TIME' }] }], signal)
  }
  async deleteBlockedUser(uid: string, peerUid: string, signal: AbortSignal): Promise<void> {
    await this.commitWrites([{ delete: `${documents}/users/${uid}/blocked/${peerUid}` }], signal)
  }
  // reports/{auto-id} with addDocument's 20-character id.
  async createReport(fields: Record<string, WireObject>, signal: AbortSignal): Promise<void> {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', bytes = randomBytes(20)
    const id = [...bytes].map(byte => alphabet[byte % alphabet.length]).join('')
    await this.commitWrites([{ update: { name: `${documents}/reports/${id}`, fields }, currentDocument: { exists: false } }], signal)
  }
  // updateData on the account's own user document (the named fields only).
  async updateUserFields(uid: string, fields: Record<string, WireObject>, mask: string[], signal: AbortSignal): Promise<void> {
    await this.commitWrites([{ update: { name: `${documents}/users/${uid}`, fields }, updateMask: { fieldPaths: mask }, currentDocument: { exists: true } }], signal)
  }
  // updateData on the room document: the named fields only, and the document must exist. A field in the mask but
  // not in `fields` is deleted, as FieldValue.delete() does.
  async updateChatFields(chatId: string, fields: Record<string, WireObject>, mask: string[], signal: AbortSignal): Promise<void> {
    await this.commitWrites([{ update: { name: `${documents}/chats/${chatId}`, fields }, updateMask: { fieldPaths: mask }, currentDocument: { exists: true } }], signal)
  }
  // chats/{chatId}/watchers/{uid} with setData(merge: true), as iOS writes the typing state.
  async setChatWatcherTyping(chatId: string, uid: string, typing: boolean, signal: AbortSignal): Promise<void> {
    await this.commitWrites([{ update: { name: `${documents}/chats/${chatId}/watchers/${uid}`, fields: { uid: { stringValue: uid }, typing: { booleanValue: typing } } },
      updateMask: { fieldPaths: ['uid', 'typing'] },
      updateTransforms: [{ fieldPath: 'enteredAt', setToServerValue: 'REQUEST_TIME' }, { fieldPath: 'typingAt', setToServerValue: 'REQUEST_TIME' }] }], signal)
  }
  async saveChatFolder(uid: string, folderId: string, fields: Record<string, WireObject>, mask: string[] | null, signal: AbortSignal): Promise<void> {
    const update = { name: `${documents}/users/${uid}/folders/${folderId}`, fields }
    await this.commitWrites([mask ? { update, updateMask: { fieldPaths: mask }, currentDocument: { exists: true } } : { update }], signal)
  }
  // stickerSets/{setId} and stickerIndex/{sha256} as the set's creator writes them (iOS MorseStickerSetStore).
  async commitStickerPackWrites(writes: WireObject[], signal: AbortSignal): Promise<void> {
    await this.commitWrites(writes, signal)
  }
  // channels/{channelId}/stories as StoryService writes them: the owner's new story (created once), a viewer's own
  // receipt and reaction, which storyViewerMutation allows.
  async createChannelStory(channelId: string, storyId: string, fields: Record<string, WireObject>, signal: AbortSignal): Promise<void> {
    await this.commitWrites([channelStoryCreateWrite(channelId, storyId, fields)], signal)
  }
  async markChannelStoryViewed(channelId: string, storyId: string, uid: string, signal: AbortSignal): Promise<void> {
    await this.commitWrites([channelStoryViewedWrite(channelId, storyId, uid)], signal)
  }
  async setChannelStoryReaction(channelId: string, storyId: string, uid: string, emoji: string | null, signal: AbortSignal): Promise<void> {
    await this.commitWrites([channelStoryReactionWrite(channelId, storyId, uid, emoji)], signal)
  }
  async deleteChannelStory(channelId: string, storyId: string, signal: AbortSignal): Promise<void> {
    await this.commitWrites([channelStoryDeleteWrite(channelId, storyId)], signal)
  }
  async deleteChatFolder(uid: string, folderId: string, signal: AbortSignal): Promise<void> {
    await this.commitWrites([{ delete: `${documents}/users/${uid}/folders/${folderId}` }], signal)
  }
  async reorderChatFolders(uid: string, folderIds: string[], signal: AbortSignal): Promise<void> {
    await this.commitWrites(folderIds.map((id, index) => ({ update: { name: `${documents}/users/${uid}/folders/${id}`, fields: { order: { integerValue: String(index) } } },
      updateMask: { fieldPaths: ['order'] }, currentDocument: { exists: true } })), signal)
  }
  // AppState.updateChatAutoDeletePolicy: the policy fields and the actor in one update of an existing chat.
  async setChatAutoDelete(uid: string, chatId: string, seconds: number, myOnly: boolean, signal: AbortSignal): Promise<void> {
    await this.commitWrites([{ update: { name: `${documents}/chats/${chatId}`, fields: {
      autoDeleteSeconds: { integerValue: String(seconds) }, autoDeleteMyOnly: { booleanValue: myOnly }, autoDeleteLastSetByUid: { stringValue: uid }
    } }, updateMask: { fieldPaths: ['autoDeleteSeconds', 'autoDeleteMyOnly', 'autoDeleteLastSetByUid'] }, currentDocument: { exists: true } }], signal)
  }
  // MorseDeferredOutgoingRequest.payload: a queue document the server sends at its time or when the peer comes online.
  async createDeferredMessage(collection: 'scheduledMessages' | 'pendingOnlineMessages', messageId: string, fields: Record<string, WireObject>, signal: AbortSignal): Promise<void> {
    await this.commitWrites([{ update: { name: `${documents}/${collection}/${messageId}`, fields }, currentDocument: { exists: false },
      updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }] }], signal)
  }
  // ChatRoomView.cancelPendingScheduledMessages: the sender deletes a queued document.
  // Telegram's "Delete chat" for everyone: the room document goes, which the rules allow a
  // participant of a 1:1 or memo chat and a group's own creator (firestore.rules chats delete).
  async deleteChatDocument(chatId: string, signal: AbortSignal): Promise<void> {
    await this.commitWrites([{ delete: `${documents}/chats/${chatId}`, currentDocument: { exists: true } }], signal)
  }
  async deleteDeferredMessage(collection: 'scheduledMessages' | 'pendingOnlineMessages', messageId: string, signal: AbortSignal): Promise<void> {
    await this.commitWrites([{ delete: `${documents}/${collection}/${messageId}`, currentDocument: { exists: true } }], signal)
  }
  // AppState.pinMessageForAll / unpinMessageForAll: arrayUnion / arrayRemove on the chat document.
  async setPinnedForAll(chatId: string, messageId: string, pinned: boolean, signal: AbortSignal): Promise<void> {
    await this.commitWrites([{ update: { name: `${documents}/chats/${chatId}`, fields: {} }, updateMask: { fieldPaths: [] },
      updateTransforms: [{ fieldPath: 'pinnedForAllMessageIds', [pinned ? 'appendMissingElements' : 'removeAllFromArray']: { values: [{ stringValue: messageId }] } }],
      currentDocument: { exists: true } }], signal)
  }
  // ChannelInquiryService.createInquiry: the subscriber creates the room once.
  async createChannelInquiry(inquiryId: string, fields: Record<string, WireObject>, signal: AbortSignal): Promise<void> {
    await this.commitWrites([{ update: { name: `${documents}/channelInquiries/${inquiryId}`, fields }, currentDocument: { exists: false },
      updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }] }], signal)
  }
  // «모두에게 고정» in an inquiry room: channelInquiries/{id}.pinnedForAllMessageIds, the field a chat keeps,
  // written by either participant (firestore.rules allows a participant every field the server does not own).
  async setInquiryPinnedForAll(inquiryId: string, messageId: string, pinned: boolean, signal: AbortSignal): Promise<void> {
    await this.commitWrites([{ update: { name: `${documents}/channelInquiries/${inquiryId}`, fields: {} }, updateMask: { fieldPaths: [] },
      updateTransforms: [{ fieldPath: 'pinnedForAllMessageIds', [pinned ? 'appendMissingElements' : 'removeAllFromArray']: { values: [{ stringValue: messageId }] } }],
      currentDocument: { exists: true } }], signal)
  }
  // The room's auto-delete policy, as a chat's (AppState.updateChatAutoDeletePolicy). firestore.rules
  // autoDeletePolicyActorOk: a change of the policy must name its actor, or the write is refused.
  async setInquiryAutoDelete(uid: string, inquiryId: string, seconds: number, myOnly: boolean, signal: AbortSignal): Promise<void> {
    await this.commitWrites([{ update: { name: `${documents}/channelInquiries/${inquiryId}`, fields: {
      autoDeleteSeconds: { integerValue: String(seconds) }, autoDeleteMyOnly: { booleanValue: myOnly }, autoDeleteLastSetByUid: { stringValue: uid }
    } }, updateMask: { fieldPaths: ['autoDeleteSeconds', 'autoDeleteMyOnly', 'autoDeleteLastSetByUid'] }, currentDocument: { exists: true } }], signal)
  }
  // ChannelInquiryService.editMessage / deleteMessage on an existing message.
  async editInquiryMessage(inquiryId: string, messageId: string, text: string, signal: AbortSignal): Promise<void> {
    await this.commitWrites([{ update: { name: `${documents}/channelInquiries/${inquiryId}/messages/${messageId}`, fields: { text: { stringValue: text }, isEdited: { booleanValue: true } } },
      updateMask: { fieldPaths: ['text', 'isEdited'] }, currentDocument: { exists: true } }], signal)
  }
  async deleteInquiryMessage(inquiryId: string, messageId: string, signal: AbortSignal): Promise<void> {
    await this.commitWrites([{ delete: `${documents}/channelInquiries/${inquiryId}/messages/${messageId}`, currentDocument: { exists: true } }], signal)
  }
  private async commitWrites(writes: WireObject[], signal: AbortSignal): Promise<void> {
    const bounded = this.bounded(signal)
    let authorization: ReadAuthorization
    try { bounded.throwIfAborted(); authorization = await this.auth.authorize(bounded, false); bounded.throwIfAborted() }
    catch { throw new DocumentWriteFailure(false) }
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const finish = (error?: DocumentWriteFailure): void => {
        if (settled) return
        settled = true; bounded.removeEventListener('abort', cancel)
        if (error) reject(error); else resolve()
      }
      const cancel = (): void => { call.cancel(); finish(new DocumentWriteFailure(true)) }
      const call = this.client.commit({ database, writes }, metadata(authorization), { deadline: new Date(Date.now() + 30000) }, (error, response) => {
        if (error) {
          const definite = [status.PERMISSION_DENIED, status.UNAUTHENTICATED, status.FAILED_PRECONDITION, status.NOT_FOUND, status.INVALID_ARGUMENT].includes(error.code)
          finish(new DocumentWriteFailure(!definite, error.code, writeDetail(error))); return
        }
        try {
          if (!Array.isArray(response.writeResults) || response.writeResults.length !== writes.length || !response.commitTime) throw new Error('Invalid commit')
          timestamp(response.commitTime, ''); finish()
        } catch { finish(new DocumentWriteFailure(true)) }
      })
      bounded.addEventListener('abort', cancel, { once: true }); if (bounded.aborted) cancel()
    })
  }
  async saveBio(uid: string, doc: FirestoreDocument, bio: string, signal: AbortSignal): Promise<void> {
    if (!doc.updateTime || doc.name !== `${documents}/users/${uid}`) throw new ProfileWriteFailure(false)
    const bounded = this.bounded(signal)
    let authorization: ReadAuthorization
    try { bounded.throwIfAborted(); authorization = await this.auth.authorize(bounded, false); bounded.throwIfAborted() }
    catch { throw new ProfileWriteFailure(false) }
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const finish = (error?: Error): void => {
        if (settled) return
        settled = true; bounded.removeEventListener('abort', cancel)
        if (error) reject(error); else resolve()
      }
      const cancel = (): void => { call.cancel(); finish(new ProfileWriteFailure(true)) }
      const call = this.client.commit({ database, writes: [{
        update: { name: doc.name, fields: { bio: { stringValue: bio } } },
        updateMask: { fieldPaths: ['bio'] }, currentDocument: { updateTime: doc.updateTime }
      }] }, metadata(authorization), { deadline: new Date(Date.now() + 30000) }, (error, response) => {
        if (error) {
          const definite = [status.PERMISSION_DENIED, status.UNAUTHENTICATED, status.FAILED_PRECONDITION, status.NOT_FOUND, status.INVALID_ARGUMENT].includes(error.code)
          finish(new ProfileWriteFailure(!definite)); return
        }
        try {
          if (!Array.isArray(response.writeResults) || response.writeResults.length !== 1 || !response.commitTime) throw new Error('Invalid commit')
          timestamp(response.commitTime, ''); finish()
        } catch { finish(new ProfileWriteFailure(true)) }
      })
      bounded.addEventListener('abort', cancel, { once: true })
      if (bounded.aborted) cancel()
    })
  }
  async saveProfileDisplay(uid: string, change: ProfileDisplayEdit, signal: AbortSignal, validate: () => void, beforeCommit?: () => Promise<void>): Promise<number> {
    const bounded = AbortSignal.any([this.bounded(signal), AbortSignal.timeout(90000)])
    let authorization: ReadAuthorization
    try { bounded.throwIfAborted(); validate(); authorization = await this.auth.authorize(bounded, false); bounded.throwIfAborted(); validate() }
    catch { throw new ProfileDisplayWriteFailure(false, tr('현재 계정과 프로필을 확인하지 못했습니다. 프로필 표시 정보는 변경하지 않았습니다.')) }
    return writeProfileDisplay(this.client, metadata(authorization), uid, change, bounded, validate, beforeCommit)
  }
  async deleteContact(uid: string, peerUid: string, doc: FirestoreDocument, signal: AbortSignal, validate: () => void = () => {}): Promise<void> {
    if (!doc.updateTime || doc.name !== `${documents}/users/${uid}/contacts/${peerUid}` || uid === peerUid) throw new ContactWriteFailure(false)
    const bounded = this.bounded(signal)
    let authorization: ReadAuthorization
    try { bounded.throwIfAborted(); validate(); authorization = await this.auth.authorize(bounded, false); bounded.throwIfAborted(); validate() }
    catch { throw new ContactWriteFailure(false) }
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const finish = (error?: ContactWriteFailure): void => {
        if (settled) return
        settled = true; bounded.removeEventListener('abort', cancel)
        if (error) reject(error); else resolve()
      }
      const cancel = (): void => { call.cancel(); finish(new ContactWriteFailure(true)) }
      const call = this.client.commit({ database, writes: [{ delete: doc.name, currentDocument: { updateTime: doc.updateTime } }] },
        metadata(authorization), { deadline: new Date(Date.now() + 30000) }, (error, response) => {
          if (error) {
            const definite = [status.PERMISSION_DENIED, status.UNAUTHENTICATED, status.FAILED_PRECONDITION, status.NOT_FOUND, status.INVALID_ARGUMENT].includes(error.code)
            finish(new ContactWriteFailure(!definite)); return
          }
          try {
            if (!Array.isArray(response.writeResults) || response.writeResults.length !== 1 || !response.commitTime) throw new Error('Invalid contact delete commit')
            timestamp(response.commitTime, ''); finish()
          } catch { finish(new ContactWriteFailure(true)) }
        })
      bounded.addEventListener('abort', cancel, { once: true }); if (bounded.aborted) cancel()
    })
  }
  async editText(doc: FirestoreDocument, text: string, signal: AbortSignal): Promise<void> {
    if (!doc.updateTime) throw new MessageMutationFailure(tr('메시지 버전을 확인하지 못했습니다.'), true)
    await this.commitMessage([{ update: { name: doc.name, fields: { text: { stringValue: text }, isEdited: { booleanValue: true } } },
      updateMask: { fieldPaths: ['text', 'isEdited'] }, currentDocument: { updateTime: doc.updateTime } }], signal)
  }
  async deleteMessage(doc: FirestoreDocument, chatId: string, messageId: string, uid: string, signal: AbortSignal): Promise<void> {
    if (!doc.updateTime || doc.name !== `${documents}/chats/${chatId}/messages/${messageId}`) throw new MessageMutationFailure(tr('메시지 버전을 확인하지 못했습니다.'), true)
    await this.commitMessage([
      { update: { name: `${documents}/chats/${chatId}/revokedForAll/${messageId}`, fields: {
        messageId: { stringValue: messageId }, deletedBy: { stringValue: uid } } },
        updateTransforms: [{ fieldPath: 'deletedAt', setToServerValue: 'REQUEST_TIME' }], currentDocument: { exists: false } },
      { delete: doc.name, currentDocument: { updateTime: doc.updateTime } },
    ], signal)
  }
  // Several messages of one room in one commit, each as deleteMessage writes it. `tombstone` false only takes away
  // a message whose revokedForAll record is already there.
  async deleteMessages(chatId: string, docs: FirestoreDocument[], uid: string, tombstone: boolean, signal: AbortSignal): Promise<void> {
    const prefix = `${documents}/chats/${chatId}/messages/`
    if (!docs.length || docs.some(doc => !doc.updateTime || !doc.name.startsWith(prefix) || doc.name.slice(prefix.length).includes('/'))) throw new MessageMutationFailure(tr('메시지 버전을 확인하지 못했습니다.'), true)
    await this.commitMessage(docs.flatMap(doc => {
      const messageId = doc.name.slice(prefix.length)
      return [
        ...(tombstone ? [{ update: { name: `${documents}/chats/${chatId}/revokedForAll/${messageId}`, fields: {
          messageId: { stringValue: messageId }, deletedBy: { stringValue: uid } } },
          updateTransforms: [{ fieldPath: 'deletedAt', setToServerValue: 'REQUEST_TIME' }], currentDocument: { exists: false } }] : []),
        { delete: doc.name, currentDocument: { updateTime: doc.updateTime } },
      ]
    }), signal)
  }
  private async commitMessage(writes: WireObject[], signal: AbortSignal): Promise<void> {
    const bounded = this.bounded(signal)
    let authorization: ReadAuthorization
    try { bounded.throwIfAborted(); authorization = await this.auth.authorize(bounded, false); bounded.throwIfAborted() }
    catch { throw new NotEmitted(tr('계정 연결을 확인하지 못했습니다.')) }
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const finish = (error?: Error): void => {
        if (settled) return
        settled = true; bounded.removeEventListener('abort', cancel)
        if (error) reject(error); else resolve()
      }
      const cancel = (): void => { call.cancel(); finish(new MessageMutationFailure(tr('요청 결과를 확인해야 합니다.'))) }
      const call = this.client.commit({ database, writes }, metadata(authorization), { deadline: new Date(Date.now() + 30000) }, (error, response) => {
        if (error) {
          const definitive = [status.PERMISSION_DENIED, status.UNAUTHENTICATED, status.FAILED_PRECONDITION, status.ALREADY_EXISTS, status.NOT_FOUND, status.INVALID_ARGUMENT].includes(error.code)
          finish(new MessageMutationFailure(definitive ? tr('메시지가 변경되었거나 작업 권한이 없습니다. 최신 메시지에서 다시 선택해 주세요.') : tr('요청 결과를 확인해야 합니다.'), definitive))
          return
        }
        try {
          if (!Array.isArray(response.writeResults) || response.writeResults.length !== writes.length || !response.commitTime) throw new Error('Invalid commit')
          timestamp(response.commitTime, ''); finish()
        } catch { finish(new MessageMutationFailure(tr('서버 저장 응답을 확인하지 못했습니다.'))) }
      })
      bounded.addEventListener('abort', cancel, { once: true })
      if (bounded.aborted) cancel()
    })
  }
  async discoverChannels(query: DiscoveryQuery, kind: 'name' | 'tag', signal: AbortSignal, validate: () => void): Promise<FirestoreDocument[]> {
    const bounded = AbortSignal.any([this.bounded(signal), AbortSignal.timeout(35000)])
    let authorization: ReadAuthorization
    try { bounded.throwIfAborted(); validate(); authorization = await this.auth.authorize(bounded, false); bounded.throwIfAborted(); validate() }
    catch (error) { throw failure(error) }
    return queryPublicChannels(this.client, metadata(authorization), query, kind, bounded, validate)
  }
  async query(parent: string, structuredQuery: WireObject, signal: AbortSignal): Promise<FirestoreDocument[]> {
    const bounded = this.bounded(signal)
    bounded.throwIfAborted()
    const authorization = await this.auth.authorize(bounded, false)
    bounded.throwIfAborted()
    return new Promise((resolve, reject) => {
      const rows: FirestoreDocument[] = []
      let bytes = 0, settled = false
      const stream = this.client.runQuery({ parent, structuredQuery }, metadata(authorization), { deadline: new Date(Date.now() + 30000) })
      const done = (error?: unknown): void => {
        if (settled) return
        settled = true
        bounded.removeEventListener('abort', cancel)
        if (error) { stream.cancel(); reject(failure(error)) }
        else resolve(rows)
      }
      const cancel = (): void => done(new ReadFailure('cancelled'))
      bounded.addEventListener('abort', cancel, { once: true })
      stream.on('data', (raw: WireObject) => {
        if (settled) return
        try {
          if (raw.document) {
            bytes += JSON.stringify(raw.document).length
            if (rows.length >= 81 || bytes > 16 * 1024 * 1024) throw new ReadFailure('data')
            rows.push(document(raw.document))
          }
        } catch (error) { done(error) }
      })
      stream.on('error', done)
      stream.on('end', () => done())
      if (bounded.aborted) cancel()
    })
  }

  watch(target: WireObject, signal: AbortSignal, events: WatchEvents, maxDocuments: number, maxBytes = 32 * 1024 * 1024): () => void {
    const local = new AbortController(), bounded = this.bounded(AbortSignal.any([signal, local.signal]))
    let stream: ClientDuplexStream<WireObject, WireObject> | null = null
    let retry: ReturnType<typeof setTimeout> | undefined
    let timeout: ReturnType<typeof setTimeout> | undefined
    let renewal: ReturnType<typeof setTimeout> | undefined
    let generation = 0, attempt = 0, force = false, everCurrent = false
    const relisten = (reason?: ReadFailure): void => { if (everCurrent && events.reconnecting) events.reconnecting(reason); else events.state('loading', reason) }
    const stopCycle = (): void => {
      generation++
      clearTimeout(timeout)
      clearTimeout(renewal)
      stream?.cancel(); stream = null
    }
    const cancel = (): void => { clearTimeout(retry); stopCycle() }
    bounded.addEventListener('abort', cancel, { once: true })
    const run = async (): Promise<void> => {
      if (bounded.aborted || this.closed) return
      stopCycle()
      const cycle = generation
      const active = (): boolean => !bounded.aborted && cycle === generation && !this.closed
      const received = new Map<string, FirestoreDocument>()
      const sizes = new Map<string, number>()
      let current = false, ended = false, dirty = true, totalBytes = 0
      const end = (error: unknown): void => {
        if (!active() || ended) return
        ended = true
        const reason = failure(error)
        if ((error as { code?: number } | null)?.code === status.UNAUTHENTICATED && !force) force = true
        else if (['permission', 'index', 'data'].includes(reason.code)) {
          stopCycle(); events.state('error', reason); return
        }
        stopCycle()
        relisten(reason)
        if (bounded.aborted || this.closed) return
        const wait = Math.min(30000, 1000 * 2 ** Math.min(attempt++, 5)) * (0.8 + Math.random() * 0.4)
        retry = setTimeout(() => { void run() }, wait)
      }
      try {
        relisten()
        const authorization = await this.auth.authorize(bounded, force)
        if (!active()) return
        const lifetime = authorization.expiresAt - Date.now() - 30000
        if (lifetime < 1000) throw new ReadFailure('permission')
        const renewAfter = Math.min(lifetime, 45 * 60000)
        stream = this.client.listen(metadata(authorization), { deadline: new Date(Date.now() + renewAfter + 30000) })
        renewal = setTimeout(() => { void run() }, renewAfter)
        const currentStream = stream
        timeout = setTimeout(() => end(new ReadFailure('network')), 45000)
        currentStream.on('data', (raw: WireObject) => {
          if (!active() || ended) return
          try {
            if (raw.documentChange) {
              const change = object(raw.documentChange)
              const item = document(change.document)
              const targets = Array.isArray(change.targetIds) ? change.targetIds : []
              const removed = Array.isArray(change.removedTargetIds) ? change.removedTargetIds : []
              if (targets.includes(1)) {
                const bytes = JSON.stringify(item).length
                totalBytes += bytes - (sizes.get(item.name) ?? 0)
                received.set(item.name, item); sizes.set(item.name, bytes); dirty = true
                if (totalBytes > maxBytes) throw new ReadFailure('data')
              } else if (removed.includes(1)) { totalBytes -= sizes.get(item.name) ?? 0; received.delete(item.name); sizes.delete(item.name); dirty = true }
            } else if (raw.documentDelete || raw.documentRemove) {
              const change = object(raw.documentDelete ?? raw.documentRemove)
              if (typeof change.document !== 'string') throw new ReadFailure('data')
              totalBytes -= sizes.get(change.document) ?? 0
              received.delete(change.document); sizes.delete(change.document); dirty = true
            } else if (raw.filter) {
              const filter = object(raw.filter)
              if (filter.targetId === 1 && Number(filter.count ?? 0) !== received.size) { end(new ReadFailure('network')); return }
            } else if (raw.targetChange) {
              const change = object(raw.targetChange)
              const ids = Array.isArray(change.targetIds) ? change.targetIds : []
              if (ids.length && !ids.includes(1)) return
              const type = change.targetChangeType ?? 'NO_CHANGE'
              if (type === 'REMOVE') { end(change.cause ?? new ReadFailure('permission')); return }
              if (type === 'RESET') {
                current = false; received.clear(); sizes.clear(); totalBytes = 0; dirty = true
                clearTimeout(timeout); timeout = setTimeout(() => end(new ReadFailure('network')), 45000)
                relisten()
              }
              if (type === 'CURRENT') current = true
              // Publish only at a server snapshot boundary, never midway through
              // a batch of removals/additions or before a fresh target is current.
              if (current && change.readTime) {
                clearTimeout(timeout)
                // An added row may arrive before the matching removal from a
                // limited query. Cardinality applies to a consistent boundary.
                if (received.size > maxDocuments) throw new ReadFailure('data')
                if (dirty) { events.snapshot(new Map(received)); dirty = false }
                if (!active()) return
                attempt = 0; force = false; everCurrent = true; events.state('ready')
              }
            }
          } catch (error) { end(error instanceof ReadFailure ? error : new ReadFailure('data')) }
        })
        currentStream.on('error', end)
        currentStream.on('end', () => end(new ReadFailure('network')))
        currentStream.write({ database, addTarget: { ...target, targetId: 1 } })
      } catch (error) { end(error) }
    }
    if (!bounded.aborted) void run()
    return () => { local.abort(); bounded.removeEventListener('abort', cancel); cancel() }
  }
  close(): void { if (!this.closed) { this.closed = true; this.abort.abort(); this.client.close() } }
}
