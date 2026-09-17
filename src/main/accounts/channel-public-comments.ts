import { ChannelCommentRemovalEditor } from './channel-comment-removal'
import type { ChannelCommentRemoval } from '../../shared/channel-comment-removal'
import type { CommentRemovalSource } from '../network/channel-comment-removal-write'
import { channelPostRevision } from '../media/channel-post-media-document'
import type { CommentDraftTarget, CommentReplyTarget } from '../../shared/channel-comment-drafts'
import type { FirestoreDocument } from '../network/firestore-values'
import type { ChannelCommentsRequest, ChannelCommentsSnapshot } from '../../shared/channel-comments'
import type { FirestoreReader, ReadCredentials } from '../network/firestore-rpc'
import { documents, stringField, numberField } from '../network/firestore-values'
import { channelCommentReplyName, commentPhotoSources, decodeChannelComments } from './channel-comments'
import type { PeoplePhotoResolver } from './channel-people-photos'
import { tr } from '../../shared/i18n'
// Public reads and explicit own-comment removal share the current parent lifetime.
export class PublicChannelComments {
  // Photos of the people listed, from the photo address this record keeps (see ChannelPeoplePhotos).
  people: PeoplePhotoResolver | null = null
  private photos = new Map<string, string>()
  readonly removal: ChannelCommentRemovalEditor
  private rows = new Map<string, FirestoreDocument>()
  private value: ChannelCommentsSnapshot | null = null
  private reader: FirestoreReader | null = null
  private stop: (() => void) | null = null
  private generation = 0
  constructor(private readonly uid: string, private readonly auth: ReadCredentials,
    private readonly source: (request: ChannelCommentsRequest, exact: boolean) => { reader: FirestoreReader; post: FirestoreDocument }, private readonly changed: () => void) { this.removal = new ChannelCommentRemovalEditor(uid, auth, (request, exact) => this.removalSource(request, exact)) }
  private validate(request: ChannelCommentsRequest, exact = false): { reader: FirestoreReader; post: FirestoreDocument } {
    this.auth.signal.throwIfAborted()
    const source = this.source(request, exact), reader = source.reader
    if (this.reader && this.reader !== reader) throw new Error('Public comments lifetime changed')
    return source
  }
  private removalSource(request: ChannelCommentRemoval, exact: boolean): CommentRemovalSource {
    const value = this.value, source = this.validate(request, exact)
    if (!value || value.status !== 'ready' || value.selectionId !== request.selectionId || value.requestId !== request.requestId || value.channelId !== request.channelId || value.postId !== request.postId) throw new Error(tr('현재 공개 댓글 선택을 확인해 주세요.'))
    const comment = this.rows.get(`${documents}/channels/${request.channelId}/posts/${request.postId}/comments/${request.commentId}`) ?? null
    if (exact && (!comment || channelPostRevision(comment) !== request.commentRevision || stringField(comment.fields, 'authorId', 160) !== this.uid || comment.fields.text?.stringValue !== request.text || value.items.length !== request.count || numberField(source.post.fields, 'commentCount') !== request.count)) throw new Error(tr('현재 공개 댓글 또는 집계가 변경되었습니다.'))
    return { post: source.post, comment }
  }
  replySource(target: CommentDraftTarget, parent: CommentReplyTarget): string {
    const value = this.value
    if (!value || value.status !== 'ready' || value.channelId !== target.channelId || value.postId !== target.postId) throw new Error(tr('현재 공개 게시물의 댓글 목록을 다시 읽어 주세요.'))
    this.validate(value)
    const doc = this.rows.get(`${documents}/channels/${target.channelId}/posts/${target.postId}/comments/${parent.id}`)
    return channelCommentReplyName(doc, value, this.uid, parent)
  }
  get snapshot(): ChannelCommentsSnapshot | null {
    if (!this.value) return null
    try { this.validate(this.value); return { ...this.value, items: this.value.items.map(item => ({ ...item, photo: this.people?.(item.authorId, this.photos.get(item.id) ?? null) ?? null, position: item.position ? { ...item.position } : null })) } }
    catch { return { ...this.value, status: 'blocked', items: [], message: tr('현재 공개 게시물의 댓글 접근을 확인할 수 없습니다.') } }
  }
  open(request: ChannelCommentsRequest): void {
    this.clear(); this.removal.open(request.selectionId)
    this.value = { ...request, status: 'loading', items: [], message: tr('공개 게시물의 댓글을 불러오는 중…') }
    let reader: FirestoreReader
    try { reader = this.validate(request, true).reader; this.reader = reader }
    catch { this.value.status = 'blocked'; this.value.message = tr('현재 공개 게시물에서 댓글을 다시 선택해 주세요.'); this.changed(); return }
    const generation = this.generation, current = (): boolean => generation === this.generation && this.value?.selectionId === request.selectionId
    this.stop = reader.watch({ query: { parent: `${documents}/channels/${request.channelId}/posts/${request.postId}`, structuredQuery: { from: [{ collectionId: 'comments' }], limit: { value: 101 } } } }, this.auth.signal, {
      snapshot: rows => {
        if (!current() || !this.value) return
        try {
          this.validate(request)
          if (rows.size > 100) { this.rows.clear(); this.removal.pause(); this.value.items = []; this.value.status = 'limit'; this.value.message = tr('댓글이 100개를 넘습니다. 일부 목록을 전체처럼 표시하지 않습니다.') }
          else { this.value.items = decodeChannelComments(rows.values(), request, this.uid); this.photos = commentPhotoSources(rows.values()); this.rows = new Map(rows); this.value.status = 'ready'; this.value.message = ''; this.removal.prune() }
        } catch { this.rows.clear(); this.removal.pause(); this.value.items = []; this.value.status = 'error'; this.value.message = tr('댓글의 현재 부모 게시물·소속·내용을 확인하지 못했습니다.') }
        this.changed()
      },
      state: state => {
        if (!current() || !this.value || state === 'ready') return
        this.rows.clear(); this.removal.pause(); this.value.items = []; this.value.status = state; this.value.message = state === 'loading' ? tr('댓글 연결을 확인하고 있습니다.') : tr('현재 댓글을 읽지 못했습니다. 공개 게시물과 연결을 다시 확인해 주세요.'); this.changed()
      }
    }, 101, 2 * 1024 * 1024)
    this.changed()
  }
  prune(): void { if (!this.value) return; try { this.validate(this.value); this.removal.prune() } catch { this.clear() } }
  dismiss(selectionId: string): void { if (this.value?.selectionId === selectionId) { this.clear(); this.changed() } }
  async close(): Promise<void> { this.clear(); await this.removal.close() }
  clear(): void { if (this.value) this.removal.dismiss(this.value.selectionId); this.removal.pause(); this.rows.clear(); this.generation++; this.stop?.(); this.stop = null; this.reader = null; this.value = null }
}
