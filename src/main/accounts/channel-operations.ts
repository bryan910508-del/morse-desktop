// Portions of this file follow Telegram Desktop (https://github.com/telegramdesktop/tdesktop, 7.2.8, 272f6f5c),
// Copyright (c) 2014-2026 The Telegram Desktop Authors. Licensed under GPL-3.0-or-later; see LEGAL.
import { channelOperationTarget, type ChannelOperationItem, type ChannelOperationRequest } from '../../shared/channel-operations'
import { channelPostLikeRequest, type ChannelPostLikeRequest } from '../../shared/channel-post-like'
import { channelPostTextEdit, type ChannelPostTextEdit } from '../../shared/channel-post-text-edit'
import { channelCommentRemoval, type ChannelCommentRemoval } from '../../shared/channel-comment-removal'
import type { PostRemovalTarget } from '../../shared/channel-post-removal'
import type { ChannelOperationCommand, StoredChannelOperation } from '../storage/channel-operation-table'
import { DeliveryCommandFailure } from '../storage/delivery-client'
import { FirestoreReader, type ReadCredentials } from '../network/firestore-rpc'
import { documents, documentVersion, numberField, stringField, type FirestoreDocument } from '../network/firestore-values'
import { channelPostRevision } from '../media/channel-post-media-document'
import { channelPostLikeState } from './channel-post-like-state'
import { editablePostText } from '../network/channel-post-text-write'
import { validatePostRemoval, type PostRemovalSource } from '../network/channel-post-removal-write'
import type { CommentRemovalSource } from '../network/channel-comment-removal-write'
import { channelDeleteRole } from './channel-delete-authority'
import { recordConnectionStep, recordRetry } from '../platform/connection-diagnostics'
import { status } from '@grpc/grpc-js'
import { tr } from '../../shared/i18n'

// Changes to channel posts and comments — a like, new words, a post or a comment deleted — carried out the way Android
// Q88 does (user decision 2026-09-29): the device keeps each until the server shows it. Before every send the server's
// copy is read; one that already shows the result is done (a like already on, the words already there, the post or
// comment already gone), so a request whose answer was lost is never applied twice, and one that was not applied goes
// again under its id, by itself, after a wait that grows to a minute or at once when the network comes back
// (network/reachability.ts). A like or new words for a post whose post is gone end quietly, and the screens drop what
// they showed for them. What the server refuses is kept as failed for the screens to report; words keep their text.
// A newer like or newer words for the same post replace the ones still waiting. One post's changes go in order; a
// change waiting to be sent again never holds another post's.
export function channelOperationRetryDelay(attempt: number): number { return Math.min(60000, 1000 * 2 ** Math.max(0, attempt - 1)) }
// A change the server has confirmed stays for the screens this long (as 'settled'), not only until the write answers:
// their copies of the post come from the server's stream a moment later (0.3 s measured), and until then they still
// show it as before — the heart back to ♡, the deleted post back. Telegram applies the answer's own updates the moment
// it arrives (tdesktop Reactions::send, EditMessage, Histories::deleteMessages), so the confirmed state is never
// followed by the old one. A like's heart and new words give way as soon as the copy shows them (shared
// channel-operations.ts); the time bounds only how long a later change from elsewhere could be hidden behind them.
export const channelOperationSettleMs = 10000
// A try that takes longer than this is written to the connection log (connection-check.log) as one line — which change,
// how it ended, how long the try and the whole change took — and nothing about the account, channel or post. A try is
// normally 0.1–0.6 s (measured 2026-09-30); 3.6–5.2 s was seen once and could not be made again.
export const channelOperationSlowMs = 2000
export function recordSlowChannelOperation(kind: string, outcome: string, tryMs: number, totalMs: number): void {
  recordConnectionStep('channel-op-slow', `${kind} ${outcome} try=${(tryMs / 1000).toFixed(1)}s total=${(totalMs / 1000).toFixed(1)}s`)
}

export interface ChannelOperationSession {
  read(path: string, signal: AbortSignal): Promise<FirestoreDocument | null>
  like(request: ChannelPostLikeRequest, doc: FirestoreDocument, signal: AbortSignal): Promise<void>
  text(request: ChannelPostTextEdit, post: FirestoreDocument, signal: AbortSignal): Promise<void>
  removePost(request: PostRemovalTarget, source: PostRemovalSource, signal: AbortSignal): Promise<void>
  removeComment(request: ChannelCommentRemoval, source: CommentRemovalSource, signal: AbortSignal): Promise<void>
  close(): void
}
type Outcome = 'done' | 'gone' | 'race' | { refused: string } | { again: unknown }
// Statuses that say the post moved under the write (someone else liked it, edited it, a count changed): read it again
// and decide again, at once. The write was conditioned on the version it read, so it did not apply.
const races = new Set<number>([status.FAILED_PRECONDITION, status.ABORTED, status.ALREADY_EXISTS, status.NOT_FOUND])
// Statuses that are the server saying no to this account.
const refusals = new Set<number>([status.PERMISSION_DENIED, status.INVALID_ARGUMENT])

export class ChannelOperations {
  private rows: StoredChannelOperation[] = []
  private loaded = false
  private closed = false
  private failed = false
  private busy: string | null = null
  private task: Promise<void> | null = null
  private rerun = false
  private generation = new AbortController()
  private readonly retries = new Map<string, { attempt: number; at: number }>()
  private wake: ReturnType<typeof setTimeout> | null = null
  private stage = 'read'
  // Confirmed changes for the screens, kept in memory only: after a restart the copies are read afresh.
  private confirmed: { item: ChannelOperationItem; target: string; until: number }[] = []
  private expiry: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly uid: string, auth: ReadCredentials, private readonly allowed: () => void,
    private readonly store: <T>(command: ChannelOperationCommand) => Promise<T>, private readonly changed: () => void,
    // A change that is over (done, gone or refused), for a screen that keeps its own copy of the post to read it again.
    private readonly settled: (request: ChannelOperationRequest) => void = () => {},
    private readonly open: () => ChannelOperationSession = () => readerSession(uid, auth),
    private readonly settleMs = channelOperationSettleMs,
    private readonly slow: (kind: string, outcome: string, tryMs: number, totalMs: number) => void = recordSlowChannelOperation) {}

  async load(): Promise<void> {
    try { this.rows = await this.store<StoredChannelOperation[]>({ kind: 'channel-operation-list' }); this.loaded = true }
    catch { this.failed = true }
    this.publish(); this.kick()
  }
  items(): ChannelOperationItem[] {
    return [...this.rows.map(row => item(row.request, row.state === 'failed' ? 'failed' : 'pending', row.reason, row.createdAt)), ...this.confirmed.map(entry => entry.item)]
  }
  async enqueue(request: ChannelOperationRequest): Promise<'queued'> {
    if (this.closed || this.failed) throw new Error(tr('계정이 변경되었습니다.'))
    if (!this.loaded) await this.load()
    const target = channelOperationTarget(request)
    // A newer like or newer words replace the ones for the same post that are still waiting (not the one on its way).
    const replaces = request.kind === 'post-like' || request.kind === 'post-text'
      ? this.rows.filter(row => row.request.kind === request.kind && row.target === target && row.request.id !== this.busy).map(row => row.request.id) : []
    try { await this.store({ kind: 'channel-operation-put', request, target, replaces, createdAt: Date.now() }) }
    catch (error) {
      if (error instanceof DeliveryCommandFailure && error.code === 'capacity') throw new Error(tr('처리 중인 채널 작업이 너무 많습니다. 잠시 뒤 다시 시도해 주세요.'))
      throw error
    }
    for (const id of replaces) this.retries.delete(id)
    // The newer choice is what the screens draw now, not the one confirmed before it.
    this.confirmed = this.confirmed.filter(entry => entry.target !== target)
    await this.reload(); this.publish(); this.kick()
    return 'queued'
  }
  // A refused change the person asks to try again, as it is.
  async retry(id: string): Promise<void> {
    if (!this.rows.some(row => row.request.id === id && row.state === 'failed')) return
    await this.store({ kind: 'channel-operation-state', id, state: 'queued', reason: '' })
    this.retries.delete(id)
    await this.reload(); this.publish(); this.kick()
  }
  // A refused change the person lets go (or a screen has reported): the screens show the server's copy again.
  async discard(id: string): Promise<void> {
    if (this.confirmed.some(entry => entry.item.id === id)) { this.confirmed = this.confirmed.filter(entry => entry.item.id !== id); this.publish(); return }
    if (this.busy === id) throw new Error(tr('진행 중인 작업이 끝난 뒤 다시 시도해 주세요.'))
    await this.store({ kind: 'channel-operation-remove', id })
    this.retries.delete(id)
    await this.reload(); this.publish()
  }
  pause(): void {
    this.generation.abort(); this.generation = new AbortController()
    this.retries.clear(); this.unschedule(); this.publish()
  }
  resume(): void { this.kick() }
  // The network is back (reachability.ts): what waits goes now, its waits started over.
  retryNow(): void { this.retries.clear(); this.unschedule(); this.kick() }
  async close(): Promise<void> {
    this.closed = true; this.pause()
    this.confirmed = []; if (this.expiry) { clearTimeout(this.expiry); this.expiry = null }
    await this.task?.catch(() => {})
  }

  private publish(): void { if (!this.closed) this.changed() }
  private async reload(): Promise<void> { this.rows = await this.store<StoredChannelOperation[]>({ kind: 'channel-operation-list' }) }
  private unschedule(): void { if (this.wake) { clearTimeout(this.wake); this.wake = null } }
  private confirm(request: ChannelOperationRequest, createdAt: number): void {
    const target = channelOperationTarget(request)
    this.confirmed = [...this.confirmed.filter(entry => entry.target !== target), { item: item(request, 'settled', '', createdAt), target, until: Date.now() + this.settleMs }]
    this.expire()
  }
  private expire(): void {
    if (this.expiry) { clearTimeout(this.expiry); this.expiry = null }
    const now = Date.now(), kept = this.confirmed.filter(entry => entry.until > now)
    if (kept.length !== this.confirmed.length) { this.confirmed = kept; this.publish() }
    if (kept.length && !this.closed) this.expiry = setTimeout(() => this.expire(), Math.max(50, Math.min(...kept.map(entry => entry.until)) - now))
  }
  private connected(): boolean { try { this.allowed(); return true } catch { return false } }
  private active(signal: AbortSignal): boolean { return !this.closed && !this.failed && !signal.aborted && this.connected() }
  private kick(): void {
    if (!this.loaded || !this.active(this.generation.signal)) return
    if (this.task) { this.rerun = true; return }
    const task = this.drain(this.generation.signal)
    this.task = task
    void task.catch(() => {}).finally(() => {
      if (this.task !== task) return
      this.task = null; this.busy = null; this.publish()
      if (this.rerun) { this.rerun = false; this.kick() }
    })
  }
  // The next change that may go: the first waiting one of each post, unless that post's first is still waiting out a retry.
  private next(now: number): StoredChannelOperation | null {
    const held = new Set<string>()
    for (const row of this.rows) {
      if (row.state !== 'queued') continue
      const post = `${row.request.channelId}/${row.request.postId}`
      if (held.has(post)) continue
      if ((this.retries.get(row.request.id)?.at ?? 0) > now) { held.add(post); continue }
      return row
    }
    return null
  }
  private schedule(now: number): void {
    const due = this.rows.filter(row => row.state === 'queued').map(row => this.retries.get(row.request.id)?.at ?? 0).filter(at => at > now)
    this.unschedule()
    if (due.length) this.wake = setTimeout(() => { this.wake = null; this.kick() }, Math.max(50, Math.min(...due) - now))
  }
  private async drain(signal: AbortSignal): Promise<void> {
    while (this.active(signal)) {
      const row = this.next(Date.now())
      if (!row) { this.schedule(Date.now()); return }
      this.busy = row.request.id; this.publish()
      await this.attempt(row.request, row.createdAt, signal)
      this.busy = null
      await this.reload()
      this.publish()
    }
  }
  private async attempt(request: ChannelOperationRequest, createdAt: number, signal: AbortSignal): Promise<void> {
    let outcome: Outcome
    const started = Date.now()
    try { outcome = await this.perform(request, signal) }
    catch (error) { outcome = { again: error } }
    const took = Date.now() - started
    if (took > channelOperationSlowMs) this.slow(request.kind, typeof outcome === 'string' ? outcome : 'refused' in outcome ? 'refused' : 'again', took, Date.now() - createdAt)
    if (!this.active(signal)) return
    if (outcome === 'done' || outcome === 'gone') {
      await this.store({ kind: 'channel-operation-remove', id: request.id })
      // Done: the screens keep drawing it until their copies show it. Gone: the post is gone, nothing to draw.
      if (outcome === 'done') this.confirm(request, createdAt)
      this.retries.delete(request.id); this.settled(request)
    } else if (typeof outcome === 'object' && 'refused' in outcome) {
      await this.store({ kind: 'channel-operation-state', id: request.id, state: 'failed', reason: outcome.refused })
      this.retries.delete(request.id); this.settled(request)
    } else {
      const attempt = (this.retries.get(request.id)?.attempt ?? 0) + 1
      recordRetry(`channel-${request.kind}`, this.stage, outcome === 'race' ? { delivery: 'answered', code: 'race' } : outcome.again, channelOperationRetryDelay(attempt))
      this.retries.set(request.id, { attempt, at: Date.now() + channelOperationRetryDelay(attempt) })
    }
  }
  // A post that moved under the write is read again and decided again at once, a few times; then it waits like any retry.
  private async perform(request: ChannelOperationRequest, signal: AbortSignal): Promise<Outcome> {
    const session = this.open()
    try {
      for (let race = 0; ; race++) {
        const outcome = await this.once(request, session, signal)
        if (outcome !== 'race' || race >= 3) return outcome
      }
    } finally { session.close() }
  }
  // This account's admin document in a channel it does not own (A1 §3-5), read with the channel; none for the owner.
  private async admin(session: ChannelOperationSession, channel: FirestoreDocument, signal: AbortSignal): Promise<FirestoreDocument | undefined> {
    if (stringField(channel.fields, 'ownerId', 160) === this.uid) return undefined
    return await session.read(`${channel.name}/admins/${this.uid}`, signal) ?? undefined
  }
  private async once(request: ChannelOperationRequest, session: ChannelOperationSession, signal: AbortSignal): Promise<Outcome> {
    const channelPath = `${documents}/channels/${request.channelId}`, postPath = `${channelPath}/posts/${request.postId}`
    this.stage = 'read'
    switch (request.kind) {
      case 'post-like': {
        const doc = await session.read(postPath, signal)
        if (!doc) return 'gone'
        const { info } = channelPostLikeState(doc, this.uid)
        if (info.status !== 'ready' || info.selected === null || info.count === null) return { refused: info.message || tr('좋아요 상태를 확인하지 못했습니다.') }
        if (info.selected === request.liked) return 'done'
        let like: ChannelPostLikeRequest
        try { like = channelPostLikeRequest({ id: request.id, requestId: request.id, channelId: request.channelId, postId: request.postId, revision: channelPostRevision(doc), selected: info.selected, count: info.count, desired: request.liked }) }
        catch (error) { return { refused: error instanceof Error ? error.message : tr('좋아요를 변경하지 못했습니다.') } }
        this.stage = 'commit'
        try { await session.like(like, doc, signal); return 'done' } catch (error) { return judge(error) }
      }
      case 'post-text': {
        const post = await session.read(postPath, signal)
        if (!post) return 'gone'
        const current = editablePostText(post)
        if (stringField(post.fields, 'authorId', 160) !== this.uid || current === null) return { refused: tr('본인이 쓴 글의 본문만 고칠 수 있습니다.') }
        if (current === request.text) return 'done'
        // Words someone else wrote since the edit began are not written over; the typed text is kept for another try.
        if (current !== request.original) return { refused: tr('다른 곳에서 본문이 바뀌어 수정을 반영하지 않았습니다. 입력한 글은 남아 있습니다.') }
        let edit: ChannelPostTextEdit
        try { edit = channelPostTextEdit({ id: request.id, requestId: request.id, channelId: request.channelId, postId: request.postId, revision: channelPostRevision(post), original: current, text: request.text }) }
        catch (error) { return { refused: error instanceof Error ? error.message : tr('본문을 저장하지 못했습니다.') } }
        this.stage = 'commit'
        try { await session.text(edit, post, signal); return 'done' } catch (error) { return judge(error) }
      }
      case 'post-delete': {
        const post = await session.read(postPath, signal)
        if (!post) return 'done'
        const channel = await session.read(channelPath, signal)
        if (!channel) return 'done'
        const admin = await this.admin(session, channel, signal)
        const target: PostRemovalTarget = { id: request.id, requestId: request.id, channelId: request.channelId, channelVersion: documentVersion(channel), postId: request.postId, revision: channelPostRevision(post) }
        try { validatePostRemoval(this.uid, target, { channel, post, admin }) }
        catch { return { refused: tr('이 게시물을 삭제할 권한이 없습니다.') } }
        this.stage = 'commit'
        try { await session.removePost(target, { channel, post, admin }, signal); return 'done' } catch (error) { return judge(error) }
      }
      case 'comment-delete': {
        const comment = await session.read(`${postPath}/comments/${request.commentId}`, signal)
        if (!comment) return 'done'
        const post = await session.read(postPath, signal)
        if (!post) return 'done'
        // A1 §3-5: an author their own comment; the owner or a canDeleteMessages admin anyone's.
        let moderator = false
        if (stringField(comment.fields, 'authorId', 160) !== this.uid) {
          const channel = await session.read(channelPath, signal)
          moderator = Boolean(channel) && ['owner', 'moderator'].includes(channelDeleteRole(this.uid, channel!, await this.admin(session, channel!, signal), ''))
          if (!moderator) return { refused: tr('이 댓글을 삭제할 권한이 없습니다.') }
        }
        let removal: ChannelCommentRemoval
        try {
          removal = channelCommentRemoval({ id: request.id, selectionId: request.id, requestId: request.id, channelId: request.channelId, postId: request.postId, revision: channelPostRevision(post),
            commentId: request.commentId, commentRevision: channelPostRevision(comment), text: comment.fields.text?.stringValue ?? '', count: numberField(post.fields, 'commentCount') })
        } catch { return { refused: tr('댓글 집계를 확인하지 못해 삭제하지 않았습니다. 게시물을 다시 열어 주세요.') } }
        this.stage = 'commit'
        try { await session.removeComment(removal, { post, comment, moderator }, signal); return 'done' } catch (error) { return judge(error) }
      }
    }
  }
}

function item(request: ChannelOperationRequest, state: ChannelOperationItem['state'], reason: string, createdAt: number): ChannelOperationItem {
  return { id: request.id, kind: request.kind, channelId: request.channelId, postId: request.postId, commentId: request.kind === 'comment-delete' ? request.commentId : null,
    liked: request.kind === 'post-like' ? request.liked : null, text: request.kind === 'post-text' ? request.text : null, state, reason, createdAt }
}

// A failed write: its result may be unknown (look again), the post moved under it (decide again), or the server said no.
// A write that failed before it was sent (its proof or token could not be had) carries no status and goes again too.
function judge(error: unknown): Outcome {
  const failure = error as { uncertain?: boolean; code?: number }
  if (failure?.uncertain) return { again: error }
  if (typeof failure?.code === 'number' && races.has(failure.code)) return 'race'
  if (typeof failure?.code === 'number' && refusals.has(failure.code)) return { refused: error instanceof Error ? error.message : tr('서버가 이 변경을 받지 않았습니다.') }
  return { again: error }
}

// One reader per attempt: the read and the write that follows it share a connection.
function readerSession(uid: string, auth: ReadCredentials): ChannelOperationSession {
  const reader = new FirestoreReader(auth)
  return {
    read: (path, signal) => reader.getDocument(path, signal),
    like: (request, doc, signal) => reader.setChannelPostLike(uid, request, signal, () => doc),
    text: (request, post, signal) => reader.saveChannelPostText(uid, request, signal, () => post),
    removePost: (request, source, signal) => reader.removeChannelPost(uid, request, signal, () => source),
    removeComment: (request, source, signal) => reader.removeChannelComment(uid, request, signal, () => source),
    close: () => reader.close()
  }
}
