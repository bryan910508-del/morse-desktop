import { observeCommentCreation } from './channel-comment-observation'
import type { CommentCreationObservation } from '../../shared/channel-comment-creation'
import type { CommentReplyTarget } from '../../shared/channel-comment-drafts'
import { documents, ReadFailure, stringField } from '../network/firestore-values'
import { commentCreationRequest, type CommentCreationPrepare, type CommentCreationRequest, type CommentCreationSnapshot, type PendingCommentCreation, type CommentCreationAction } from '../../shared/channel-comment-creation'
import type { CommentCreationCommand } from '../storage/channel-comment-creation-table'
import { FirestoreReader, type ReadCredentials } from '../network/firestore-rpc'
import { ChannelCommentCreationFailure, commentCreationCount } from '../network/channel-comment-creation-write'
import type { FirestoreDocument } from '../network/firestore-values'
import { channelPostRevision } from '../media/channel-post-media-document'
import { postRetryDelay } from './channel-post-creation'
import { tr } from '../../shared/i18n'
import { recordConnectionStep, recordRetry } from '../platform/connection-diagnostics'

// As a post (channel-post-creation.ts): a comment on its way goes again by itself — what never left when the connection
// is back, and one whose outcome is unknown is looked for and sent again under the same id if it is not there (the
// write creates the comment only while its id is free, so it cannot be posted twice). Before it goes again it is
// brought up to date with the post: the count it raises and the post revision that count is checked against move with
// every like and comment, so an old one would only be refused.
type Attempt = 'confirmed' | 'rejected' | 'retry' | 'check' | 'retired'
const request = (pending: PendingCommentCreation): CommentCreationRequest => { const { state: _state, ...value } = pending; return value }

export class ChannelCommentCreation {
  private closed = false
  private job: Promise<void> | null = null
  private abort: AbortController | null = null
  private observation: { scope: string; value: CommentCreationObservation } | null = null
  private observationTimer: ReturnType<typeof setTimeout> | null = null
  private attempt = 0
  // The step that failed last and why, for connection-check.log.
  private failed: { stage: string; error: unknown } = { stage: '', error: null }
  private wake: ReturnType<typeof setTimeout> | null = null
  private value: CommentCreationSnapshot = { observation: null, canCheck: false, status: 'loading', busy: false, canSend: false, pending: null, message: '' }
  constructor(private readonly uid: string, private readonly auth: ReadCredentials, private readonly allowed: (network: boolean) => void,
    private readonly post: (target: CommentCreationPrepare) => FirestoreDocument,
    private readonly author: () => Pick<CommentCreationRequest, 'authorId' | 'authorName' | 'authorPhotoURL' | 'profileVersion'>,
    private readonly parent: (target: CommentCreationPrepare, parent: CommentReplyTarget) => string,
    private readonly readScope: (target: CommentCreationPrepare) => string,
    private readonly store: <T>(command: CommentCreationCommand, validate: () => void) => Promise<T>, private readonly changed: () => void,
    // The reads and the write, over Firestore; a test gives its own.
    private readonly open: () => Pick<FirestoreReader, 'getDocument' | 'createChannelComment' | 'close'> = () => new FirestoreReader(auth)) {}
  private validate(network = false): void { if (this.closed) throw new Error(tr('계정이 변경되었습니다.')); this.auth.signal.throwIfAborted(); this.allowed(network) }
  private source(request: CommentCreationRequest): FirestoreDocument {
    this.validate(true)
    const post = this.post(request), author = this.author()
    if (channelPostRevision(post) !== request.postRevision || commentCreationCount(post) !== request.count || Object.entries(author).some(([k, v]) => request[k as keyof CommentCreationRequest] !== v)) throw new Error(tr('현재 게시물 또는 작성자 정보가 변경되었습니다.'))
    if (request.parent && this.parent(request, request.parent) !== request.parentAuthorName) throw new Error(tr('현재 원댓글의 작성자 정보가 변경되었습니다.'))
    return post
  }
  get snapshot(): CommentCreationSnapshot {
    let canSend = false
    if (this.value.status === 'ready' && !this.value.busy && this.value.pending?.state === 'prepared') { try { this.source(this.value.pending); canSend = true } catch { /* Explicit dismissal keeps the saved text available. */ } }
    let scope: string | null = null
    if (this.value.status === 'ready' && this.value.pending && ['submitted', 'confirmed'].includes(this.value.pending.state)) {
      try { this.validate(true); scope = this.readScope(this.value.pending) } catch { /* Do not expose an observation beyond current parent access. */ }
    }
    const observation = scope && this.observation?.scope === scope && Date.now() - this.observation.value.observedAt < 30000 ? { ...this.observation.value } : null
    return { ...this.value, observation, canCheck: Boolean(scope) && !this.value.busy, canSend, pending: this.value.pending ? { ...this.value.pending } : null }
  }
  private clearObservation(): void { this.observation = null; if (this.observationTimer) clearTimeout(this.observationTimer); this.observationTimer = null }
  private unschedule(): void { if (this.wake) clearTimeout(this.wake); this.wake = null }
  // The connection went: what is in flight stops, and the comment waits as it is for resume().
  pause(): void { this.abort?.abort(); this.clearObservation(); this.unschedule() }
  // The connection is back: a comment still on its way goes at once.
  resume(): void { this.attempt = 0; this.unschedule(); this.kick() }
  private publish(): void { if (!this.closed) this.changed() }
  private run(operation: (signal: AbortSignal) => Promise<void>): Promise<void> {
    this.validate()
    if (this.job) throw new Error(tr('진행 중인 댓글 등록 기록을 확인해 주세요.'))
    this.clearObservation(); this.unschedule()
    const abort = new AbortController(); this.abort = abort; this.value.busy = true; this.value.message = ''
    const task = Promise.resolve().then(() => operation(abort.signal)).catch(error => {
      this.value.status = 'error'; this.value.message = tr('댓글 등록 기록을 다시 읽어 주세요. 저장 응답이 불확실한 동안 새 등록을 준비하지 않습니다.'); throw error
    }).finally(() => { if (this.job === task) this.job = null; if (this.abort === abort) this.abort = null; this.value.busy = false; this.publish() })
    this.job = task; this.publish(); return task
  }
  refresh(): Promise<void> {
    return this.run(async signal => {
      const validate = (): void => { signal.throwIfAborted(); this.validate() }
      const pending = await this.store<PendingCommentCreation | null>({ kind: 'comment-creation-read' }, validate)
      validate(); this.value.pending = pending; this.value.status = 'ready'
    }).then(() => { this.kick() })
  }
  prepare(input: CommentCreationPrepare): Promise<void> {
    if (this.value.status !== 'ready' || this.value.pending) throw new Error(tr('이전 댓글 등록 기록을 먼저 확인해 주세요.'))
    this.validate(true)
    const post = this.post(input), request = commentCreationRequest({ ...input, ...this.author(), postRevision: channelPostRevision(post), count: commentCreationCount(post), ...(input.parent ? { parentAuthorName: this.parent(input, input.parent) } : {}) })
    return this.run(async signal => {
      const validate = (): void => { signal.throwIfAborted(); this.source(request) }
      this.value.pending = await this.store<PendingCommentCreation>({ kind: 'comment-creation-prepare', request }, validate)
      this.value.status = 'ready'; this.value.message = tr('저장한 초안과 작성자 정보를 고정했습니다. 내용을 확인하고 댓글 등록을 눌러 주세요.')
    })
  }
  action(action: CommentCreationAction): Promise<void> {
    const pending = this.value.pending
    if (this.value.status !== 'ready' || !pending || pending.id !== action.id || pending.state !== action.state || (action.action === 'send' && pending.state !== 'prepared') || (action.action === 'check' && !['submitted', 'confirmed'].includes(pending.state))) throw new Error(tr('최신 댓글 등록 기록을 확인해 주세요.'))
    return this.run(async signal => {
      const validate = (): void => { signal.throwIfAborted(); this.validate() }
      if (action.action === 'check') {
        this.validate(true)
        const scope = this.readScope(pending), reader = new FirestoreReader(this.auth)
        const access = (): void => { validate(); this.validate(true); if (this.readScope(pending) !== scope) throw new Error(tr('댓글 조회 범위가 변경되었습니다.')) }
        try {
          const doc = await reader.getDocument(`${documents}/channels/${pending.channelId}/posts/${pending.postId}/comments/${pending.id}`, signal, access)
          access(); this.observation = { scope, value: observeCommentCreation(pending, doc) }
        } catch {
          try { access(); this.observation = { scope, value: { outcome: 'unavailable', observedAt: Date.now(), message: tr('현재 댓글 문서를 확인하지 못했습니다. 부재·삭제·거절로 판단하지 않습니다. 제출 기록과 초안을 유지합니다.') } } } catch { this.value.message = tr('현재 게시물 접근 범위가 변경되어 조회 결과를 표시하지 않습니다. 제출 기록은 유지합니다.') }
        } finally { reader.close() }
        if (this.observation) this.observationTimer = setTimeout(() => { this.clearObservation(); this.publish() }, 30000)
        return
      }
      if (action.action === 'dismiss') {
        this.value.pending = await this.store<null>({ kind: 'comment-creation-state', id: pending.id, expected: pending.state, state: 'dismissed' }, validate)
        recordConnectionStep('comment-closed', `from ${pending.state}`)
        this.value.message = tr('이 기기의 등록 기록을 닫았습니다. 서버 댓글을 삭제하거나 진행 중인 서버 작업을 취소하지 않습니다.'); return
      }
      this.attempt = 0
      await this.carry(signal, validate)
    }).then(() => { this.kick() })
  }
  private kick(): void {
    const pending = this.value.pending
    if (this.closed || this.job || this.wake || this.value.status !== 'ready' || !pending || !['prepared', 'submitted'].includes(pending.state)) return
    try { this.validate(true) } catch { return } // resume() brings it back with the connection.
    void this.run(async signal => { await this.carry(signal, () => { signal.throwIfAborted(); this.validate() }) }).then(() => { this.kick() }, () => {})
  }
  private later(): void {
    this.attempt += 1
    recordRetry('comment', this.failed.stage, this.failed.error, postRetryDelay(this.attempt))
    this.unschedule()
    this.wake = setTimeout(() => { this.wake = null; this.kick() }, postRetryDelay(this.attempt))
  }
  private async carry(signal: AbortSignal, validate: () => void): Promise<void> {
    let pending = this.value.pending
    if (!pending) return
    if (pending.state === 'submitted') {
      const seen = await this.look(pending, signal)
      if (seen === 'retry') { if (!signal.aborted) this.later(); return }
      if (seen === 'retired') { await this.settle(pending, 'retired', 'look', validate); return }
      if (seen !== 'absent') { await this.settle(pending, seen, 'look', validate); return }
      // The server's own copy has no such comment: the attempt being checked wrote nothing, so it goes again.
      pending = this.value.pending = await this.store<PendingCommentCreation>({ kind: 'comment-creation-state', id: pending.id, expected: 'submitted', state: 'prepared' }, validate)
    }
    const outcome = await this.send(pending, signal, validate)
    if (outcome === 'confirmed' || outcome === 'rejected') { await this.settle(this.value.pending!, outcome, 'send', validate); return }
    // Posted once and deleted since: the job is over, with nothing to report as an error.
    if (outcome === 'retired') { await this.settle(this.value.pending!, 'retired', 'send', validate); return }
    if (!signal.aborted) this.later()
    this.value.message = outcome === 'check' ? tr('댓글 등록 응답을 확인하지 못했습니다. 서버에 없으면 같은 댓글로 다시 보냅니다.') : tr('댓글을 보내지 못했습니다. 연결되면 이어서 등록합니다.')
  }
  // How it ended is written to connection-check.log: a record that closes with no line before it was closed by a person.
  private async settle(pending: PendingCommentCreation, ended: 'confirmed' | 'rejected' | 'retired', after: 'look' | 'send', validate: () => void): Promise<void> {
    const outcome = ended === 'rejected' ? 'rejected' : 'confirmed'
    this.value.pending = await this.store<PendingCommentCreation>({ kind: 'comment-creation-state', id: pending.id, expected: pending.state, state: outcome }, validate)
    recordConnectionStep('comment-ended', `${ended} after ${after}`)
    this.attempt = 0
    this.value.message = ended === 'retired' ? tr('이미 삭제된 댓글이라 다시 올리지 않았습니다.') : (outcome === 'confirmed' ? tr('댓글 생성과 집계 증가 응답을 확인했습니다. 해당 버전의 기기 초안을 비웠습니다.') : tr('등록을 시작하지 못했거나 서버가 거절했습니다. 초안은 유지됩니다. 최신 게시물에서 다시 준비해 주세요.'))
  }
  private async look(pending: PendingCommentCreation, signal: AbortSignal): Promise<'confirmed' | 'rejected' | 'absent' | 'retired' | 'retry'> {
    const reader = this.open()
    try {
      this.validate(true)
      const gate = (): void => { signal.throwIfAborted(); this.validate(true) }
      const doc = await reader.getDocument(`${documents}/channels/${pending.channelId}/posts/${pending.postId}/comments/${pending.id}`, signal, gate)
      if (doc) return stringField(doc.fields, 'authorId', 160) === this.uid ? 'confirmed' : 'rejected'
      // Not there: deleted since (by anyone), or never written. Only the server's deletion record tells them apart.
      return await this.deleted(reader, pending, signal, gate) ? 'retired' : 'absent'
    } catch (error) { this.failed = { stage: 'look', error }; return error instanceof ReadFailure && error.code === 'permission' ? 'rejected' : 'retry' }
    finally { reader.close() }
  }
  // A1 §3-4: the comment's deletion record, or its post's, read from the server (never a cache). A read that fails
  // throws: the comment is then neither sent again nor ended, and is looked at again later.
  private async deleted(reader: Pick<FirestoreReader, 'getDocument'>, pending: PendingCommentCreation, signal: AbortSignal, gate: () => void): Promise<boolean> {
    const root = `${documents}/channels/${pending.channelId}`
    if (await reader.getDocument(`${root}/deletedComments/${pending.id}`, signal, gate)) return true
    return Boolean(await reader.getDocument(`${root}/deletedPosts/${pending.postId}`, signal, gate))
  }
  // The post and the answered comment as they are now: the open post's own copy, or read from the server for a comment
  // that goes on while its post is not on screen.
  private async current(pending: PendingCommentCreation, signal: AbortSignal): Promise<{ post: FirestoreDocument; parentAuthorName?: string }> {
    let post: FirestoreDocument | null = null, parentAuthorName: string | undefined
    try { post = this.post(pending); if (pending.parent) parentAuthorName = this.parent(pending, pending.parent) } catch { post = null; parentAuthorName = undefined }
    if (post && (!pending.parent || parentAuthorName)) return { post, ...(parentAuthorName ? { parentAuthorName } : {}) }
    const reader = this.open(), root = `${documents}/channels/${pending.channelId}/posts/${pending.postId}`, gate = (): void => { signal.throwIfAborted(); this.validate(true) }
    try {
      const read = await reader.getDocument(root, signal, gate)
      if (!read) throw new ChannelCommentCreationFailure('refused')
      if (!pending.parent) return { post: read }
      const answered = await reader.getDocument(`${root}/comments/${pending.parent.id}`, signal, gate)
      const name = answered ? stringField(answered.fields, 'authorName', 512).trim() : ''
      if (!name) throw new ChannelCommentCreationFailure('refused')
      return { post: read, parentAuthorName: name }
    } catch (error) {
      if (error instanceof ReadFailure && error.code === 'permission') throw new ChannelCommentCreationFailure('refused')
      throw error
    } finally { reader.close() }
  }
  private async send(pending: PendingCommentCreation, signal: AbortSignal, validate: () => void): Promise<Attempt> {
    let post: FirestoreDocument
    try {
      this.validate(true)
      const source = await this.current(pending, signal); validate()
      post = source.post
      const fresh = commentCreationRequest({ ...request(pending), ...this.author(), postRevision: channelPostRevision(post), count: commentCreationCount(post),
        ...(pending.parent ? { parentAuthorName: source.parentAuthorName } : {}) })
      if (JSON.stringify(fresh) !== JSON.stringify(request(pending))) pending = this.value.pending = await this.store<PendingCommentCreation>({ kind: 'comment-creation-rebase', id: pending.id, expected: 'prepared', request: fresh }, validate)
    } catch (error) { this.failed = { stage: 'source', error }; return error instanceof ChannelCommentCreationFailure && error.delivery === 'refused' ? 'rejected' : 'retry' }
    this.value.pending = await this.store<PendingCommentCreation>({ kind: 'comment-creation-state', id: pending.id, expected: 'prepared', state: 'submitted' }, validate)
    const reader = this.open()
    try {
      await reader.createChannelComment(this.uid, request(pending), signal, () => { validate(); this.validate(true); return post })
      return 'confirmed'
    } catch (error) {
      this.failed = { stage: 'commit', error }
      const delivery = error instanceof ChannelCommentCreationFailure ? error.delivery : 'unknown'
      // A refusal of a comment deleted elsewhere (its id or its post): over, not failed. The record unread: looked at later.
      if (delivery === 'refused') {
        try { return await this.deleted(reader, pending, signal, () => { signal.throwIfAborted(); this.validate(true) }) ? 'retired' : 'rejected' }
        catch { return 'check' }
      }
      if (delivery === 'unknown') return 'check'
      // It never left: it waits as prepared, not as a result someone has to look for.
      this.value.pending = await this.store<PendingCommentCreation>({ kind: 'comment-creation-state', id: pending.id, expected: 'submitted', state: 'prepared' }, () => { if (this.closed) throw new Error(tr('계정이 변경되었습니다.')) })
      return 'retry'
    } finally { reader.close() }
  }
  async close(): Promise<void> { this.closed = true; this.pause(); await this.job?.catch(() => {}); this.value.pending = null }
}
