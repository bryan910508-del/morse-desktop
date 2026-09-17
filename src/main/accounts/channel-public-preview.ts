import { ChannelImages } from './channel-images'
import type { PublicChannelPhotosRequest } from '../../shared/channel-public-preview'
import { channelShareText, channelShareURL, publicChannelLinkTarget, type PublicChannelLinkRequest, type ChannelShareRequest } from '../../shared/channel-share'
import { ChannelMembershipReader } from './channel-membership-info'
import { ChannelPostLikeEditor } from './channel-post-like'
import type { ChannelPostLikeRequest } from '../../shared/channel-post-like'
import { PublicChannelComments } from './channel-public-comments'
import type { ChannelCommentsRequest } from '../../shared/channel-comments'
import { ChannelPostMediaSession } from './channel-post-media'
import type { ChannelPostMediaRequest } from '../../shared/channel-post-media'
import { channelPostMedia, channelPostRevision } from '../media/channel-post-media-document'
import type { FirestoreDocument } from '../network/firestore-values'
import type { PublicChannelPreviewRequest, PublicChannelPreviewSnapshot } from '../../shared/channel-public-preview'
import { comparePosition } from '../../shared/model'
import { FirestoreReader, type ReadCredentials } from '../network/firestore-rpc'
import { documents, documentVersion } from '../network/firestore-values'
import { publicChannelMetadata } from './channel-discovery-values'
import { decodeChannelPost } from './channel-posts'
import { tr } from '../../shared/i18n'
type PreviewSelection = Omit<PublicChannelPreviewRequest, 'searchRequestId'> & { searchRequestId: string | null; linkedPostId?: string | null }
interface PreviewOwner { root: FirestoreDocument | null; request: PreviewSelection; reader: FirestoreReader; abort: AbortController; stopRoot: (() => void) | null; stopPosts: (() => void) | null; feedGeneration: number }
export class ChannelPublicPreview {
  readonly avatars: ChannelImages
  readonly cover: ChannelImages
  private photoSelection: PublicChannelPhotosRequest | null = null
  readonly membership: ChannelMembershipReader
  readonly likes: ChannelPostLikeEditor
  readonly comments: PublicChannelComments
  readonly media: ChannelPostMediaSession
  private linkLookup: { requestId: string; abort: AbortController; reader: FirestoreReader } | null = null
  private rows = new Map<string, FirestoreDocument>()
  private closed = false
  private owner: PreviewOwner | null = null
  private value: PublicChannelPreviewSnapshot | null = null
  constructor(private readonly uid: string, private readonly auth: ReadCredentials, private readonly allowed: () => boolean,
    private readonly selection: (request: PublicChannelPreviewRequest) => void, private readonly changed: () => void) { this.avatars = new ChannelImages(auth, id => this.membershipSource(id).doc, () => this.publish(), 'avatar', 'public-preview'); this.cover = new ChannelImages(auth, id => this.membershipSource(id).doc, () => this.publish(), 'cover', 'public-preview'); this.membership = new ChannelMembershipReader(uid, auth, id => this.membershipSource(id), () => this.publish(), true); this.likes = new ChannelPostLikeEditor(uid, auth, (request, exact) => this.likeSource(request, exact)); this.media = new ChannelPostMediaSession(auth, request => this.mediaSource(request), () => this.publish(), '__public-channel-post-media'); this.comments = new PublicChannelComments(uid, auth, (request, exact) => this.commentSource(request, exact), () => this.publish()) }
  get snapshot(): PublicChannelPreviewSnapshot | null {
    const v = this.value
    return !v || this.closed || !this.allowed() ? null : { ...v, photos: this.photoSelection && v.status === 'ready' ? { requestId: this.photoSelection.requestId, avatar: this.avatars.snapshot(v.channelId), cover: this.cover.snapshot(v.channelId) } : null, membership: this.membership.snapshot, comments: this.comments.snapshot, media: this.media.snapshot, metadata: v.metadata ? { ...v.metadata, created: { ...v.metadata.created }, tags: v.metadata.tags ? [...v.metadata.tags] : null } : null, posts: v.posts.map(post => ({ ...post, likes: { ...post.likes }, media: post.media.map(item => ({ ...item })), position: { ...post.position } })) }
  }
  openPhotos(request: PublicChannelPhotosRequest): void {
    this.membershipSource(request.channelId)
    if (this.value?.requestId !== request.previewRequestId) throw new Error(tr('현재 공개 미리보기에서 사진을 다시 선택해 주세요.'))
    this.clearPhotos(); this.photoSelection = request
    this.avatars.setVisible([request.channelId]); this.cover.setVisible([request.channelId]); this.publish()
  }
  dismissPhotos(requestId: string): void {
    if (this.photoSelection?.requestId !== requestId) return
    this.clearPhotos(); this.publish()
  }
  private clearPhotos(): void { this.photoSelection = null; this.avatars.clear(); this.cover.clear() }
  shareText(request: ChannelShareRequest): string {
    this.shareLink(request)
    const name = publicChannelMetadata(this.membershipSource(request.channelId).doc).name
    return channelShareText(name, request.channelId, request.post?.id)
  }
  shareLink(request: ChannelShareRequest): string {
    const source = this.membershipSource(request.channelId)
    if (this.owner?.request.requestId !== request.requestId || documentVersion(source.doc) !== request.channelVersion) throw new Error(tr('현재 공개 채널이 변경되었습니다. 링크를 다시 선택해 주세요.'))
    if (request.post && channelPostRevision(this.creationSource({ channelId: request.channelId, postId: request.post.id })) !== request.post.revision) throw new Error(tr('현재 공개 게시물이 변경되었습니다. 링크를 다시 선택해 주세요.'))
    return channelShareURL(request.channelId, request.post?.id)
  }
  private membershipSource(channelId: string): { doc: FirestoreDocument; reader: FirestoreReader } {
    const owner = this.owner, value = this.value
    if (!owner || !this.current(owner) || !owner.root || !value || value.status !== 'ready' || !value.metadata || value.channelId !== channelId) throw new Error(tr('현재 공개 채널 정보를 먼저 확인해 주세요.'))
    return { doc: owner.root, reader: owner.reader }
  }
  creationSource(target: { channelId: string; postId: string }): FirestoreDocument {
    const owner = this.owner, value = this.value
    if (!owner || !this.current(owner) || !value || value.status !== 'ready' || !value.metadata || value.postStatus !== 'ready' || value.channelId !== target.channelId) throw new Error(tr('현재 공개 미리보기의 게시물을 다시 불러와 주세요.'))
    const post = this.rows.get(`${documents}/channels/${target.channelId}/posts/${target.postId}`)
    if (!post) throw new Error(tr('현재 공개 게시물을 찾을 수 없습니다.'))
    decodeChannelPost(post, target.channelId, 'public', this.uid)
    return post
  }
  commentObservationScope(target: { channelId: string; postId: string }): string {
    this.creationSource(target)
    return JSON.stringify(['public-preview', this.owner!.request.requestId, this.owner!.feedGeneration, target.channelId, target.postId])
  }
  private likeSource(request: ChannelPostLikeRequest, exact: boolean): FirestoreDocument {
    const owner = this.owner, value = this.value
    if (!owner || !this.current(owner) || !value || value.status !== 'ready' || !value.metadata || value.postStatus !== 'ready' || value.requestId !== request.requestId || value.channelId !== request.channelId) throw new Error('Public like scope changed')
    const doc = this.rows.get(`${documents}/channels/${request.channelId}/posts/${request.postId}`)
    if (!doc || (exact && channelPostRevision(doc) !== request.revision)) throw new Error('Public post changed')
    const post = decodeChannelPost(doc, request.channelId, 'public', this.uid)
    if (exact && (post.likes.status !== 'ready' || post.likes.selected !== request.selected || post.likes.count !== request.count)) throw new Error('Public like state changed')
    return doc
  }
  private commentSource(request: ChannelCommentsRequest, exact: boolean): { reader: FirestoreReader; post: FirestoreDocument } {
    const owner = this.owner, value = this.value
    if (!owner || !this.current(owner) || !value || value.status !== 'ready' || !value.metadata || value.postStatus !== 'ready' || value.requestId !== request.requestId || value.channelId !== request.channelId) throw new Error('Public comment scope changed')
    const doc = this.rows.get(`${documents}/channels/${request.channelId}/posts/${request.postId}`)
    if (!doc || (exact && channelPostRevision(doc) !== request.revision)) throw new Error('Public parent post changed')
    decodeChannelPost(doc, request.channelId, 'public', this.uid)
    return { reader: owner.reader, post: doc }
  }
  private mediaSource(request: ChannelPostMediaRequest): string {
    const owner = this.owner, value = this.value
    if (!owner || !this.current(owner) || !value || value.status !== 'ready' || !value.metadata || value.postStatus !== 'ready' || value.requestId !== request.requestId || value.channelId !== request.channelId) throw new Error('Public preview media scope changed')
    const doc = this.rows.get(`${documents}/channels/${request.channelId}/posts/${request.postId}`)
    if (!doc || channelPostRevision(doc) !== request.revision) throw new Error('Public post changed')
    decodeChannelPost(doc, request.channelId, 'public', this.uid)
    const item = channelPostMedia(doc, request.channelId).items[request.index], path = request.presentation === 'video' ? item?.videoPath : item?.path
    if (!path) throw new Error('Public post media unavailable')
    return path
  }
  private current(owner: PreviewOwner): boolean { return !this.closed && this.owner === owner && !owner.abort.signal.aborted && !this.auth.signal.aborted && this.allowed() }
  private publish(): void { if (!this.closed) this.changed() }
  private clearPosts(owner: PreviewOwner, status: PublicChannelPreviewSnapshot['postStatus'] = 'idle'): void {
    owner.feedGeneration++; owner.stopPosts?.(); owner.stopPosts = null; this.rows.clear(); this.media.clear(); this.comments.clear(); this.likes.pause()
    if (this.owner === owner && this.value) { this.value.posts = []; this.value.postStatus = status; this.value.postMessage = '' }
  }
  pause(): void { this.clearPhotos(); const lookup = this.linkLookup; this.linkLookup = null; lookup?.abort.abort(); lookup?.reader.close(); this.membership.clear(); const owner = this.owner; if (this.value) this.likes.dismiss(this.value.requestId); this.owner = null; this.value = null; this.rows.clear(); this.media.clear(); this.comments.clear(); this.likes.pause(); if (owner) { owner.abort.abort(); owner.stopRoot?.(); owner.stopPosts?.(); owner.reader.close() }; this.publish() }
  dismiss(requestId: string): void { if (this.value?.requestId === requestId || this.linkLookup?.requestId === requestId) this.pause() }
  open(request: PublicChannelPreviewRequest): void {
    if (this.closed || !this.allowed()) throw new Error(tr('현재 계정과 잠금을 확인해 주세요.'))
    this.selection(request)
    this.begin(request)
  }
  async openLink(request: PublicChannelLinkRequest): Promise<void> {
    if (this.closed || !this.allowed()) throw new Error(tr('현재 계정과 잠금을 확인해 주세요.'))
    const { channelId, postId } = publicChannelLinkTarget(request.url)
    this.pause()
    const lookup = { requestId: request.requestId, abort: new AbortController(), reader: new FirestoreReader(this.auth) }
    this.linkLookup = lookup
    const signal = AbortSignal.any([this.auth.signal, lookup.abort.signal, AbortSignal.timeout(40000)])
    const validate = (): void => { signal.throwIfAborted(); if (this.closed || !this.allowed() || this.linkLookup !== lookup) throw new Error(tr('채널 링크 조회 범위가 변경되었습니다.')) }
    try {
      const doc = await lookup.reader.getDocument(`${documents}/channels/${channelId}`, signal, validate)
      validate()
      if (!doc) throw new Error(tr('현재 공개 채널을 확인할 수 없습니다.'))
      const metadata = publicChannelMetadata(doc)
      if (metadata.id !== channelId) throw new Error(tr('채널 링크 대상이 다릅니다.'))
      this.begin({ requestId: request.requestId, searchRequestId: null, channelId, linkedPostId: postId, version: metadata.version })
    } finally { if (this.linkLookup === lookup) this.linkLookup = null; lookup.abort.abort(); lookup.reader.close() }
  }
  private begin(request: PreviewSelection): void {
    this.pause()
    const owner: PreviewOwner = { root: null, request, reader: new FirestoreReader(this.auth), abort: new AbortController(), stopRoot: null, stopPosts: null, feedGeneration: 0 }
    this.owner = owner
    this.value = { ...request, photos: null, linkedPostId: request.linkedPostId ?? null, membership: null, comments: null, media: null, status: 'loading', metadata: null, message: tr('선택한 채널의 현재 공개 정보를 확인하고 있습니다.'), postsRequested: Boolean(request.linkedPostId), postStatus: 'idle', posts: [], postMessage: '' }
    this.likes.open(request.requestId)
    const path = `${documents}/channels/${request.channelId}`
    owner.stopRoot = owner.reader.watch({ documents: { documents: [path] } }, owner.abort.signal, {
      snapshot: rows => {
        if (!this.current(owner) || !this.value) return
        try {
          const doc = rows.get(path)
          if (!doc || rows.size !== 1 || doc.name !== path) throw new Error('Selected channel missing')
          this.value.metadata = publicChannelMetadata(doc); owner.root = doc; this.value.status = 'ready'; this.value.message = tr('현재 공개 채널 정보입니다. 내 채널 목록이나 가입 상태를 변경하지 않습니다.')
          this.avatars.prune(); this.cover.prune()
          if (this.value.postsRequested && !owner.stopPosts) this.startPosts(owner)
        } catch { owner.root = null; this.clearPhotos(); this.membership.clear(); this.value.metadata = null; this.value.status = 'blocked'; this.value.message = tr('선택한 채널의 현재 공개 상태·문서 형식을 확인할 수 없습니다. 이전 정보와 게시물을 숨깁니다.'); this.clearPosts(owner, 'blocked') }
        this.publish()
      },
      state: (state, error) => {
        if (!this.current(owner) || !this.value || state === 'ready') return
        owner.root = null; this.clearPhotos(); this.membership.clear(); this.value.metadata = null; this.value.status = state; this.clearPosts(owner, 'blocked')
        this.value.message = state === 'loading' ? tr('현재 채널 정보의 연결을 확인하고 있습니다.') : error?.code === 'permission' ? tr('현재 채널 정보 접근을 확인하지 못했습니다.') : tr('현재 채널 정보를 읽지 못했습니다. 검색 결과에서 다시 선택해 주세요.')
        this.publish()
      }
    }, 1, 2 * 1024 * 1024)
    this.publish()
  }
  openChannelFeed(requestId: string): void {
    const owner = this.owner, value = this.value
    if (!owner || !this.current(owner) || !value || value.requestId !== requestId || value.status !== 'ready' || !value.metadata || !value.linkedPostId) throw new Error(tr('현재 공유 게시물의 공개 채널 정보를 확인해 주세요.'))
    value.linkedPostId = null; owner.request.linkedPostId = null
    this.loadPosts(requestId)
  }
  loadPosts(requestId: string): void {
    const owner = this.owner, value = this.value
    if (!owner || !this.current(owner) || !value || value.requestId !== requestId || value.status !== 'ready' || !value.metadata) throw new Error(tr('현재 공개 채널 정보를 먼저 확인해 주세요.'))
    value.postsRequested = true; this.startPosts(owner); this.publish()
  }
  private startPosts(owner: PreviewOwner): void {
    const value = this.value
    if (!this.current(owner) || !value || value.status !== 'ready' || !value.metadata) return
    this.clearPosts(owner)
    value.postStatus = 'loading'; value.postMessage = tr('현재 공개 게시물을 불러오고 있습니다.')
    const generation = owner.feedGeneration
    const current = (): boolean => this.current(owner) && generation === owner.feedGeneration && this.value === value && value.status === 'ready' && Boolean(value.metadata)
    const linkedPath = value.linkedPostId ? `${documents}/channels/${value.channelId}/posts/${value.linkedPostId}` : null
    const target = linkedPath ? { documents: { documents: [linkedPath] } } : { query: { parent: `${documents}/channels/${value.channelId}`, structuredQuery: {
      from: [{ collectionId: 'posts' }], where: { fieldFilter: { field: { fieldPath: 'visibility' }, op: 'EQUAL', value: { stringValue: 'public' } } }, limit: { value: 501 }
    } } }
    owner.stopPosts = owner.reader.watch(target, owner.abort.signal, {
      snapshot: rows => {
        if (!current()) return
        try {
          if (linkedPath && (rows.size > 1 || [...rows].some(([name, doc]) => name !== linkedPath || doc.name !== linkedPath))) throw new Error('Linked post scope mismatch')
          if (linkedPath && rows.size === 0) { this.rows.clear(); this.media.clear(); this.comments.clear(); this.likes.pause(); value.postStatus = 'blocked'; value.posts = []; value.postMessage = tr('지정한 공개 게시물을 현재 조회에서 확인할 수 없습니다. 삭제 여부나 다른 접근 권한을 추정하지 않습니다.') }
          else if (rows.size > 500) { this.rows.clear(); this.media.clear(); this.comments.clear(); this.likes.pause(); value.postStatus = 'limit'; value.posts = []; value.postMessage = tr('공개 게시물 500개 한도를 넘었습니다. 일부 목록을 전체처럼 표시하지 않습니다.') }
          else {
            value.posts = [...rows.values()].map(doc => {
              const p = decodeChannelPost(doc, value.channelId, 'public', this.uid)
              return { id: p.id, revision: p.revision, likes: p.likes, media: p.media, text: p.text, position: p.position, hasMedia: p.hasMedia, mediaCount: p.mediaCount, likeCount: p.likeCount, commentCount: p.commentCount }
            }).sort((a, b) => comparePosition(b.position, a.position))
            this.rows = new Map(rows); value.postStatus = 'ready'; value.postMessage = ''; this.media.prune(); this.comments.prune(); this.likes.prune()
          }
        } catch { this.rows.clear(); this.media.clear(); this.comments.clear(); this.likes.pause(); value.posts = []; value.postStatus = 'error'; value.postMessage = tr('공개 게시물의 형식이나 조회 범위를 확인할 수 없습니다.') }
        this.publish()
      },
      state: (state, error) => {
        if (!current() || state === 'ready') return
        this.rows.clear(); this.media.clear(); this.comments.clear(); this.likes.pause(); value.posts = []; value.postStatus = state
        value.postMessage = state === 'loading' ? tr('공개 게시물의 연결을 확인하고 있습니다.') : error?.code === 'index' ? tr('공개 게시물 조회 인덱스를 확인해야 합니다.') : tr('공개 게시물을 읽지 못했습니다. 연결과 접근 범위를 확인해 주세요.')
        this.publish()
      }
    }, linkedPath ? 1 : 501, linkedPath ? 2 * 1024 * 1024 : 8 * 1024 * 1024)
  }
  async close(): Promise<void> { this.closed = true; this.pause(); this.avatars.close(); this.cover.close(); await this.likes.close(); await this.comments.close() }
}
