// Portions of this file follow Telegram Desktop (https://github.com/telegramdesktop/tdesktop, 7.2.8, 272f6f5c),
// Copyright (c) 2014-2026 The Telegram Desktop Authors. Licensed under GPL-3.0-or-later; see LEGAL.
import type { CommentDraftTarget, CommentReplyTarget } from '../../shared/channel-comment-drafts'
import { channelPostRevision } from '../media/channel-post-media-document'
import type { ChannelCommentsRequest, ChannelCommentsSnapshot, ChannelCommentItem } from '../../shared/channel-comments'
import { comparePosition, type MessagePosition } from '../../shared/model'
import { identifier } from '../../shared/validation'
import type { FirestoreReader, ReadCredentials } from '../network/firestore-rpc'
import { childId, documents, numberField, stringField, timestamp, type FirestoreDocument } from '../network/firestore-values'
import type { PeoplePhotoResolver } from './channel-people-photos'
import { PeerProfiles } from './peer-profiles'
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
// Comments of a post as last received, kept for this session: a pane opened again, also while the connection is down,
// shows them at once and the first answer replaces them, as Telegram Desktop keeps a thread's loaded replies in memory
// while it reads them again. The most recent `limit` posts are kept; a lock forgets them.
export class ReceivedComments {
  private readonly posts = new Map<string, Map<string, FirestoreDocument>>()
  constructor(private readonly limit = 20) {}
  get(channelId: string, postId: string): Map<string, FirestoreDocument> | null {
    const key = `${channelId}/${postId}`, rows = this.posts.get(key)
    if (!rows) return null
    this.posts.delete(key); this.posts.set(key, rows)
    return rows
  }
  put(channelId: string, postId: string, rows: Map<string, FirestoreDocument>): void {
    const key = `${channelId}/${postId}`
    this.posts.delete(key); this.posts.set(key, new Map(rows))
    for (const oldest of this.posts.keys()) { if (this.posts.size <= this.limit) break; this.posts.delete(oldest) }
  }
  drop(channelId: string, postId: string): void { this.posts.delete(`${channelId}/${postId}`) }
  forget(): void { this.posts.clear() }
}
export class ChannelComments {
  // Photos of the people listed, from the photo address this record keeps (see ChannelPeoplePhotos).
  people: PeoplePhotoResolver | null = null
  private photos = new Map<string, string>()
  private rows = new Map<string, FirestoreDocument>()
  private value: ChannelCommentsSnapshot | null = null
  private reader: FirestoreReader | null = null
  private stop: (() => void) | null = null
  private generation = 0
  private readonly received = new ReceivedComments()
  // A8 §4 (Telegram R-41): a comment shows its author as they are now — the name and picture of their public profile
  // (publicProfiles/{authorId}, A7), read five people a target. The name and picture the comment was written with
  // stand in while that is unknown (not made yet, refused); a deleted account shows as one. The comment keeps them as
  // written: older builds show those, and Android compares them.
  private readonly authors: PeerProfiles
  constructor(private readonly uid: string, private readonly auth: ReadCredentials,
    private readonly source: (request: ChannelCommentsRequest, exact: boolean) => { reader: FirestoreReader; post: FirestoreDocument }, private readonly changed: () => void) {
    this.authors = new PeerProfiles(uid, auth, auth.signal, () => { if (this.value) this.changed() }, undefined, 'authors')
  }
  private author(uid: string, written: string): string { return this.authors.withdrawn(uid) ? tr('탈퇴한 계정') : this.authors.name(uid) || written }
  private authorPhoto(item: ChannelCommentItem): string | null {
    if (this.authors.withdrawn(item.authorId)) return null
    const known = this.authors.profile(item.authorId)
    return known ? known.photo || null : this.photos.get(item.id) ?? null
  }
  forget(): void { this.received.forget() }
  private validate(request: ChannelCommentsRequest, exact = false): { reader: FirestoreReader; post: FirestoreDocument } {
    this.auth.signal.throwIfAborted()
    const source = this.source(request, exact), reader = source.reader
    if (this.reader && this.reader !== reader) throw new Error('Comment read lifetime changed')
    return source
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
    try {
      this.validate(this.value)
      const byId = new Map(this.value.items.map(item => [item.id, item]))
      return { ...this.value, items: this.value.items.map(item => {
        const parent = item.parentId ? byId.get(item.parentId) : undefined
        return { ...item, authorName: this.author(item.authorId, item.authorName),
          parentAuthorName: parent && item.parentAuthorName ? this.author(parent.authorId, item.parentAuthorName) : item.parentAuthorName,
          photo: this.people?.(item.authorId, this.authorPhoto(item)) ?? null, position: item.position ? { ...item.position } : null }
      }) }
    }
    catch { return { ...this.value, status: 'blocked', items: [], message: tr('현재 게시물의 댓글 접근 범위를 확인할 수 없습니다.') } }
  }
  open(request: ChannelCommentsRequest): void {
    this.clear(); this.value = { ...request, status: 'loading', items: [], message: tr('댓글을 불러오는 중…') }
    let reader: FirestoreReader
    try { reader = this.validate(request, true).reader; this.reader = reader }
    catch { this.value.status = 'blocked'; this.value.message = tr('현재 읽을 수 있는 최신 게시물에서 댓글을 다시 열어 주세요.'); this.changed(); return }
    const generation = this.generation, current = () => generation === this.generation && this.value?.selectionId === request.selectionId
    const show = (rows: Map<string, FirestoreDocument>): void => {
      const items = decodeChannelComments(rows.values(), request, this.uid)
      this.photos = commentPhotoSources(rows.values())
      this.rows = new Map(rows); this.value!.items = items; this.value!.status = 'ready'; this.value!.message = ''; this.value!.waiting = false
      this.authors.bind(this.reader, new Set(items.map(item => item.authorId)))
    }
    // What this post's comments were when last received stays on screen until the first answer replaces it.
    let earlier = false
    const kept = this.received.get(request.channelId, request.postId)
    if (kept) { try { show(kept); earlier = true } catch { this.rows.clear(); this.value.items = []; this.value.status = 'loading'; this.received.drop(request.channelId, request.postId) } }
    // No orderBy: missing dates remain observable instead of disappearing from the query.
    this.stop = reader.watch({ query: { parent: `${documents}/channels/${request.channelId}/posts/${request.postId}`, structuredQuery: { from: [{ collectionId: 'comments' }], limit: { value: 101 } } } }, this.auth.signal, {
      snapshot: rows => {
        if (!current() || !this.value) return
        earlier = false
        try {
          this.validate(request)
          if (rows.size > 100) { this.rows.clear(); this.received.drop(request.channelId, request.postId); this.value.items = []; this.value.status = 'limit'; this.value.waiting = false; this.value.message = tr('댓글이 100개를 넘습니다. 일부 결과를 전체 댓글로 표시하지 않습니다.') }
          else { show(rows); this.received.put(request.channelId, request.postId, rows) }
        } catch { this.rows.clear(); this.received.drop(request.channelId, request.postId); this.value.items = []; this.value.status = 'error'; this.value.waiting = false; this.value.message = tr('댓글의 게시물 소속 또는 내용을 확인하지 못했습니다. 다시 조회해 주세요.') }
        this.changed()
      },
      // A post's comments stay on screen while their watch reconnects (Telegram keeps a thread's replies).
      reconnecting: () => {},
      // Before the first answer, a try that could not reach the server means the pane waits for the connection: it says
      // so, and comments received earlier stay on screen meanwhile.
      state: (state, error) => {
        if (!current() || !this.value || state === 'ready') return
        if (state === 'loading' && earlier) { if (error && !this.value.waiting) { this.value.waiting = true; this.changed() }; return }
        this.rows.clear(); this.value.items = []; this.value.status = state; this.value.waiting = state === 'loading' && Boolean(error)
        this.value.message = state === 'loading' ? error ? tr('연결되면 댓글을 불러옵니다.') : tr('댓글 연결을 다시 확인하고 있습니다.') : tr('댓글을 읽지 못했습니다. 현재 게시물과 연결을 확인해 주세요.'); this.changed()
      }
    }, 101, 2 * 1024 * 1024)
    this.changed()
  }
  prune(): void {
    if (!this.value) return
    try { this.validate(this.value); }
    catch { const request = this.value; this.clear(); this.value = { ...request, status: 'blocked', items: [], message: tr('게시물이나 읽기 범위가 변경되었습니다. 댓글을 다시 열어 주세요.') } }
  }
  dismiss(selectionId: string): void { if (this.value?.selectionId === selectionId) { this.clear(); this.changed() } }
  clear(): void { if (this.value) this.rows.clear(); this.generation++; this.stop?.(); this.stop = null; this.reader = null; this.value = null; this.authors.clear() }
}
