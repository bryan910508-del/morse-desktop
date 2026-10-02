import { channelPostRevision } from '../media/channel-post-media-document'
import type { CommentDraftTarget, CommentReplyTarget } from '../../shared/channel-comment-drafts'
import type { FirestoreDocument } from '../network/firestore-values'
import type { ChannelCommentsRequest, ChannelCommentsSnapshot } from '../../shared/channel-comments'
import type { FirestoreReader, ReadCredentials } from '../network/firestore-rpc'
import { documents, stringField, numberField } from '../network/firestore-values'
import { channelCommentReplyName, commentPhotoSources, decodeChannelComments, ReceivedComments } from './channel-comments'
import type { PeoplePhotoResolver } from './channel-people-photos'
import { tr } from '../../shared/i18n'
// Public reads and explicit own-comment removal share the current parent lifetime.
export class PublicChannelComments {
  // Photos of the people listed, from the photo address this record keeps (see ChannelPeoplePhotos).
  people: PeoplePhotoResolver | null = null
  private photos = new Map<string, string>()
  private rows = new Map<string, FirestoreDocument>()
  private value: ChannelCommentsSnapshot | null = null
  private reader: FirestoreReader | null = null
  private stop: (() => void) | null = null
  private generation = 0
  private readonly received = new ReceivedComments()
  constructor(private readonly uid: string, private readonly auth: ReadCredentials,
    private readonly source: (request: ChannelCommentsRequest, exact: boolean) => { reader: FirestoreReader; post: FirestoreDocument }, private readonly changed: () => void) { }
  forget(): void { this.received.forget() }
  private validate(request: ChannelCommentsRequest, exact = false): { reader: FirestoreReader; post: FirestoreDocument } {
    this.auth.signal.throwIfAborted()
    const source = this.source(request, exact), reader = source.reader
    if (this.reader && this.reader !== reader) throw new Error('Public comments lifetime changed')
    return source
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
    this.clear();
    this.value = { ...request, status: 'loading', items: [], message: tr('공개 게시물의 댓글을 불러오는 중…') }
    let reader: FirestoreReader
    try { reader = this.validate(request, true).reader; this.reader = reader }
    catch { this.value.status = 'blocked'; this.value.message = tr('현재 공개 게시물에서 댓글을 다시 선택해 주세요.'); this.changed(); return }
    const generation = this.generation, current = (): boolean => generation === this.generation && this.value?.selectionId === request.selectionId
    const show = (rows: Map<string, FirestoreDocument>): void => {
      this.value!.items = decodeChannelComments(rows.values(), request, this.uid); this.photos = commentPhotoSources(rows.values()); this.rows = new Map(rows)
      this.value!.status = 'ready'; this.value!.message = ''; this.value!.waiting = false
    }
    // As ChannelComments: the comments last received for this post stay on screen until the first answer.
    let earlier = false
    const kept = this.received.get(request.channelId, request.postId)
    if (kept) { try { show(kept); earlier = true } catch { this.rows.clear(); this.value.items = []; this.value.status = 'loading'; this.received.drop(request.channelId, request.postId) } }
    this.stop = reader.watch({ query: { parent: `${documents}/channels/${request.channelId}/posts/${request.postId}`, structuredQuery: { from: [{ collectionId: 'comments' }], limit: { value: 101 } } } }, this.auth.signal, {
      snapshot: rows => {
        if (!current() || !this.value) return
        earlier = false
        try {
          this.validate(request)
          if (rows.size > 100) { this.rows.clear(); this.received.drop(request.channelId, request.postId); this.value.items = []; this.value.status = 'limit'; this.value.waiting = false; this.value.message = tr('댓글이 100개를 넘습니다. 일부 목록을 전체처럼 표시하지 않습니다.') }
          else { show(rows); this.received.put(request.channelId, request.postId, rows) }
        } catch { this.rows.clear(); this.received.drop(request.channelId, request.postId); this.value.items = []; this.value.status = 'error'; this.value.waiting = false; this.value.message = tr('댓글의 현재 부모 게시물·소속·내용을 확인하지 못했습니다.') }
        this.changed()
      },
      // The comments stay on screen while their watch reconnects.
      reconnecting: () => {},
      state: (state, error) => {
        if (!current() || !this.value || state === 'ready') return
        if (state === 'loading' && earlier) { if (error && !this.value.waiting) { this.value.waiting = true; this.changed() }; return }
        this.rows.clear(); this.value.items = []; this.value.status = state; this.value.waiting = state === 'loading' && Boolean(error)
        this.value.message = state === 'loading' ? error ? tr('연결되면 댓글을 불러옵니다.') : tr('댓글 연결을 확인하고 있습니다.') : tr('현재 댓글을 읽지 못했습니다. 공개 게시물과 연결을 다시 확인해 주세요.'); this.changed()
      }
    }, 101, 2 * 1024 * 1024)
    this.changed()
  }
  prune(): void { if (!this.value) return; try { this.validate(this.value); } catch { this.clear() } }
  dismiss(selectionId: string): void { if (this.value?.selectionId === selectionId) { this.clear(); this.changed() } }
  async close(): Promise<void> { this.clear(); }
  clear(): void { if (this.value) this.rows.clear(); this.generation++; this.stop?.(); this.stop = null; this.reader = null; this.value = null }
}
