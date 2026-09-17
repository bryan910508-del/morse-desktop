import { observeCommentCreation } from './channel-comment-observation'
import type { CommentCreationObservation } from '../../shared/channel-comment-creation'
import type { CommentReplyTarget } from '../../shared/channel-comment-drafts'
import { documents } from '../network/firestore-values'
import { commentCreationRequest, type CommentCreationPrepare, type CommentCreationRequest, type CommentCreationSnapshot, type PendingCommentCreation, type CommentCreationAction } from '../../shared/channel-comment-creation'
import type { CommentCreationCommand } from '../storage/channel-comment-creation-table'
import { FirestoreReader, type ReadCredentials } from '../network/firestore-rpc'
import { ChannelCommentCreationFailure, commentCreationCount } from '../network/channel-comment-creation-write'
import type { FirestoreDocument } from '../network/firestore-values'
import { channelPostRevision } from '../media/channel-post-media-document'
import { tr } from '../../shared/i18n'
export class ChannelCommentCreation {
  private closed = false
  private job: Promise<void> | null = null
  private abort: AbortController | null = null
  private observation: { scope: string; value: CommentCreationObservation } | null = null
  private observationTimer: ReturnType<typeof setTimeout> | null = null
  private value: CommentCreationSnapshot = { observation: null, canCheck: false, status: 'loading', busy: false, canSend: false, pending: null, message: '' }
  constructor(private readonly uid: string, private readonly auth: ReadCredentials, private readonly allowed: (network: boolean) => void,
    private readonly post: (target: CommentCreationPrepare) => FirestoreDocument,
    private readonly author: () => Pick<CommentCreationRequest, 'authorId' | 'authorName' | 'authorPhotoURL' | 'profileVersion'>,
    private readonly parent: (target: CommentCreationPrepare, parent: CommentReplyTarget) => string,
    private readonly readScope: (target: CommentCreationPrepare) => string,
    private readonly store: <T>(command: CommentCreationCommand, validate: () => void) => Promise<T>, private readonly changed: () => void) {}
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
  pause(): void { this.abort?.abort(); this.clearObservation() }
  private publish(): void { if (!this.closed) this.changed() }
  private run(operation: (signal: AbortSignal) => Promise<void>): Promise<void> {
    this.validate()
    if (this.job) throw new Error(tr('진행 중인 댓글 등록 기록을 확인해 주세요.'))
    this.clearObservation()
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
    })
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
        this.value.message = tr('이 기기의 등록 기록을 닫았습니다. 서버 댓글을 삭제하거나 진행 중인 서버 작업을 취소하지 않습니다.'); return
      }
      this.source(pending)
      this.value.pending = await this.store<PendingCommentCreation>({ kind: 'comment-creation-state', id: pending.id, expected: 'prepared', state: 'submitted' }, validate)
      let outcome: 'confirmed' | 'rejected' | null = null, reader: FirestoreReader | null = null
      try {
        reader = new FirestoreReader(this.auth)
        // The strict network request excludes the local journal state.
        const { state: _state, ...request } = pending
        await reader.createChannelComment(this.uid, request, signal, () => { validate(); return this.source(request) })
        outcome = 'confirmed'
      } catch (error) {
        if (error instanceof ChannelCommentCreationFailure && !error.uncertain) outcome = 'rejected'
        else this.value.message = tr('등록 결과가 미확인 상태입니다. 초안과 요청 ID를 보존하며 자동 재전송하지 않습니다. 현재 목록만으로 이전 요청의 성공을 판정하지 않습니다.')
      } finally { reader?.close() }
      if (outcome) {
        this.value.pending = await this.store<PendingCommentCreation>({ kind: 'comment-creation-state', id: pending.id, expected: 'submitted', state: outcome }, validate)
        this.value.message = outcome === 'confirmed' ? tr('댓글 생성과 집계 증가 응답을 확인했습니다. 해당 버전의 기기 초안을 비웠습니다.') : tr('등록을 시작하지 못했거나 서버가 거절했습니다. 초안은 유지됩니다. 최신 게시물에서 다시 준비해 주세요.')
      }
    })
  }
  async close(): Promise<void> { this.closed = true; this.pause(); await this.job?.catch(() => {}); this.value.pending = null }
}
