import type { StoryReplyDetachCommand } from '../storage/story-reply-detach-table'
import type { StoryReplyDetachReceipt } from '../../shared/story-reply-detach'
import { storyReplySourceRebase, type StoryReplySourceRebase, type StoryReplySourceReview } from '../../shared/story-reply-source-review'
import { replyCurrentSource } from '../network/story-reply-current-source'
import { storyReplyHistoryRequest, type StoryReplyHistoryRequest, type StoryReplyHistoryPage } from '../../shared/story-reply-history'
import type { StoryReplySendCommand } from '../storage/story-reply-send-table'
import { storyReplySendRequest, type StoryReplySendRequest, type StoryReplySendReceipt } from '../../shared/story-reply-send'
import { outgoingText } from '../../shared/validation'
import { storyReplyTextTarget, storyReplyTextWrite, type StoryReplyTextTarget, type StoryReplyTextWrite, type StoryReplyTextRecord } from '../../shared/story-reply-text'
import { storyReplyDraftPrepare, storyReplyDraftRequest, storyReplyDraftAction, type StoryReplyDraftPrepare, type StoryReplyDraftAction, type StoryReplyDraftSnapshot, type PendingStoryReplyDraft } from '../../shared/story-reply-draft'
import type { StoryReplyDraftCommand } from '../storage/story-reply-draft-table'
import { FirestoreReader, type ReadCredentials } from '../network/firestore-rpc'
import type { StoryPrivacy } from '../../shared/own-stories'
import { feedCopyPath } from '../network/story-feed-document'
import { serverNow } from '../network/server-clock'
import { tr } from '../../shared/i18n'
export class StoryReplyDraft {
  private closed = false
  private job: Promise<unknown> | null = null
  private abort: AbortController | null = null
  private value: StoryReplyDraftSnapshot = { status: 'loading', busy: false, pending: null, message: '' }
  constructor(private readonly uid: string, private readonly auth: ReadCredentials, private readonly allowed: (network: boolean) => void,
    private readonly source: (request: StoryReplyDraftPrepare) => { ownerId: string; ownerName: string; privacy: StoryPrivacy; version: string; expiresAt: number; caption: string },
    private readonly sendAllowed: (pending: PendingStoryReplyDraft) => void,
    private readonly sendKnown: (id: string, validate: () => void) => Promise<StoryReplySendReceipt | null>,
    private readonly enqueue: (pending: PendingStoryReplyDraft, validate: () => void) => Promise<StoryReplySendReceipt>,
    private readonly detachDraft: (pending: PendingStoryReplyDraft, validate: () => void) => Promise<StoryReplyDetachReceipt>,
    private readonly store: <T>(command: StoryReplyDraftCommand | StoryReplySendCommand | StoryReplyDetachCommand, validate: () => void) => Promise<T>, private readonly changed: () => void,
    private readonly now: () => number = serverNow) {}
  private validate(network = false): void { if (this.closed) throw new Error(tr('계정이 변경되었습니다.')); this.auth.signal.throwIfAborted(); this.allowed(network) }
  get snapshot(): StoryReplyDraftSnapshot { return { ...this.value, pending: this.value.pending ? { ...this.value.pending } : null } }
  pause(): void { this.abort?.abort() }
  private publish(): void { if (!this.closed) this.changed() }
  private run<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.validate(); if (this.job) throw new Error(tr('진행 중인 스토리 답장 준비 기록을 확인해 주세요.'))
    const abort = new AbortController(); this.abort = abort; this.value.busy = true; this.value.message = ''
    const task = Promise.resolve().then(() => operation(abort.signal)).catch(error => { this.value.status = 'error'; this.value.message = tr('기기의 스토리 답장 준비 기록을 다시 읽어 주세요. 확인 전 새 기록을 준비하지 않습니다.'); throw error }).finally(() => { if (this.job === task) this.job = null; if (this.abort === abort) this.abort = null; this.value.busy = false; this.publish() })
    this.job = task; this.publish(); return task
  }
  refresh(): Promise<void> { return this.run(async signal => { const validate = (): void => { signal.throwIfAborted(); this.validate() }; const pending = await this.store<PendingStoryReplyDraft | null>({ kind: 'story-reply-draft-read' }, validate); validate(); this.value.pending = pending; this.value.status = 'ready' }) }
  prepare(input: StoryReplyDraftPrepare): Promise<void> {
    const request = storyReplyDraftPrepare(input)
    if (this.value.status !== 'ready' || this.value.pending) throw new Error(tr('이전 스토리 답장 준비 기록을 먼저 확인해 주세요.'))
    // B408 S2: the story is the one the viewer has open — this account's copy of it, or what getMorsePeerStories gave —
    // so nothing is read again here (tdesktop replies to the story it shows, Media::Stories::ReplyArea).
    this.validate(true); const selected = this.source(request)
    if (selected.ownerId === this.uid) throw new Error(tr('현재 타인 스토리를 확인해 주세요.'))
    return this.run(async operationSignal => {
      const signal = AbortSignal.any([operationSignal, this.auth.signal, AbortSignal.timeout(35000)])
      const validate = (): void => { signal.throwIfAborted(); this.validate(); if (JSON.stringify(this.source(request)) !== JSON.stringify(selected)) throw new Error(tr('선택한 스토리 또는 연락처가 변경되었습니다.')); if (selected.expiresAt <= this.now()) throw new Error(tr('스토리가 만료되었습니다.')) }
      validate()
      const retained = storyReplyDraftRequest({ id: request.id, viewerId: this.uid, ownerId: selected.ownerId, ownerName: selected.ownerName, storyId: request.storyId, privacy: selected.privacy, version: selected.version, expiresAt: selected.expiresAt, captionPreview: Array.from(selected.caption).slice(0, 160).join('') })
      const pending = await this.store<PendingStoryReplyDraft>({ kind: 'story-reply-draft-prepare', request: retained }, validate)
      signal.throwIfAborted(); this.validate(); this.value.pending = pending; this.value.status = 'ready'; this.value.message = tr('답장할 스토리 출처와 작성자를 이 기기에 보관했습니다. 메시지를 보내지 않았습니다.')
    })
  }
  readText(input: StoryReplyTextTarget): Promise<StoryReplyTextRecord> {
    const target = storyReplyTextTarget(input)
    return this.run(async signal => {
      const validate = (): void => { signal.throwIfAborted(); this.validate() }
      const pending = await this.store<PendingStoryReplyDraft | null>({ kind: 'story-reply-draft-read' }, validate)
      validate(); this.value.pending = pending; this.value.status = 'ready'
      return pending?.id === target.id ? { id: target.id, text: pending.text, revision: pending.revision } : { id: target.id, text: null, revision: null }
    })
  }
  saveText(input: StoryReplyTextWrite): Promise<StoryReplyTextRecord> {
    const request = storyReplyTextWrite(input)
    return this.run(async signal => {
      const validate = (): void => { signal.throwIfAborted(); this.validate() }
      const pending = await this.store<PendingStoryReplyDraft>({ kind: 'story-reply-text-write', request }, validate)
      validate(); this.value.pending = pending; this.value.status = 'ready'
      return { id: pending.id, text: pending.text, revision: pending.revision }
    })
  }
  detached(id: string): Promise<StoryReplyDetachReceipt | null> {
    const target = storyReplyTextTarget({ id })
    return this.run(async signal => { const validate = (): void => { signal.throwIfAborted(); this.validate() }; const receipt = await this.store<StoryReplyDetachReceipt | null>({ kind: 'story-reply-detach-known', id: target.id }, validate); validate(); return receipt })
  }
  detachedHistory(): Promise<StoryReplyDetachReceipt[]> {
    return this.run(async signal => { const validate = (): void => { signal.throwIfAborted(); this.validate() }; const items = await this.store<StoryReplyDetachReceipt[]>({ kind: 'story-reply-detach-list' }, validate); validate(); return items })
  }
  detach(input: StoryReplySendRequest): Promise<StoryReplyDetachReceipt> {
    const request = storyReplySendRequest(input)
    return this.run(async signal => {
      const local = (): void => { signal.throwIfAborted(); this.validate() }
      const previous = await this.store<StoryReplyDetachReceipt | null>({ kind: 'story-reply-detach-known', id: request.id }, local); local()
      if (previous) return previous
      const pending = await this.store<PendingStoryReplyDraft | null>({ kind: 'story-reply-draft-read' }, local); local()
      if (!pending || pending.id !== request.id || pending.revision !== request.revision || !pending.text.length) throw new Error(tr('옮길 답장 저장본을 확인해 주세요.'))
      const validate = (): void => { local(); this.validate(true); this.sendAllowed(pending) }
      validate(); const receipt = await this.detachDraft(pending, validate)
      local(); this.value.pending = null; this.value.status = 'ready'; this.value.message = tr('본문을 일반 메시지 초안으로 옮기고 스토리 출처를 정리했습니다. 메시지를 보내지 않았습니다.')
      return receipt
    })
  }
  compareSource(input: StoryReplySendRequest): Promise<StoryReplySourceReview> {
    const request = storyReplySendRequest(input)
    return this.run(async operationSignal => {
      const signal = AbortSignal.any([operationSignal, this.auth.signal, AbortSignal.timeout(35000)])
      const local = (): void => { signal.throwIfAborted(); this.validate() }
      const before = await this.store<PendingStoryReplyDraft | null>({ kind: 'story-reply-draft-read' }, local); local()
      if (!before || before.id !== request.id || before.revision !== request.revision) throw new Error(tr('현재 저장한 답장 본문을 다시 확인해 주세요.'))
      const validate = (): void => { local(); this.validate(true); this.sendAllowed(before) }
      const reader = new FirestoreReader(this.auth)
      try {
        let result: Pick<StoryReplySourceReview, 'outcome' | 'current'>
        try {
          validate()
          const doc = await reader.getDocument(feedCopyPath(this.uid, before.ownerId, before.storyId), signal, validate); validate()
          if (!doc) result = { outcome: 'absent', current: null }
          else {
            // A copy is written again whenever the server feeds it, so its time is not the story's: what the
            // reply names — when it ends and what it says — is what is compared.
            const current = replyCurrentSource(before, doc)
            result = current.expiresAt <= this.now() ? { outcome: 'expired', current: null } : { current, outcome: current.expiresAt === before.expiresAt && current.captionPreview === before.captionPreview ? 'unchanged' : 'changed' }
          }
        } catch { local(); result = { outcome: 'unavailable', current: null } }
        const after = await this.store<PendingStoryReplyDraft | null>({ kind: 'story-reply-draft-read' }, local); local()
        if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error(tr('비교 중 저장본이 변경되었습니다.'))
        if (result.current && result.current.expiresAt <= this.now()) result = { outcome: 'expired', current: null }
        this.value.pending = after; this.value.status = 'ready'
        return { ...request, ...result, observedAt: this.now() }
      } finally { reader.close() }
    })
  }
  rebaseSource(input: StoryReplySourceRebase): Promise<PendingStoryReplyDraft> {
    const request = storyReplySourceRebase(input)
    return this.run(async operationSignal => {
      const signal = AbortSignal.any([operationSignal, this.auth.signal, AbortSignal.timeout(35000)])
      const local = (): void => { signal.throwIfAborted(); this.validate() }
      const pending = await this.store<PendingStoryReplyDraft | null>({ kind: 'story-reply-draft-read' }, local); local()
      if (!pending || pending.id !== request.id) throw new Error(tr('답장 초안이 변경되었습니다.'))
      const replay = pending.revision === request.revision && pending.version === request.current.version && pending.expiresAt === request.current.expiresAt && pending.captionPreview === request.current.captionPreview
      if (replay) { this.value.pending = pending; this.value.status = 'ready'; return pending }
      if (pending.revision !== request.expected) throw new Error(tr('답장 저장 버전이 변경되었습니다.'))
      const validate = (): void => { local(); this.validate(true); this.sendAllowed(pending); if (request.current.expiresAt <= this.now()) throw new Error(tr('스토리가 만료되었습니다.')) }
      const reader = new FirestoreReader(this.auth)
      try {
        validate()
        const doc = await reader.getDocument(feedCopyPath(this.uid, pending.ownerId, pending.storyId), signal, validate); validate()
        if (!doc || JSON.stringify(replyCurrentSource(pending, doc)) !== JSON.stringify(request.current)) throw new Error(tr('검토한 현재 스토리 출처가 변경되었습니다. 다시 비교해 주세요.'))
        const next = await this.store<PendingStoryReplyDraft>({ kind: 'story-reply-source-rebase', request }, validate)
        local(); this.value.pending = next; this.value.status = 'ready'; this.value.message = tr('답장 본문을 유지하고 기기에 저장한 출처를 갱신했습니다. 메시지는 보내지 않았습니다.')
        return next
      } finally { reader.close() }
    })
  }
  history(input: StoryReplyHistoryRequest): Promise<StoryReplyHistoryPage> {
    const request = storyReplyHistoryRequest(input)
    return this.run(async signal => { const validate = (): void => { signal.throwIfAborted(); this.validate() }; const page = await this.store<StoryReplyHistoryPage>({ kind: 'story-reply-send-history', request }, validate); validate(); return page })
  }
  receipt(id: string): Promise<StoryReplySendReceipt | null> {
    const target = storyReplyTextTarget({ id })
    return this.run(async signal => { const validate = (): void => { signal.throwIfAborted(); this.validate() }; const receipt = await this.sendKnown(target.id, validate); validate(); return receipt })
  }
  send(input: StoryReplySendRequest): Promise<StoryReplySendReceipt> {
    const request = storyReplySendRequest(input)
    return this.run(async operationSignal => {
      const local = (): void => { operationSignal.throwIfAborted(); this.validate() }
      const old = await this.sendKnown(request.id, local); local()
      if (old) { this.value.pending = await this.store<PendingStoryReplyDraft | null>({ kind: 'story-reply-draft-read' }, local); this.value.status = 'ready'; return old }
      const pending = await this.store<PendingStoryReplyDraft | null>({ kind: 'story-reply-draft-read' }, local); local()
      if (!pending || pending.id !== request.id || pending.revision !== request.revision) throw new Error(tr('보낼 답장 저장본이 변경되었습니다.'))
      outgoingText(pending.text)
      const signal = AbortSignal.any([operationSignal, this.auth.signal, AbortSignal.timeout(35000)])
      const validate = (): void => { signal.throwIfAborted(); this.validate(true); this.sendAllowed(pending); if (pending.expiresAt <= this.now()) throw new Error(tr('스토리가 만료되었습니다.')) }
      const reader = new FirestoreReader(this.auth)
      try {
        validate()
        // The story is still this account's to see while its copy is in the feed (B408 S2).
        const doc = await reader.getDocument(feedCopyPath(this.uid, pending.ownerId, pending.storyId), signal, validate); validate()
        if (!doc) throw new Error(tr('현재 스토리를 확인하지 못했습니다.'))
        if (replyCurrentSource(pending, doc).expiresAt !== pending.expiresAt) throw new Error(tr('스토리 버전이나 접근 조건이 바뀌었습니다.'))
        const receipt = await this.enqueue(pending, validate)
        local(); this.value.pending = null; this.value.status = 'ready'; this.value.message = tr('이 기기의 전송 대기열에 답장을 등록했습니다. 서버 수신 결과는 대화의 전송 상태에서 확인해 주세요.')
        return receipt
      } finally { reader.close() }
    })
  }
  action(input: StoryReplyDraftAction): Promise<void> {
    const action = storyReplyDraftAction(input), pending = this.value.pending
    if (this.value.status !== 'ready' || !pending || pending.id !== action.id || pending.state !== action.state || pending.revision !== action.revision) throw new Error(tr('최신 스토리 답장 준비 기록을 확인해 주세요.'))
    return this.run(async signal => { const validate = (): void => { signal.throwIfAborted(); this.validate() }; const next = await this.store<null>({ kind: 'story-reply-draft-dismiss', id: pending.id, expected: pending.state, revision: action.revision }, validate); validate(); this.value.pending = next; this.value.message = tr('이 기기의 검토 기록을 닫았습니다. 메시지를 보내지 않았습니다.') })
  }
  async close(): Promise<void> { this.closed = true; this.pause(); await this.job?.catch(() => {}); this.value.pending = null }
}
