import type { CommentDraftTarget, CommentReplyTarget } from '../../shared/channel-comment-drafts'
import { ChannelCommentRemovalEditor } from './channel-comment-removal'
import type { ChannelCommentRemoval } from '../../shared/channel-comment-removal'
import type { CommentRemovalSource } from '../network/channel-comment-removal-write'
import { channelPostRevision } from '../media/channel-post-media-document'
import type { ChannelCommentsRequest, ChannelCommentsSnapshot, ChannelCommentItem } from '../../shared/channel-comments'
import { comparePosition, type MessagePosition } from '../../shared/model'
import { identifier } from '../../shared/validation'
import type { FirestoreReader, ReadCredentials } from '../network/firestore-rpc'
import { childId, documents, numberField, stringField, timestamp, type FirestoreDocument } from '../network/firestore-values'
import type { PeoplePhotoResolver } from './channel-people-photos'
import { tr } from '../../shared/i18n'
function decode(doc: FirestoreDocument, request: ChannelCommentsRequest, uid: string): ChannelCommentItem {
  const id = childId(doc.name, `${documents}/channels/${request.channelId}/posts/${request.postId}/comments`), f = doc.fields
  if (stringField(f, 'channelId', 160) !== request.channelId || stringField(f, 'postId', 160) !== request.postId || typeof f.text?.stringValue !== 'string' || f.text.stringValue.length > 1000) throw new Error('Comment identity or text invalid')
  const authorId = identifier(stringField(f, 'authorId', 160))
  let position: MessagePosition | null = null
  try { if (f.createdAt?.timestampValue) position = timestamp(f.createdAt.timestampValue, id) } catch { /* Retain the row with an explicitly unknown date. */ }
  let parentId: string | null = null, parent: ChannelCommentItem['parent'] = 'none'
  if (f.parentCommentId !== undefined && f.parentCommentId.nullValue === undefined && f.parentCommentId.stringValue !== '') {
    try { parentId = identifier(f.parentCommentId.stringValue); parent = parentId === id ? 'invalid' : 'unavailable' }
    catch { parent = 'invalid' }
  }
  return { revision: channelPostRevision(doc), id, authorId, authorName: stringField(f, 'authorName', 512).trim() || tr('이름 정보 없음'), own: authorId === uid, text: f.text.stringValue, position, parent, parentId, parentAuthorName: stringField(f, 'parentAuthorName', 512).trim() }
}
// Comment id -> the author photo address the comment keeps (authorPhotoURL).
export function commentPhotoSources(docs: Iterable<FirestoreDocument>): Map<string, string> {
  const photos = new Map<string, string>()
  for (const doc of docs) { try { const photo = stringField(doc.fields, 'authorPhotoURL', 10000); if (photo) photos.set(doc.name.slice(doc.name.lastIndexOf('/') + 1), photo) } catch { /* No photo. */ } }
  return photos
}
export function decodeChannelComments(docs: Iterable<FirestoreDocument>, request: ChannelCommentsRequest, uid: string): ChannelCommentItem[] {
  const items = [...docs].map(doc => decode(doc, request, uid)), byId = new Map(items.map(item => [item.id, item]))
  for (const item of items) if (item.parent === 'unavailable' && item.parentId) {
    const parent = byId.get(item.parentId)
    if (parent) item.parent = parent.parent === 'none' ? 'present' : 'invalid'
  }
  items.sort((a, b) => a.position && b.position ? comparePosition(a.position, b.position) : a.position ? -1 : b.position ? 1 : a.id.localeCompare(b.id))
  return items
}
export function channelCommentReplyName(doc: FirestoreDocument | undefined, request: ChannelCommentsRequest, uid: string, parent: CommentReplyTarget): string {
  if (!doc || channelPostRevision(doc) !== parent.revision || decode(doc, request, uid).parent !== 'none') throw new Error(tr('현재 목록에서 원댓글을 확인할 수 없습니다.'))
  const name = doc.fields.authorName?.stringValue
  if (typeof name !== 'string' || !name.trim() || name.length > 512) throw new Error(tr('원댓글에 저장된 작성자 이름을 확인할 수 없습니다.'))
  return name
}
export class ChannelComments {
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
    if (this.reader && this.reader !== reader) throw new Error('Comment read lifetime changed')
    return source
  }
  private removalSource(request: ChannelCommentRemoval, exact: boolean): CommentRemovalSource {
    const value = this.value, source = this.validate(request, exact)
    if (!value || value.status !== 'ready' || value.selectionId !== request.selectionId || value.requestId !== request.requestId || value.channelId !== request.channelId || value.postId !== request.postId) throw new Error('Current comment selection unavailable')
    const comment = this.rows.get(`${documents}/channels/${request.channelId}/posts/${request.postId}/comments/${request.commentId}`) ?? null
    if (exact && (!comment || channelPostRevision(comment) !== request.commentRevision || stringField(comment.fields, 'authorId', 160) !== this.uid || comment.fields.text?.stringValue !== request.text || value.items.length !== request.count || numberField(source.post.fields, 'commentCount') !== request.count)) throw new Error('Comment or count changed')
    return { post: source.post, comment }
  }
  replySource(target: CommentDraftTarget, parent: CommentReplyTarget): string {
    const value = this.value
    if (!value || value.status !== 'ready' || value.channelId !== target.channelId || value.postId !== target.postId) throw new Error(tr('현재 게시물의 댓글 목록을 다시 읽어 주세요.'))
    this.validate(value)
    const doc = this.rows.get(`${documents}/channels/${target.channelId}/posts/${target.postId}/comments/${parent.id}`)
    return channelCommentReplyName(doc, value, this.uid, parent)
  }
  get snapshot(): ChannelCommentsSnapshot | null {
    if (!this.value) return null
    try { this.validate(this.value); return { ...this.value, items: this.value.items.map(item => ({ ...item, photo: this.people?.(item.authorId, this.photos.get(item.id) ?? null) ?? null, position: item.position ? { ...item.position } : null })) } }
    catch { return { ...this.value, status: 'blocked', items: [], message: tr('현재 게시물의 댓글 접근 범위를 확인할 수 없습니다.') } }
  }
  open(request: ChannelCommentsRequest): void {
    this.clear(); this.removal.open(request.selectionId); this.value = { ...request, status: 'loading', items: [], message: tr('댓글을 불러오는 중…') }
    let reader: FirestoreReader
    try { reader = this.validate(request, true).reader; this.reader = reader }
    catch { this.value.status = 'blocked'; this.value.message = tr('현재 읽을 수 있는 최신 게시물에서 댓글을 다시 열어 주세요.'); this.changed(); return }
    const generation = this.generation, current = () => generation === this.generation && this.value?.selectionId === request.selectionId
    // No orderBy: missing dates remain observable instead of disappearing from the query.
    this.stop = reader.watch({ query: { parent: `${documents}/channels/${request.channelId}/posts/${request.postId}`, structuredQuery: { from: [{ collectionId: 'comments' }], limit: { value: 101 } } } }, this.auth.signal, {
      snapshot: rows => {
        if (!current() || !this.value) return
        try {
          this.validate(request)
          if (rows.size > 100) { this.rows.clear(); this.removal.pause(); this.value.items = []; this.value.status = 'limit'; this.value.message = tr('댓글이 100개를 넘습니다. 일부 결과를 전체 댓글로 표시하지 않습니다.') }
          else {
            const items = decodeChannelComments(rows.values(), request, this.uid)
            this.photos = commentPhotoSources(rows.values())
            this.rows = new Map(rows); this.value.items = items; this.value.status = 'ready'; this.value.message = ''; this.removal.prune()
          }
        } catch { this.rows.clear(); this.removal.pause(); this.value.items = []; this.value.status = 'error'; this.value.message = tr('댓글의 게시물 소속 또는 내용을 확인하지 못했습니다. 다시 조회해 주세요.') }
        this.changed()
      },
      state: state => { if (!current() || !this.value || state === 'ready') return; this.rows.clear(); this.removal.pause(); this.value.items = []; this.value.status = state; this.value.message = state === 'loading' ? tr('댓글 연결을 다시 확인하고 있습니다.') : tr('댓글을 읽지 못했습니다. 현재 게시물과 연결을 확인해 주세요.'); this.changed() }
    }, 101, 2 * 1024 * 1024)
    this.changed()
  }
  prune(): void {
    if (!this.value) return
    try { this.validate(this.value); this.removal.prune() }
    catch { const request = this.value; this.clear(); this.value = { ...request, status: 'blocked', items: [], message: tr('게시물이나 읽기 범위가 변경되었습니다. 댓글을 다시 열어 주세요.') } }
  }
  dismiss(selectionId: string): void { if (this.value?.selectionId === selectionId) { this.clear(); this.changed() } }
  clear(): void { if (this.value) this.removal.dismiss(this.value.selectionId); this.rows.clear(); this.removal.pause(); this.generation++; this.stop?.(); this.stop = null; this.reader = null; this.value = null }
}
