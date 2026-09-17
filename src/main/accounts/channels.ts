import { publicChannelMetadata } from './channel-discovery-values'
import { channelShareText, channelShareURL, type ChannelShareRequest } from '../../shared/channel-share'
import { channelDiscussionReference } from './channel-discussion-reference'
import type { ChannelDiscussionNavigation } from '../../shared/channel-discussion-navigation'
import { ChannelAdminAppointmentEditor } from './channel-admin-appointment'
import type { ChannelAdminAppointment } from '../../shared/channel-admin-appointment'
import { ChannelAdminRemovalEditor } from './channel-admin-removal'
import type { ChannelAdminRemoval } from '../../shared/channel-admin-removal'
import { ChannelAdminPermissionsEditor } from './channel-admin-permissions'
import { channelAdminIndex } from './channel-admin-values'
import type { ChannelAdminPermissionsEdit } from '../../shared/channel-admin-permissions'
import { ChannelAdminsReader } from './channel-admins'
import { ChannelSubscribersReader } from './channel-subscribers'
import { ChannelJoinRequestsReader } from './channel-join-requests'
import { ChannelMembershipReader } from './channel-membership-info'
import { channelAccessInfo, editableChannelAccess } from './channel-access'
import { ChannelTagsEditor } from './channel-tags'
import { readChannelTags, type ChannelTagsEdit } from '../../shared/channel-tags'
import { ChannelIntroductionEditor } from './channel-introduction'
import type { ChannelIntroductionEdit } from '../../shared/channel-introduction'
import { ChannelNameEditor } from './channel-name'
import type { ChannelNameEdit } from '../../shared/channel-name'
import { ChannelPhotoClearEditor } from './channel-photo-clear'
import type { ChannelPhotoClear } from '../../shared/channel-photo-clear'
import { ChannelImages } from './channel-images'
import { ChannelPosts } from './channel-posts'
import type { ChannelsSnapshot, ChannelSummary, ChannelCoverRequest } from '../../shared/channels'
import { comparePosition } from '../../shared/model'
import { identifier } from '../../shared/validation'
import { FirestoreReader, type ReadCredentials } from '../network/firestore-rpc'
import { childId, documents, documentVersion, mapField, numberField, stringField, timestamp, type FirestoreDocument } from '../network/firestore-values'
import { tr } from '../../shared/i18n'

type Kind = 'subscriptions' | 'owned'
interface Batch { ids: string[]; status: ChannelSummary['status']; rows: Map<string, FirestoreDocument>; stop(): void }
const empty = (id: string, status: ChannelSummary['status'], subscriptionListed: boolean): ChannelSummary => ({
  id, status, subscriptionListed, publicSharing: null, avatar: null, cover: null, hasAvatar: false, hasCover: false, discussion: null, tags: null, access: null, editableAccess: null, version: null, name: '', description: '', ownerName: '', owned: false, type: 'unknown', subscriberCount: null, postCount: null, updated: null
})
// iOS Channel.type: the stored type, else isPublic for channels made before the field existed.
export function channelDocumentType(f: FirestoreDocument['fields']): ChannelSummary['type'] {
  const raw = stringField(f, 'type', 32)
  return ['public', 'private', 'invite'].includes(raw) ? raw as ChannelSummary['type'] : raw ? 'unknown'
    : f.isPublic?.booleanValue === true ? 'public' : f.isPublic?.booleanValue === false ? 'private' : 'unknown'
}
export function decodeChannelSummary(doc: FirestoreDocument, uid: string, subscribed: boolean): ChannelSummary {
  const id = childId(doc.name, `${documents}/channels`), f = doc.fields
  const name = stringField(f, 'name', 512).trim(), owner = identifier(stringField(f, 'ownerId', 160))
  if (!name || !f.createdAt?.timestampValue) throw new Error('Invalid channel metadata')
  const created = timestamp(f.createdAt.timestampValue, id), last = f.lastPostAt?.timestampValue
  const count = (key: string): number | null => {
    if (f[key] === undefined) return null
    if (f[key].integerValue === undefined && f[key].doubleValue === undefined) throw new Error('Invalid channel count type')
    const value = numberField(f, key)
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid channel count')
    return value
  }
  const type = channelDocumentType(f)
  let version: string | null = null
  try { version = documentVersion(doc) } catch { /* Read-only metadata can remain visible without an edit version. */ }
  let publicSharing: ChannelSummary['publicSharing'] = null
  try { const metadata = publicChannelMetadata(doc); publicSharing = { name: metadata.name, version: metadata.version } } catch { /* Keep nonpublic or malformed metadata out of sharing. */ }
  return { ...empty(id, 'ready', subscribed), publicSharing, discussion: channelDiscussionReference(doc), access: channelAccessInfo(doc), editableAccess: editableChannelAccess(doc), tags: readChannelTags(f.tags), version, name, description: stringField(f, 'description', 10000),
    hasAvatar: typeof f.photoURL?.stringValue === 'string' && !!f.photoURL.stringValue,
    hasCover: typeof f.coverURL?.stringValue === 'string' && !!f.coverURL.stringValue,
    ownerName: stringField(mapField(f, 'ownerInfo'), 'displayName', 512), owned: owner === uid, type,
    subscriberCount: count('subscriberCount'), postCount: count('postCount'), updated: last ? timestamp(last, id) : created }
}

// Metadata only: a subscription-list entry is not proof of post-read authority.
export class ChannelsSession {
  private tagsSelection: { channelId: string; requestId: string } | null = null
  readonly tagsEditor: ChannelTagsEditor
  private photoClearSelection: { channelId: string; requestId: string; kind: ChannelPhotoClear['kind'] } | null = null
  readonly photoClear: ChannelPhotoClearEditor
  private nameSelection: { channelId: string; requestId: string } | null = null
  readonly nameEditor: ChannelNameEditor
  private introductionSelection: { channelId: string; requestId: string } | null = null
  readonly introduction: ChannelIntroductionEditor
  readonly adminAppointment: ChannelAdminAppointmentEditor
  private adminAppointmentSelection: { requestId: string; channelId: string; userId: string; subscribersRequestId: string; adminsRequestId: string } | null = null
  readonly adminRemoval: ChannelAdminRemovalEditor
  private adminRemovalSelection: { requestId: string; channelId: string; userId: string; listRequestId: string } | null = null
  readonly adminPermissions: ChannelAdminPermissionsEditor
  private adminPermissionSelection: { requestId: string; channelId: string; userId: string; listRequestId: string } | null = null
  readonly admins: ChannelAdminsReader
  readonly subscribers: ChannelSubscribersReader
  readonly joinRequests: ChannelJoinRequestsReader
  readonly membership: ChannelMembershipReader
  readonly posts: ChannelPosts
  readonly avatars: ChannelImages
  readonly cover: ChannelImages
  private coverRequest: ChannelCoverRequest | null = null
  private reader: FirestoreReader | null = null
  private visible = false
  private connected = false
  private locked = false
  private closed = false
  private generation = 0
  private rows: Record<Kind, Map<string, FirestoreDocument>> = { subscriptions: new Map(), owned: new Map() }
  private ready: Record<Kind, boolean> = { subscriptions: false, owned: false }
  private batches: Batch[] = []
  private batchKey = ''
  private status: ChannelsSnapshot['status'] = 'idle'
  private message = ''
  constructor(private readonly uid: string, private readonly auth: ReadCredentials, private readonly changed: () => void) {
    this.photoClear = new ChannelPhotoClearEditor(uid, auth, (request, exact) => this.photoClearSource(request, exact))
    this.nameEditor = new ChannelNameEditor(uid, auth, (request, exact) => this.nameSource(request, exact))
    this.tagsEditor = new ChannelTagsEditor(auth, (request, exact) => this.tagsSource(request, exact))
    this.introduction = new ChannelIntroductionEditor(auth, (request, exact) => this.introductionSource(request, exact))
    this.avatars = new ChannelImages(auth, id => this.postSource(id).doc, changed)
    this.cover = new ChannelImages(auth, id => this.postSource(id).doc, changed, 'cover')
    this.adminAppointment = new ChannelAdminAppointmentEditor(uid, auth, (request, exact) => this.adminAppointmentSource(request, exact))
    this.adminRemoval = new ChannelAdminRemovalEditor(uid, auth, (request, exact) => this.adminRemovalSource(request, exact))
    this.adminPermissions = new ChannelAdminPermissionsEditor(uid, auth, (request, exact) => this.adminPermissionsSource(request, exact))
    this.admins = new ChannelAdminsReader(uid, auth, id => this.postSource(id), changed)
    this.subscribers = new ChannelSubscribersReader(uid, auth, id => this.postSource(id), changed)
    this.joinRequests = new ChannelJoinRequestsReader(uid, auth, id => this.postSource(id), changed)
    this.membership = new ChannelMembershipReader(uid, auth, id => this.postSource(id), changed)
    this.posts = new ChannelPosts(uid, auth, id => this.postSource(id), changed)
  }
  get snapshot(): ChannelsSnapshot {
    if (this.closed || this.locked || !this.visible || !this.connected || this.status !== 'ready') return { status: this.status, message: this.message, items: [], admins: null, subscribers: null, joinRequests: null, membership: null, posts: null }
    const subscribed = new Set([...this.rows.subscriptions.keys()].map(name => childId(name, `${documents}/users/${this.uid}/subscriptions`)))
    const docs = new Map(this.rows.owned), states = new Map<string, ChannelSummary['status']>()
    for (const batch of this.batches) for (const id of batch.ids) {
      const doc = batch.rows.get(`${documents}/channels/${id}`)
      if (batch.status === 'ready' && doc) docs.set(doc.name, doc)
      states.set(id, batch.status === 'ready' ? doc ? 'ready' : 'unavailable' : batch.status)
    }
    const ids = new Set([...subscribed, ...[...this.rows.owned.keys()].map(name => childId(name, `${documents}/channels`))])
    const items = [...ids].map(id => {
      const doc = docs.get(`${documents}/channels/${id}`)
      try { return doc ? { ...decodeChannelSummary(doc, this.uid, subscribed.has(id)), avatar: this.avatars.snapshot(id), cover: this.cover.snapshot(id) } : empty(id, states.get(id) ?? 'loading', subscribed.has(id)) }
      catch { return empty(id, 'error', subscribed.has(id)) }
    }).sort((a, b) => a.updated && b.updated ? comparePosition(b.updated, a.updated) : a.updated ? -1 : b.updated ? 1 : a.id.localeCompare(b.id))
    return { status: this.status, message: this.message, items, admins: this.admins.snapshot, subscribers: this.subscribers.snapshot, joinRequests: this.joinRequests.snapshot, membership: this.membership.snapshot, posts: this.posts.snapshot }
  }
  private postSource(id: string): { doc: FirestoreDocument; reader: FirestoreReader } {
    if (this.closed || this.locked || !this.visible || !this.connected || this.status !== 'ready' || !this.reader) throw new Error('Channel list unavailable')
    const path = `${documents}/channels/${id}`
    let doc = this.rows.owned.get(path)
    if (!doc && this.rows.subscriptions.has(`${documents}/users/${this.uid}/subscriptions/${id}`)) {
      const batch = this.batches.find(batch => batch.status === 'ready' && batch.ids.includes(id))
      doc = batch?.rows.get(path)
    }
    if (!doc) throw new Error('Channel not in current list')
    decodeChannelSummary(doc, this.uid, false)
    return { doc, reader: this.reader }
  }
  shareLink(request: ChannelShareRequest): string {
    const doc = this.postSource(request.channelId).doc
    publicChannelMetadata(doc)
    if (documentVersion(doc) !== request.channelVersion) throw new Error(tr('현재 공개 채널 정보가 변경되었습니다. 공유 내용을 다시 확인해 주세요.'))
    if (request.post) this.posts.shareSource(request)
    return channelShareURL(request.channelId, request.post?.id)
  }
  shareText(request: ChannelShareRequest): string {
    this.shareLink(request)
    const name = publicChannelMetadata(this.postSource(request.channelId).doc).name
    return channelShareText(name, request.channelId, request.post?.id)
  }
  currentDocument(channelId: string): FirestoreDocument | null {
    try { return this.postSource(channelId).doc } catch { return null }
  }
  discussionNavigationSource(request: ChannelDiscussionNavigation): FirestoreDocument {
    const doc = this.postSource(request.channelId).doc, reference = channelDiscussionReference(doc)
    if (!doc.updateTime || documentVersion(doc) !== request.version || reference.status !== 'known' || reference.chatId !== request.chatId) throw new Error(tr('채널 토론방 연결 정보가 변경되었습니다.'))
    return doc
  }
  get uploadLifetime(): number { return this.generation }
  uploadSource(channelId: string, version?: string): FirestoreDocument {
    const doc = this.postSource(channelId).doc
    if (stringField(doc.fields, 'ownerId', 160) !== this.uid || !doc.updateTime || !documentVersion(doc) || (version !== undefined && documentVersion(doc) !== version)) throw new Error(tr('최신 채널 정보와 소유자 권한을 확인해 주세요.'))
    return doc
  }
  openAdminAppointment(request: ChannelAdminAppointment): void {
    this.adminAppointmentDocument(request)
    this.adminAppointmentSelection = { requestId: request.requestId, channelId: request.channelId, userId: request.userId, subscribersRequestId: request.subscribersRequestId, adminsRequestId: request.adminsRequestId }
    this.adminAppointment.open(request.requestId)
  }
  closeAdminAppointment(requestId: string): void {
    if (this.adminAppointmentSelection?.requestId !== requestId) return
    this.adminAppointmentSelection = null; this.adminAppointment.dismiss(requestId)
  }
  private adminAppointmentSource(request: ChannelAdminAppointment, exact: boolean): FirestoreDocument {
    const selection = this.adminAppointmentSelection
    if (!selection || selection.requestId !== request.requestId || selection.channelId !== request.channelId || selection.userId !== request.userId || selection.subscribersRequestId !== request.subscribersRequestId || selection.adminsRequestId !== request.adminsRequestId) throw new Error(tr('현재 관리자 지정을 다시 열어 주세요.'))
    // Our own commit may add the administrator before its acknowledgement arrives.
    return exact ? this.adminAppointmentDocument(request) : this.ownerEditDocument(request, false)
  }
  private adminAppointmentDocument(request: ChannelAdminAppointment): FirestoreDocument {
    const doc = this.ownerEditDocument(request, true), subscribers = this.subscribers.snapshot, admins = this.admins.snapshot
    const row = subscribers?.status === 'ready' && subscribers.channelId === request.channelId && subscribers.requestId === request.subscribersRequestId ? subscribers.rows.find(row => row.uid === request.userId) : null
    const index = channelAdminIndex(doc)
    if (request.userId === this.uid || !row?.name || row.name !== request.label || row.version !== request.subscriberVersion || stringField(doc.fields, 'name', 512) !== request.title ||
      admins?.status !== 'ready' || admins.channelId !== request.channelId || admins.requestId !== request.adminsRequestId || admins.rows.some(row => row.uid === request.userId) ||
      !index.ids || (!index.ids.has(request.userId) && index.ids.size >= 1000)) throw new Error(tr('최신 구독자·관리자 목록에서 대상을 다시 선택해 주세요.'))
    return doc
  }
  openAdminRemoval(request: ChannelAdminRemoval): void {
    this.adminPermissionsDocument(request, true)
    this.adminRemovalSelection = { requestId: request.requestId, channelId: request.channelId, userId: request.userId, listRequestId: request.listRequestId }
    this.adminRemoval.open(request.requestId)
  }
  closeAdminRemoval(requestId: string): void {
    if (this.adminRemovalSelection?.requestId !== requestId) return
    this.adminRemovalSelection = null; this.adminRemoval.dismiss(requestId)
  }
  private adminRemovalSource(request: ChannelAdminRemoval, exact: boolean): FirestoreDocument {
    const selection = this.adminRemovalSelection
    if (!selection || selection.requestId !== request.requestId || selection.channelId !== request.channelId || selection.userId !== request.userId || selection.listRequestId !== request.listRequestId) throw new Error(tr('현재 관리자 해제를 다시 열어 주세요.'))
    // Deletion of this row by our own commit must not abort its acknowledgement.
    return exact ? this.adminPermissionsDocument(request, true) : this.ownerEditDocument(request, false)
  }
  openAdminPermissions(request: ChannelAdminPermissionsEdit): void {
    this.adminPermissionsDocument(request, true)
    this.adminPermissionSelection = { requestId: request.requestId, channelId: request.channelId, userId: request.userId, listRequestId: request.listRequestId }
    this.adminPermissions.open(request.requestId)
  }
  closeAdminPermissions(requestId: string): void {
    if (this.adminPermissionSelection?.requestId !== requestId) return
    this.adminPermissionSelection = null; this.adminPermissions.dismiss(requestId)
  }
  private adminPermissionsSource(request: ChannelAdminPermissionsEdit, exact: boolean): FirestoreDocument {
    const selection = this.adminPermissionSelection
    if (!selection || selection.requestId !== request.requestId || selection.channelId !== request.channelId || selection.userId !== request.userId || selection.listRequestId !== request.listRequestId) throw new Error(tr('현재 관리자 편집을 다시 열어 주세요.'))
    return this.adminPermissionsDocument(request, exact)
  }
  private adminPermissionsDocument(request: Omit<ChannelAdminPermissionsEdit, 'changes'>, exact: boolean): FirestoreDocument {
    const doc = this.ownerEditDocument(request, exact), admins = this.admins.snapshot
    const row = admins?.status === 'ready' && admins.channelId === request.channelId && admins.requestId === request.listRequestId ? admins.rows.find(row => row.uid === request.userId) : null
    if (request.userId === this.uid || !row || (exact && (row.version !== request.adminVersion || (row.name || row.uid) !== request.label || stringField(doc.fields, 'name', 512) !== request.title || !channelAdminIndex(doc).ids))) throw new Error(tr('최신 관리자 정보와 참조 목록을 확인해 주세요.'))
    return doc
  }
  joinDecisionSource(request: import('../../shared/channel-join-decisions').ChannelJoinDecisionRequest): void {
    const doc = this.ownerEditDocument(request, true), pending = this.joinRequests.snapshot
    if (request.userId === this.uid || stringField(doc.fields, 'name', 512) !== request.title || pending?.status !== 'ready' || pending.channelId !== request.channelId ||
      !pending.rows.some(row => row.uid === request.userId && row.version === request.requestVersion)) throw new Error(tr('최신 가입 요청 목록에서 신청자를 다시 선택해 주세요.'))
  }
  openPhotoClear(request: ChannelPhotoClear): void {
    this.photoClearDocument(request, true)
    this.photoClearSelection = { channelId: request.channelId, requestId: request.requestId, kind: request.kind }
    this.photoClear.open(request.requestId)
  }
  closePhotoClear(requestId: string): void {
    if (this.photoClearSelection?.requestId !== requestId) return
    this.photoClearSelection = null; this.photoClear.dismiss(requestId)
  }
  private photoClearSource(request: ChannelPhotoClear, exact: boolean): FirestoreDocument {
    const selection = this.photoClearSelection
    if (!selection || selection.requestId !== request.requestId || selection.channelId !== request.channelId || selection.kind !== request.kind) throw new Error(tr('현재 채널 사진 해제를 다시 열어 주세요.'))
    return this.photoClearDocument(request, exact)
  }
  private photoClearDocument(request: ChannelPhotoClear, exact: boolean): FirestoreDocument {
    const doc = this.ownerEditDocument(request, exact), field = request.kind === 'cover' ? 'coverURL' : 'photoURL'
    if (exact && (typeof doc.fields[field]?.stringValue !== 'string' || !doc.fields[field].stringValue)) throw new Error(tr('현재 해제할 사진을 확인할 수 없습니다.'))
    return doc
  }
  openName(request: ChannelNameEdit): void {
    this.ownerEditDocument(request, true)
    this.nameSelection = { channelId: request.channelId, requestId: request.requestId }
    this.nameEditor.open(request.requestId)
  }
  closeName(requestId: string): void {
    if (this.nameSelection?.requestId !== requestId) return
    this.nameSelection = null; this.nameEditor.dismiss(requestId)
  }
  private nameSource(request: ChannelNameEdit, exact: boolean): FirestoreDocument {
    if (this.nameSelection?.requestId !== request.requestId || this.nameSelection.channelId !== request.channelId) throw new Error(tr('현재 채널 이름 편집을 다시 열어 주세요.'))
    return this.ownerEditDocument(request, exact)
  }
  openTags(request: ChannelTagsEdit): void {
    this.ownerEditDocument(request, true)
    this.tagsSelection = { channelId: request.channelId, requestId: request.requestId }
    this.tagsEditor.open(request.requestId)
  }
  closeTags(requestId: string): void {
    if (this.tagsSelection?.requestId !== requestId) return
    this.tagsSelection = null; this.tagsEditor.dismiss(requestId)
  }
  private tagsSource(request: ChannelTagsEdit, exact: boolean): FirestoreDocument {
    if (this.tagsSelection?.requestId !== request.requestId || this.tagsSelection.channelId !== request.channelId) throw new Error(tr('현재 채널 편집을 다시 열어 주세요.'))
    return this.ownerEditDocument(request, exact)
  }
  openIntroduction(request: ChannelIntroductionEdit): void {
    this.ownerEditDocument(request, true)
    this.introductionSelection = { channelId: request.channelId, requestId: request.requestId }
    this.introduction.open(request.requestId)
  }
  closeIntroduction(requestId: string): void {
    if (this.introductionSelection?.requestId !== requestId) return
    this.introductionSelection = null; this.introduction.dismiss(requestId)
  }
  private introductionSource(request: ChannelIntroductionEdit, exact: boolean): FirestoreDocument {
    if (this.introductionSelection?.requestId !== request.requestId || this.introductionSelection.channelId !== request.channelId) throw new Error(tr('현재 채널 편집을 다시 열어 주세요.'))
    return this.ownerEditDocument(request, exact)
  }
  private ownerEditDocument(request: { channelId: string; version: string }, exact: boolean): FirestoreDocument {
    const doc = this.postSource(request.channelId).doc
    if (stringField(doc.fields, 'ownerId', 160) !== this.uid || (exact && documentVersion(doc) !== request.version)) throw new Error(tr('최신 채널 정보와 소유자 권한을 확인해 주세요.'))
    return doc
  }
  private publish(): void { this.adminAppointment.prune(); this.adminRemoval.prune(); this.adminPermissions.prune(); this.admins.prune(); this.subscribers.prune(); this.joinRequests.prune(); this.membership.prune(); this.photoClear.prune(); this.nameEditor.prune(); this.tagsEditor.prune(); this.introduction.prune(); this.posts.prune(); this.avatars.prune(); this.cover.prune(); this.changed() }
  showCover(request: ChannelCoverRequest): void {
    this.postSource(request.channelId)
    this.cover.clear(); this.coverRequest = { ...request }; this.cover.setVisible([request.channelId])
  }
  hideCover(requestId: string): void {
    if (this.coverRequest?.requestId !== requestId) return
    this.coverRequest = null; this.cover.clear(); this.changed()
  }
  // The list's read state without decoding it (ChannelHome waits for it).
  get listStatus(): ChannelsSnapshot['status'] { return this.closed || this.locked || !this.visible || !this.connected ? 'idle' : this.status }
  setVisible(value: boolean): void { if (this.visible !== value) { this.visible = value; this.restart() } }
  connection(value: boolean): void { if (this.connected !== value) { this.connected = value; this.restart() } }
  // Leaving the channels tab or a reconnect keeps downloaded channel photos (ChannelImages' retained cache);
  // a locked screen forgets them.
  setLocked(value: boolean): void { if (this.locked !== value) { this.locked = value; if (value) this.avatars.clear(); this.restart() } }
  refresh(): void {
    if (this.closed || this.locked || !this.connected || !this.visible) throw new Error(tr('채널 화면과 계정 연결을 확인해 주세요.'))
    this.restart()
  }
  private clearBatches(): void { for (const batch of this.batches) batch.stop(); this.batches = []; this.batchKey = '' }
  private stop(): void {
    this.adminAppointment.pause(); this.adminRemoval.pause(); this.adminPermissions.pause(); this.admins.clear(); this.subscribers.clear(); this.joinRequests.clear(); this.membership.clear(); this.photoClear.pause(); this.nameEditor.pause(); this.tagsEditor.pause(); this.introduction.pause(); this.posts.clear(); this.cover.clear(); this.coverRequest = null; this.generation++; this.clearBatches(); this.reader?.close(); this.reader = null
    this.rows = { subscriptions: new Map(), owned: new Map() }; this.ready = { subscriptions: false, owned: false }
  }
  private restart(): void {
    if (this.closed) return
    this.stop(); this.status = this.visible ? 'loading' : 'idle'; this.message = ''
    if (!this.visible || !this.connected || this.locked) { this.publish(); return }
    const generation = this.generation
    let reader: FirestoreReader
    try { reader = new FirestoreReader(this.auth); this.reader = reader }
    catch { this.status = 'error'; this.message = tr('채널 연결을 준비하지 못했습니다. 다시 불러와 주세요.'); this.publish(); return }
    const active = () => !this.closed && generation === this.generation && this.reader === reader
    for (const kind of ['subscriptions', 'owned'] as const) {
      const parent = kind === 'subscriptions' ? `${documents}/users/${this.uid}` : documents, limit = kind === 'subscriptions' ? 500 : 50
      const query = { parent, structuredQuery: { from: [{ collectionId: kind === 'subscriptions' ? 'subscriptions' : 'channels' }], limit: { value: limit + 1 },
        ...(kind === 'owned' ? { where: { fieldFilter: { field: { fieldPath: 'ownerId' }, op: 'EQUAL', value: { stringValue: this.uid } } } } : {}) } }
      reader.watch({ query }, this.auth.signal, {
        snapshot: rows => {
          if (!active()) return
          try {
            if (rows.size > limit) throw new Error('limit')
            for (const doc of rows.values()) {
              childId(doc.name, `${parent}/${kind === 'owned' ? 'channels' : 'subscriptions'}`)
              if (kind === 'owned' && stringField(doc.fields, 'ownerId', 160) !== this.uid) throw new Error('scope')
            }
            this.rows[kind] = rows; this.ready[kind] = true
            if (this.ready.subscriptions && this.ready.owned) { this.status = 'ready'; this.message = ''; this.reconcile(reader, active) }
          } catch {
            this.ready[kind] = false; this.rows[kind].clear(); this.clearBatches(); this.status = 'error'
            this.message = rows.size > limit ? tr('채널 목록이 지원 범위(구독 500개·소유 50개)를 넘었습니다. 일부 목록으로 표시하지 않습니다.') : tr('채널 목록 데이터를 확인하지 못했습니다.')
          }
          this.publish()
        },
        state: state => {
          if (!active() || state === 'ready') return
          this.ready[kind] = false; this.rows[kind].clear(); this.clearBatches()
          this.status = state === 'error' ? 'error' : 'loading'; this.message = state === 'error' ? tr('채널 목록을 읽지 못했습니다. 연결·권한을 확인한 뒤 새로고침해 주세요.') : tr('채널 목록 연결을 확인하고 있습니다.'); this.publish()
        }
      }, limit + 1, 8 * 1024 * 1024)
    }
    this.publish()
  }
  private reconcile(reader: FirestoreReader, active: () => boolean): void {
    const ids = [...this.rows.subscriptions.keys()].map(name => childId(name, `${documents}/users/${this.uid}/subscriptions`))
      .filter(id => !this.rows.owned.has(`${documents}/channels/${id}`)).sort()
    const key = JSON.stringify(ids)
    if (key === this.batchKey) return
    this.clearBatches(); this.batchKey = key
    for (let offset = 0; offset < ids.length; offset += 10) {
      const batch: Batch = { ids: ids.slice(offset, offset + 10), status: 'loading', rows: new Map(), stop: () => {} }
      this.batches.push(batch)
      const names = batch.ids.map(id => `${documents}/channels/${id}`)
      const current = () => active() && this.batches.includes(batch)
      batch.stop = reader.watch({ documents: { documents: names } }, this.auth.signal, {
        snapshot: rows => {
          if (!current()) return
          if ([...rows.keys()].some(name => !names.includes(name))) { batch.status = 'error'; batch.rows.clear() }
          else { batch.status = 'ready'; batch.rows = rows }
          this.publish()
        },
        state: state => { if (current() && state !== 'ready') { batch.status = state; batch.rows.clear(); this.publish() } }
      }, 10, 2 * 1024 * 1024)
    }
  }
  close(): void { this.closed = true; void this.posts.visibilityEditor.close(); void this.posts.removalEditor.close(); void this.posts.pinResolutionEditor.close(); void this.posts.extraPinEditor.close(); void this.posts.pinEditor.close(); void this.posts.textEditor.close(); void this.posts.likes.close(); void this.posts.comments.removal.close(); void this.adminAppointment.close(); void this.adminRemoval.close(); void this.adminPermissions.close(); void this.photoClear.close(); void this.nameEditor.close(); void this.tagsEditor.close(); void this.introduction.close(); this.stop(); this.avatars.close(); this.cover.close(); this.status = 'idle'; this.message = '' }
}
