import type { ChannelShareRequest } from '../../shared/channel-share'
import { ChannelPostVisibilityEditor } from './channel-post-visibility'
import type { PostVisibilityRequest } from '../../shared/channel-post-visibility'
import { validatePostVisibility, type PostVisibilitySource } from '../network/channel-post-visibility-write'
import { ChannelPostRemovalEditor } from './channel-post-removal'
import type { PostRemovalTarget } from '../../shared/channel-post-removal'
import { postRemovalContentEligible, validatePostRemoval, type PostRemovalSource } from '../network/channel-post-removal-write'
import type { PostCreationSource } from '../network/channel-post-creation-write'
import { channelPostAuthoring } from './channel-post-authoring'
import { ChannelPostPinResolutionEditor } from './channel-post-pin-resolution'
import type { ChannelPostPinResolution } from '../../shared/channel-post-pin-resolution'
import type { PinResolutionWriteSource } from '../network/channel-post-pin-resolution-write'
import { ChannelPostExtraPinEditor } from './channel-post-extra-pin'
import type { ChannelPostExtraPinRequest } from '../../shared/channel-post-extra-pin'
import type { ExtraPinWriteSource } from '../network/channel-post-extra-pin-write'
import { ChannelPostPinEditor } from './channel-post-pin'
import type { ChannelPostPinEdit } from '../../shared/channel-post-pin-edit'
import type { ChannelPinWriteSource } from '../network/channel-post-pin-write'
import { documentVersion } from '../network/firestore-values'
import { channelPinReference, channelPostPinFlag, channelPostPinInfo } from './channel-post-pins'
import { ChannelPostTextEditor } from './channel-post-text'
import { editablePostText } from '../network/channel-post-text-write'
import type { ChannelPostTextEdit } from '../../shared/channel-post-text-edit'
import { ChannelComments } from './channel-comments'
import type { ChannelCommentsRequest } from '../../shared/channel-comments'
import { ChannelPostLikeEditor } from './channel-post-like'
import { channelPostLikeState } from './channel-post-like-state'
import type { ChannelPostLikeRequest } from '../../shared/channel-post-like'
import { ChannelPostMediaSession } from './channel-post-media'
import type { ChannelPostMediaRequest } from '../../shared/channel-post-media'
import { channelPostMedia, channelPostRevision } from '../media/channel-post-media-document'
import { ChannelPostPictures, type PictureSource } from './channel-post-pictures'
import type { ChannelPostsRequest, ChannelPostsSnapshot, ChannelPostText } from '../../shared/channel-posts'
import { comparePosition } from '../../shared/model'
import { identifier } from '../../shared/validation'
import type { FirestoreReader, ReadCredentials } from '../network/firestore-rpc'
import { childId, documents, numberField, stringField, timestamp, type FirestoreDocument } from '../network/firestore-values'
import { tr } from '../../shared/i18n'

export function publicChannelPosts(doc: FirestoreDocument): boolean {
  const type = stringField(doc.fields, 'type', 32)
  // Missing/unknown public flags never grant public-post access.
  return doc.fields.isPublic?.booleanValue === true && (!type || type === 'public')
}
export function decodeChannelPost(doc: FirestoreDocument, channelId: string, scope: 'public' | 'member', uid: string): ChannelPostText {
  const id = childId(doc.name, `${documents}/channels/${channelId}/posts`), f = doc.fields
  const visibility = stringField(f, 'visibility', 32)
  if (stringField(f, 'channelId', 160) !== channelId || !(visibility === 'public' || (scope === 'member' && visibility === 'subscribers')) || !f.createdAt?.timestampValue) throw new Error('Invalid post scope')
  identifier(stringField(f, 'authorId', 160))
  const counter = (key: string): number | null => {
    if (f[key] === undefined) return null
    if (f[key].integerValue === undefined && f[key].doubleValue === undefined) throw new Error('Invalid counter type')
    const value = numberField(f, key)
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid counter')
    return value
  }
  let hasMedia = false
  if (f.mediaKeys !== undefined && f.mediaKeys.nullValue === undefined) {
    if (!f.mediaKeys.arrayValue || typeof f.mediaKeys.arrayValue !== 'object') throw new Error('Invalid media metadata')
    const values = (f.mediaKeys.arrayValue as { values?: unknown }).values
    if (values !== undefined && !Array.isArray(values)) throw new Error('Invalid media metadata')
    hasMedia = Array.isArray(values) && values.length > 0
  }
  const media = channelPostMedia(doc, channelId)
  const likes = channelPostLikeState(doc, uid).info
  return { removalEligible: postRemovalContentEligible(doc), pinFlag: channelPostPinFlag(doc), own: stringField(f, 'authorId', 160) === uid, editableText: editablePostText(doc), likes, visibility: visibility as 'public' | 'subscribers', id, revision: channelPostRevision(doc), mediaCount: media.count, media: media.items.map(({ path: _path, videoPath: _videoPath, ...item }) => item), position: timestamp(f.createdAt.timestampValue, id), text: stringField(f, 'text', 100000), hasMedia,
    pinned: f.isPinned?.booleanValue === true, likeCount: likes.storedCount, commentCount: counter('commentCount') }
}

type PostScope = 'public' | 'member'
interface PostPolicy { channel: FirestoreDocument; admin: FirestoreDocument | undefined; ownerId: string; subscriber: boolean; administrator: boolean; publicChannel: boolean }
// A post shows its first few pictures in the channel, and only the posts now listed hold any.
const maxPostPictures = 4, maxWantedPictures = 40

export class ChannelPosts {
  readonly visibilityEditor: ChannelPostVisibilityEditor
  readonly removalEditor: ChannelPostRemovalEditor
  readonly pinResolutionEditor: ChannelPostPinResolutionEditor
  readonly extraPinEditor: ChannelPostExtraPinEditor
  readonly pinEditor: ChannelPostPinEditor
  readonly textEditor: ChannelPostTextEditor
  readonly comments: ChannelComments
  readonly likes: ChannelPostLikeEditor
  readonly media: ChannelPostMediaSession
  readonly pictures: ChannelPostPictures
  private rows = new Map<string, FirestoreDocument>()
  private value: ChannelPostsSnapshot | null = null
  private stop: (() => void) | null = null
  private stopPolicy: (() => void) | null = null
  private policy: PostPolicy | null = null
  private reader: FirestoreReader | null = null
  private generation = 0
  private feedGeneration = 0
  constructor(private readonly uid: string, private readonly auth: ReadCredentials,
    private readonly source: (id: string) => { doc: FirestoreDocument; reader: FirestoreReader }, private readonly changed: () => void) { this.visibilityEditor = new ChannelPostVisibilityEditor(uid, auth, (request, exact) => this.visibilitySource(request, exact)); this.removalEditor = new ChannelPostRemovalEditor(uid, auth, (request, exact) => this.removalSource(request, exact)); this.pinResolutionEditor = new ChannelPostPinResolutionEditor(uid, auth, (request, exact) => this.pinResolutionSource(request, exact)); this.extraPinEditor = new ChannelPostExtraPinEditor(uid, auth, (request, exact) => this.extraPinSource(request, exact)); this.pinEditor = new ChannelPostPinEditor(uid, auth, (request, exact) => this.pinSource(request, exact)); this.textEditor = new ChannelPostTextEditor(uid, auth, (request, exact) => this.textSource(request, exact)); this.media = new ChannelPostMediaSession(auth, request => this.mediaSource(request), changed); this.pictures = new ChannelPostPictures(auth, key => this.pictureSource(key), changed, '__channel-post-picture'); this.likes = new ChannelPostLikeEditor(uid, auth, (request, exact) => this.likeSource(request, exact)); this.comments = new ChannelComments(uid, auth, (request, exact) => this.commentSource(request, exact), changed) }
  get snapshot(): ChannelPostsSnapshot | null {
    const value = this.value
    if (!value) return null
    try {
      this.base(value.channelId)
      if (value.status === 'ready') this.validate(value.channelId)
      return { ...value, authoring: value.status === 'ready' && this.policy ? channelPostAuthoring(this.uid, value.channelId, this.base(value.channelId).doc, this.policy.channel, this.policy.admin) : null, pins: value.status === 'ready' ? channelPostPinInfo(this.base(value.channelId).doc, value.posts, this.uid) : null, comments: this.comments.snapshot, media: this.media.snapshot,
        posts: value.posts.map(post => ({ ...post, likes: { ...post.likes }, position: { ...post.position },
          media: post.media.map(item => ({ ...item, picture: this.pictures.snapshot(`${value.channelId}/${post.id}/${item.index}`) })) })) }
    } catch { return { ...value, authoring: null, pins: null, status: 'blocked', scope: null, comments: null, posts: [], media: null, message: tr('현재 게시물 접근 범위를 확인할 수 없습니다. 채널을 다시 열어 주세요.') } }
  }
  private base(id: string): { doc: FirestoreDocument; reader: FirestoreReader } {
    this.auth.signal.throwIfAborted()
    const source = this.source(id)
    if (this.reader && this.reader !== source.reader) throw new Error('Channel read lifetime changed')
    return source
  }
  private scope(id: string): PostScope | null {
    const current = this.base(id), policy = this.policy
    if (!policy) return null
    if ((policy.ownerId === this.uid && stringField(current.doc.fields, 'ownerId', 160) === this.uid) || policy.subscriber || policy.administrator) return 'member'
    return policy.publicChannel && publicChannelPosts(current.doc) ? 'public' : null
  }
  private validate(id: string): PostScope {
    const scope = this.scope(id)
    if (!scope || this.value?.scope !== scope) throw new Error('Post access changed')
    return scope
  }
  // The pictures a post shows in the channel: the same objects an opened post reads, through the same grant.
  private pictureSource(key: string): PictureSource {
    const value = this.value, [channelId, postId, rawIndex] = key.split('/')
    if (!value || value.status !== 'ready' || !channelId || !postId || value.channelId !== channelId) throw new Error('Post picture unavailable')
    const scope = this.validate(channelId), doc = this.rows.get(`${documents}/channels/${channelId}/posts/${postId}`)
    if (!doc) throw new Error('Post picture unavailable')
    decodeChannelPost(doc, channelId, scope, this.uid)
    const item = channelPostMedia(doc, channelId).items[Number(rawIndex)]
    if (!item?.path || item.kind === 'unsupported') throw new Error('Post picture unavailable')
    return { path: item.path, video: item.kind === 'video', postId, blur: item.blur, width: item.width ?? 0, height: item.height ?? 0 }
  }
  // The pictures of the posts now listed, as the feed wants the first picture of each of its posts.
  private wantPictures(): void {
    const value = this.value
    if (!value || value.status !== 'ready') { this.pictures.setWanted([]); return }
    const keys: string[] = []
    for (const post of value.posts) {
      for (const item of post.media.slice(0, maxPostPictures)) if (item.available && item.kind !== 'unsupported') keys.push(`${value.channelId}/${post.id}/${item.index}`)
      if (keys.length >= maxWantedPictures) break
    }
    this.pictures.setWanted(keys.slice(0, maxWantedPictures))
  }
  private mediaSource(request: ChannelPostMediaRequest): string {
    const value = this.value
    if (!value || value.status !== 'ready' || value.requestId !== request.requestId || value.channelId !== request.channelId) throw new Error('Post selection unavailable')
    const scope = this.validate(request.channelId)
    const doc = this.rows.get(`${documents}/channels/${request.channelId}/posts/${request.postId}`)
    if (!doc || channelPostRevision(doc) !== request.revision) throw new Error('Post changed')
    decodeChannelPost(doc, request.channelId, scope, this.uid)
    const item = channelPostMedia(doc, request.channelId).items[request.index]
    const path = request.presentation === 'video' ? item?.videoPath : item?.path
    if (!path) throw new Error('Post media unavailable')
    return path
  }
  commentObservationScope(target: { channelId: string; postId: string }): string {
    this.creationSource(target)
    return JSON.stringify([this.generation, this.feedGeneration, this.value!.requestId, this.value!.scope, target.channelId, target.postId])
  }
  reviewSource(request: PostRemovalTarget): { channel: FirestoreDocument; post: FirestoreDocument } {
    if (this.value?.requestId !== request.requestId || this.value.channelId !== request.channelId || this.value.status !== 'ready') throw new Error(tr('현재 게시물 검토를 다시 열어 주세요.'))
    const channel = this.base(request.channelId).doc, post = this.creationSource(request)
    if (documentVersion(channel) !== request.channelVersion || channelPostRevision(post) !== request.revision || stringField(post.fields, 'authorId', 160) !== this.uid) throw new Error(tr('검토한 본인 게시물 또는 채널이 변경되었습니다.'))
    return { channel, post }
  }
  postObservationScope(channelId: string, doc?: FirestoreDocument | null): string {
    if (this.value?.channelId !== channelId || this.value.status !== 'ready') throw new Error(tr('현재 채널 게시물을 먼저 불러와 주세요.'))
    const scope = this.validate(channelId)
    if (doc) {
      // Never disclose even a comparison outside the currently readable visibility scope.
      const visibility = doc.fields.visibility?.stringValue
      if (visibility !== 'public' && !(scope === 'member' && visibility === 'subscribers')) throw new Error(tr('현재 게시물의 공개 범위를 확인할 수 없습니다.'))
    }
    return JSON.stringify([this.generation, this.feedGeneration, this.value.requestId, channelId, scope])
  }
  authoringSource(channelId: string): PostCreationSource {
    if (this.value?.channelId !== channelId || this.value.status !== 'ready' || !this.policy) throw new Error(tr('현재 채널 게시물을 먼저 불러와 주세요.'))
    this.validate(channelId)
    const channel = this.base(channelId).doc, info = channelPostAuthoring(this.uid, channelId, channel, this.policy.channel, this.policy.admin)
    if (!info || info.permission !== 'allowed') throw new Error(tr('현재 글 작성 권한을 확인할 수 없습니다.'))
    return { channel, admin: this.policy.admin }
  }
  shareSource(request: ChannelShareRequest): void {
    if (!request.post || this.value?.requestId !== request.requestId) throw new Error(tr('현재 게시물 목록에서 공유 대상을 다시 선택해 주세요.'))
    const post = this.creationSource({ channelId: request.channelId, postId: request.post.id })
    decodeChannelPost(post, request.channelId, 'public', this.uid)
    if (channelPostRevision(post) !== request.post.revision) throw new Error(tr('현재 공개 게시물이 변경되었습니다. 공유 내용을 다시 확인해 주세요.'))
  }
  creationSource(target: { channelId: string; postId: string }): FirestoreDocument {
    const value = this.value
    if (!value || value.status !== 'ready' || value.channelId !== target.channelId) throw new Error(tr('현재 게시물을 다시 불러와 주세요.'))
    const scope = this.validate(target.channelId), doc = this.rows.get(`${documents}/channels/${target.channelId}/posts/${target.postId}`)
    if (!doc) throw new Error(tr('현재 게시물을 찾을 수 없습니다.'))
    decodeChannelPost(doc, target.channelId, scope, this.uid)
    return doc
  }
  private commentSource(request: ChannelCommentsRequest, exact: boolean): { reader: FirestoreReader; post: FirestoreDocument } {
    const value = this.value
    if (!value || value.status !== 'ready' || value.requestId !== request.requestId || value.channelId !== request.channelId) throw new Error('Post selection unavailable')
    const scope = this.validate(request.channelId), doc = this.rows.get(`${documents}/channels/${request.channelId}/posts/${request.postId}`)
    if (!doc || (exact && channelPostRevision(doc) !== request.revision)) throw new Error('Post changed')
    decodeChannelPost(doc, request.channelId, scope, this.uid)
    return { reader: this.base(request.channelId).reader, post: doc }
  }
  private visibilitySource(request: PostVisibilityRequest, exact: boolean): PostVisibilitySource {
    if (this.value?.requestId !== request.requestId || this.value.channelId !== request.channelId || this.value.status !== 'ready') throw new Error(tr('현재 채널 게시물을 다시 확인해 주세요.'))
    const channel = this.base(request.channelId).doc, post = this.creationSource(request)
    if (stringField(channel.fields, 'ownerId', 160) !== this.uid || stringField(post.fields, 'authorId', 160) !== this.uid) throw new Error(tr('현재 채널 소유자·게시물 작성자를 확인해 주세요.'))
    const source = { channel, post }
    if (exact) validatePostVisibility(this.uid, request, source)
    return source
  }
  private removalSource(request: PostRemovalTarget, exact: boolean): PostRemovalSource {
    if (this.value?.channelId !== request.channelId || this.value.requestId !== request.requestId || this.value.status !== 'ready') throw new Error(tr('현재 채널 게시물을 확인해 주세요.'))
    this.validate(request.channelId)
    const channel = this.base(request.channelId).doc, post = this.rows.get(`${documents}/channels/${request.channelId}/posts/${request.postId}`) ?? null
    if (stringField(channel.fields, 'ownerId', 160) !== this.uid || (post && stringField(post.fields, 'authorId', 160) !== this.uid)) throw new Error(tr('현재 채널 소유자·게시물 작성자를 확인해 주세요.'))
    const source = { channel, post }
    if (exact) validatePostRemoval(this.uid, request, source)
    return source
  }
  private pinResolutionSource(request: ChannelPostPinResolution, exact: boolean): PinResolutionWriteSource {
    const value = this.value
    if (!value || value.status !== 'ready' || value.requestId !== request.requestId || value.channelId !== request.channelId) throw new Error(tr('현재 게시물 목록을 다시 확인해 주세요.'))
    const channel = this.base(request.channelId).doc, post = this.creationSource(request)
    if (stringField(channel.fields, 'ownerId', 160) !== this.uid || stringField(post.fields, 'authorId', 160) !== this.uid) throw new Error(tr('채널 소유자와 게시물 작성자 조건을 확인할 수 없습니다.'))
    if (exact) {
      const reference = channelPinReference(channel)
      if (documentVersion(channel) !== request.channelVersion || reference.status !== 'known' || reference.postId !== request.postId || channelPostRevision(post) !== request.revision || editablePostText(post) === null || channelPostPinFlag(post) !== 'unpinned') throw new Error(tr('현재 채널 지정 대상과 꺼진 고정 표시가 변경되었습니다.'))
    }
    return { channel, post }
  }
  private extraPinSource(request: ChannelPostExtraPinRequest, exact: boolean): ExtraPinWriteSource {
    const value = this.value
    if (!value || value.status !== 'ready' || value.requestId !== request.requestId || value.channelId !== request.channelId) throw new Error(tr('현재 게시물 목록을 다시 확인해 주세요.'))
    const channel = this.base(request.channelId).doc, post = this.creationSource(request)
    if (stringField(channel.fields, 'ownerId', 160) !== this.uid || stringField(post.fields, 'authorId', 160) !== this.uid) throw new Error(tr('채널 소유자와 게시물 작성자 조건을 확인할 수 없습니다.'))
    if (exact) {
      const reference = channelPinReference(channel)
      if (documentVersion(channel) !== request.channelVersion || reference.status === 'unknown' || reference.postId !== request.referenceId || reference.source !== request.referenceSource || reference.postId === request.postId || channelPostRevision(post) !== request.revision || editablePostText(post) === null || channelPostPinFlag(post) !== 'pinned') throw new Error(tr('현재 채널 대상과 게시물 고정 표시가 변경되었습니다.'))
    }
    return { channel, post }
  }
  private pinSource(request: ChannelPostPinEdit, exact: boolean): ChannelPinWriteSource {
    const value = this.value
    if (!value || value.status !== 'ready' || value.requestId !== request.requestId || value.channelId !== request.channelId) throw new Error(tr('현재 게시물 목록을 다시 확인해 주세요.'))
    this.validate(request.channelId)
    const channel = this.base(request.channelId).doc
    if (stringField(channel.fields, 'ownerId', 160) !== this.uid) throw new Error(tr('현재 채널 소유자만 고정 정보를 변경할 수 있습니다.'))
    const previous = request.previous ? this.creationSource({ channelId: request.channelId, postId: request.previous.postId }) : null
    const next = request.next ? this.creationSource({ channelId: request.channelId, postId: request.next.postId }) : null
    for (const post of [previous, next]) if (post && stringField(post.fields, 'authorId', 160) !== this.uid) throw new Error(tr('변경 대상 게시물의 작성자 조건을 확인할 수 없습니다.'))
    if (exact) {
      const info = channelPostPinInfo(channel, value.posts, this.uid)
      if (info.comparison !== 'compatible' || documentVersion(channel) !== request.channelVersion || info.reference.postId !== (request.previous?.postId ?? null)) throw new Error(tr('현재 고정 정보가 변경되었거나 일치하지 않습니다.'))
      for (const which of ['previous', 'next'] as const) {
        const post = which === 'previous' ? previous : next, expected = request[which]
        if (expected && (!post || channelPostRevision(post) !== expected.revision || editablePostText(post) === null || channelPostPinFlag(post) !== (which === 'previous' ? 'pinned' : 'unpinned'))) throw new Error(tr('고정 대상 게시물이 변경되었습니다.'))
      }
    }
    return { channel, previous, next }
  }
  private textSource(request: ChannelPostTextEdit, exact: boolean): FirestoreDocument {
    const value = this.value
    if (!value || value.status !== 'ready' || value.requestId !== request.requestId || value.channelId !== request.channelId) throw new Error(tr('현재 게시물 선택을 확인해 주세요.'))
    const doc = this.creationSource(request)
    if (stringField(doc.fields, 'authorId', 160) !== this.uid || (exact && (channelPostRevision(doc) !== request.revision || editablePostText(doc) !== request.original))) throw new Error(tr('게시물 본문이나 작성자 정보가 변경되었습니다.'))
    return doc
  }
  // The uids in a loaded post's likedBy, for its likers list.
  likerUids(channelId: string, postId: string): string[] | null {
    const value = this.value
    if (!value || value.status !== 'ready' || value.channelId !== channelId) return null
    const doc = this.rows.get(`${documents}/channels/${channelId}/posts/${postId}`)
    return doc ? channelPostLikeState(doc, this.uid).members : null
  }
  private likeSource(request: ChannelPostLikeRequest, exact: boolean): FirestoreDocument {
    const value = this.value
    if (!value || value.status !== 'ready' || value.requestId !== request.requestId || value.channelId !== request.channelId) throw new Error('Post selection unavailable')
    const scope = this.validate(request.channelId), doc = this.rows.get(`${documents}/channels/${request.channelId}/posts/${request.postId}`)
    if (!doc || (exact && channelPostRevision(doc) !== request.revision)) throw new Error('Post changed')
    const post = decodeChannelPost(doc, request.channelId, scope, this.uid)
    if (exact && (post.likes.status !== 'ready' || post.likes.selected !== request.selected || post.likes.count !== request.count)) throw new Error('Like state changed')
    return doc
  }
  private clearFeed(): void {
    this.likes.pause(); this.textEditor.pause(); this.pinEditor.pause(); this.extraPinEditor.pause(); this.pinResolutionEditor.pause(); this.removalEditor.pause(); this.visibilityEditor.pause(); this.comments.clear()
    this.feedGeneration++; this.stop?.(); this.stop = null; this.rows.clear(); this.media.clear()
    if (this.value) { this.value.authoring = null; this.value.posts = []; this.value.media = null; this.value.comments = null; this.value.scope = null }
  }
  private startFeed(): void {
    const request = this.value
    if (!request) return
    const source = this.base(request.channelId), scope = this.scope(request.channelId)
    if (scope && this.stop && request.scope === scope) { this.media.prune(); this.likes.prune(); this.textEditor.prune(); this.pinEditor.prune(); this.extraPinEditor.prune(); this.pinResolutionEditor.prune(); this.removalEditor.prune(); this.visibilityEditor.prune(); this.comments.prune(); return }
    this.clearFeed()
    if (!scope) { request.status = 'blocked'; request.message = tr('현재 역할이나 채널 공개 범위로는 게시물을 표시할 수 없습니다.'); return }
    request.scope = scope; request.status = 'loading'; request.message = tr('확인된 접근 범위의 게시물을 불러오고 있습니다.')
    const generation = this.generation, feedGeneration = this.feedGeneration
    const current = () => generation === this.generation && feedGeneration === this.feedGeneration && this.value === request
    // Explicit known visibility values retain the existing bounded index/query model.
    // Missing or future visibility values never become a permissive fallback.
    const filter = scope === 'public' ? { op: 'EQUAL', value: { stringValue: 'public' } } :
      { op: 'IN', value: { arrayValue: { values: [{ stringValue: 'public' }, { stringValue: 'subscribers' }] } } }
    this.stop = source.reader.watch({ query: { parent: `${documents}/channels/${request.channelId}`, structuredQuery: {
      from: [{ collectionId: 'posts' }], where: { fieldFilter: { field: { fieldPath: 'visibility' }, ...filter } }, limit: { value: 501 }
    } } }, this.auth.signal, {
      snapshot: rows => {
        if (!current()) return
        try {
          this.validate(request.channelId)
          if (rows.size > 500) { this.rows.clear(); this.media.clear(); this.likes.pause(); this.textEditor.pause(); this.pinEditor.pause(); this.extraPinEditor.pause(); this.pinResolutionEditor.pause(); this.removalEditor.pause(); this.visibilityEditor.pause(); this.comments.clear(); request.status = 'limit'; request.posts = []; request.message = tr('조회 가능한 게시물이 500개를 넘습니다. 일부 결과를 최신 목록으로 표시하지 않습니다.') }
          else { request.posts = [...rows.values()].map(doc => decodeChannelPost(doc, request.channelId, scope, this.uid)).sort((a, b) => comparePosition(b.position, a.position)); this.rows = new Map(rows); request.status = 'ready'; request.message = ''; this.wantPictures(); this.media.prune(); this.likes.prune(); this.textEditor.prune(); this.pinEditor.prune(); this.extraPinEditor.prune(); this.pinResolutionEditor.prune(); this.removalEditor.prune(); this.visibilityEditor.prune(); this.comments.prune() }
        } catch { this.rows.clear(); this.media.clear(); this.likes.pause(); this.textEditor.pause(); this.pinEditor.pause(); this.extraPinEditor.pause(); this.pinResolutionEditor.pause(); this.removalEditor.pause(); this.visibilityEditor.pause(); this.comments.clear(); request.posts = []; request.status = 'error'; request.message = tr('게시물의 접근 범위 또는 데이터를 확인하지 못했습니다. 다시 불러와 주세요.') }
        this.changed()
      },
      state: (state, error) => {
        if (!current() || state === 'ready') return
        this.rows.clear(); this.media.clear(); this.likes.pause(); this.textEditor.pause(); this.pinEditor.pause(); this.extraPinEditor.pause(); this.pinResolutionEditor.pause(); this.removalEditor.pause(); this.visibilityEditor.pause(); this.comments.clear(); request.posts = []; request.status = state
        request.message = state === 'loading' ? tr('게시물 연결을 확인하고 있습니다.') : error?.code === 'index' ? tr('게시물 조회에 필요한 서버 인덱스를 확인해야 합니다.') : tr('게시물을 읽지 못했습니다. 연결·권한을 확인한 뒤 다시 불러와 주세요.')
        this.changed()
      }
    }, 501, 8 * 1024 * 1024)
  }
  open(request: ChannelPostsRequest): void {
    this.clear()
    this.likes.open(request.requestId); this.textEditor.open(request.requestId); this.pinEditor.open(request.requestId); this.extraPinEditor.open(request.requestId); this.pinResolutionEditor.open(request.requestId); this.removalEditor.open(request.requestId); this.visibilityEditor.open(request.requestId)
    this.value = { ...request, authoring: null, pins: null, comments: null, scope: null, status: 'loading', posts: [], media: null, message: tr('게시물 접근 범위를 확인하고 있습니다.') }
    let source: ReturnType<ChannelPosts['base']>
    try { source = this.base(request.channelId); this.reader = source.reader }
    catch { this.value.status = 'blocked'; this.value.message = tr('현재 내 채널 목록에서 채널을 확인해 주세요.'); this.changed(); return }
    const root = `${documents}/channels/${request.channelId}`, sub = `${root}/subscribers/${this.uid}`, admin = `${root}/admins/${this.uid}`
    const names = [root, sub, admin], generation = this.generation
    const current = () => generation === this.generation && this.value?.requestId === request.requestId
    this.stopPolicy = source.reader.watch({ documents: { documents: names } }, this.auth.signal, {
      snapshot: rows => {
        if (!current() || !this.value) return
        try {
          this.base(request.channelId)
          if (rows.size > 3 || [...rows].some(([name, doc]) => !names.includes(name) || name !== doc.name)) throw new Error('Unexpected post policy scope')
          const channel = rows.get(root), subscriber = rows.get(sub)
          if (!channel || (subscriber?.fields.uid !== undefined && stringField(subscriber.fields, 'uid', 160) !== this.uid)) throw new Error('Post policy identity conflict')
          this.policy = { channel, admin: rows.get(admin), ownerId: identifier(stringField(channel.fields, 'ownerId', 160)), subscriber: rows.has(sub), administrator: rows.has(admin), publicChannel: publicChannelPosts(channel) }
          this.startFeed()
        } catch { this.policy = null; this.clearFeed(); this.value.status = 'error'; this.value.message = tr('현재 채널과 본인의 게시물 접근 범위를 확인하지 못했습니다.') }
        this.changed()
      },
      state: state => {
        if (!current() || !this.value || state === 'ready') return
        this.policy = null; this.clearFeed(); this.value.status = state
        this.value.message = state === 'loading' ? tr('게시물 접근 범위를 다시 확인하고 있습니다.') : tr('게시물 접근 범위를 읽지 못했습니다. 연결과 권한을 확인해 주세요.')
        this.changed()
      }
    }, 3, 1024 * 1024)
    this.changed()
  }
  prune(): void {
    if (!this.value) return
    try { this.base(this.value.channelId); if (this.policy) this.startFeed(); this.media.prune() }
    catch {
      const request = this.value; this.clear()
      this.value = { requestId: request.requestId, channelId: request.channelId, authoring: null, pins: null, comments: null, scope: null, status: 'blocked', posts: [], media: null, message: tr('채널 접근 정보가 변경되었습니다. 게시물을 다시 열어 주세요.') }
    }
  }
  dismiss(requestId: string): void { if (this.value?.requestId === requestId) { this.clear(); this.changed() } }
  clear(): void { if (this.value) { this.likes.dismiss(this.value.requestId); this.textEditor.dismiss(this.value.requestId); this.pinEditor.dismiss(this.value.requestId); this.extraPinEditor.dismiss(this.value.requestId); this.pinResolutionEditor.dismiss(this.value.requestId); this.removalEditor.dismiss(this.value.requestId); this.visibilityEditor.dismiss(this.value.requestId) }; this.clearFeed(); this.generation++; this.stopPolicy?.(); this.stopPolicy = null; this.policy = null; this.reader = null; this.value = null }
}
