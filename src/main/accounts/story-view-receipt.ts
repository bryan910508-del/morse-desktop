import { observeStoryViewReceipt } from './story-view-receipt-observation'
import { StoryViewReceiptWriteFailure } from '../network/story-view-receipt-write'
import { storyViewReceiptPrepare, storyViewReceiptRequest, storyViewReceiptAction, type StoryViewReceiptPrepare, type StoryViewReceiptAction, type StoryViewReceiptSnapshot, type PendingStoryViewReceipt, type StoryViewReceiptRequest, type StoryViewReceiptObservation } from '../../shared/story-view-receipt'
import { positionMilliseconds } from '../../shared/model'
import type { StoryViewReceiptCommand } from '../storage/story-view-receipt-table'
import { FirestoreReader, type ReadCredentials } from '../network/firestore-rpc'
import { ownStoryCollections, ownStoryFromDocument } from '../network/own-story-document'
import { documents } from '../network/firestore-values'
import { storyHiddenFrom } from '../network/story-hidden-audience'
import { currentViewerRecord } from '../network/contact-story-view-record'
import { tr } from '../../shared/i18n'
export class StoryViewReceipt {
  private closed = false
  private job: Promise<void> | null = null
  private abort: AbortController | null = null
  private observationAbort: AbortController | null = null
  private observation: StoryViewReceiptObservation | null = null
  private observationTimer: ReturnType<typeof setTimeout> | null = null
  private value: StoryViewReceiptSnapshot = { status: 'loading', busy: false, canSend: false, canCheck: false, observation: null, pending: null, message: '' }
  constructor(private readonly uid: string, private readonly auth: ReadCredentials, private readonly allowed: (network: boolean) => void,
    private readonly source: (request: StoryViewReceiptPrepare) => { ownerId: string; ownerName: string },
    private readonly observeAllowed: (request: StoryViewReceiptRequest) => void,
    private readonly sendAllowed: (request: StoryViewReceiptRequest) => void,
    private readonly store: <T>(command: StoryViewReceiptCommand, validate: () => void) => Promise<T>, private readonly changed: () => void) {}
  private validate(network = false): void { if (this.closed) throw new Error(tr('계정이 변경되었습니다.')); this.auth.signal.throwIfAborted(); this.allowed(network) }
  get snapshot(): StoryViewReceiptSnapshot {
    let canSend = false
    if (this.value.status === 'ready' && !this.value.busy && this.value.pending?.state === 'prepared' && this.value.pending.expiresAt > Date.now()) { try { this.validate(true); this.sendAllowed(this.value.pending); canSend = true } catch { /* Local recovery remains available with stealth enabled. */ } }
    let canCheck = false
    if (this.value.status === 'ready' && !this.value.busy && this.value.pending && this.value.pending.state !== 'prepared') { try { this.validate(true); this.observeAllowed(this.value.pending); canCheck = true } catch { /* Local records do not grant current access. */ } }
    const observation = canCheck && this.observation && Date.now() - this.observation.observedAt < 30000 ? { ...this.observation } : null
    return { ...this.value, canSend, canCheck, observation, pending: this.value.pending ? { ...this.value.pending } : null }
  }
  private clearObservation(): void { this.observation = null; if (this.observationTimer) clearTimeout(this.observationTimer); this.observationTimer = null }
  clearCurrent(): void { this.observationAbort?.abort(); this.clearObservation(); this.publish() }
  prune(): void { try { if (this.value.pending) { this.validate(true); this.observeAllowed(this.value.pending) } } catch { this.pause() } }
  pause(): void { this.abort?.abort(); this.clearObservation() }
  private publish(): void { if (!this.closed) this.changed() }
  private run(operation: (signal: AbortSignal) => Promise<void>): Promise<void> {
    this.validate(); if (this.job) throw new Error(tr('진행 중인 열람 준비 기록을 확인해 주세요.'))
    this.clearObservation()
    const abort = new AbortController(); this.abort = abort; this.value.busy = true; this.value.message = ''
    const task = Promise.resolve().then(() => operation(abort.signal)).catch(error => { this.value.status = 'error'; this.value.message = tr('기기의 열람 준비 기록을 다시 읽어 주세요. 확인 전 새 기록을 준비하지 않습니다.'); throw error }).finally(() => { if (this.job === task) this.job = null; if (this.abort === abort) this.abort = null; this.value.busy = false; this.publish() })
    this.job = task; this.publish(); return task
  }
  refresh(): Promise<void> { return this.run(async signal => { const validate = (): void => { signal.throwIfAborted(); this.validate() }; const pending = await this.store<PendingStoryViewReceipt | null>({ kind: 'story-view-receipt-read' }, validate); validate(); this.value.pending = pending; this.value.status = 'ready' }) }
  prepare(input: StoryViewReceiptPrepare): Promise<void> {
    const request = storyViewReceiptPrepare(input)
    if (this.value.status !== 'ready' || this.value.pending) throw new Error(tr('이전 열람 준비 기록을 먼저 확인해 주세요.'))
    this.validate(true); const selected = this.source(request)
    return this.run(async operationSignal => {
      const signal = AbortSignal.any([operationSignal, this.auth.signal, AbortSignal.timeout(35000)])
      const validate = (): void => { signal.throwIfAborted(); this.validate(true); if (JSON.stringify(this.source(request)) !== JSON.stringify(selected)) throw new Error(tr('선택한 스토리 또는 연락처가 변경되었습니다.')) }
      const reader = new FirestoreReader(this.auth)
      try {
        validate(); const doc = await reader.getDocument(`${documents}/users/${selected.ownerId}/${ownStoryCollections[request.privacy]}/${request.storyId}`, signal, validate); validate()
        if (!doc || selected.ownerId === this.uid) throw new Error(tr('현재 타인 스토리를 확인해 주세요.'))
        const story = ownStoryFromDocument(doc, selected.ownerId, request.privacy), expiresAt = positionMilliseconds(story.expires)
        if (story.version !== request.version || expiresAt <= Date.now() || storyHiddenFrom(doc).hiddenFrom.includes(this.uid)) throw new Error(tr('스토리 버전이나 접근 조건이 바뀌었습니다.'))
        const current = currentViewerRecord(doc, this.uid, true)
        if (current.listed) throw new Error(tr('이미 본인이 포함된 열람 목록입니다. 현재 기록을 다시 확인해 주세요.'))
        const retained = storyViewReceiptRequest({ id: request.id, viewerId: this.uid, ...selected, storyId: request.storyId, privacy: request.privacy, version: request.version, expiresAt, captionPreview: Array.from(story.caption).slice(0, 160).join(''), viewerFieldPresent: current.viewerFieldPresent, originalTimeField: current.timeField, originalViewedAt: current.viewedAt })
        const pending = await this.store<PendingStoryViewReceipt>({ kind: 'story-view-receipt-prepare', request: retained }, () => { validate(); if (expiresAt <= Date.now()) throw new Error(tr('스토리가 만료되었습니다.')) })
        signal.throwIfAborted(); this.validate(); this.value.pending = pending; this.value.status = 'ready'; this.value.message = tr('열람 준비 내용을 이 기기에 보관했습니다. 아직 서버 열람 기록을 남기지 않았습니다.')
      } finally { reader.close() }
    })
  }
  action(input: StoryViewReceiptAction): Promise<void> {
    const action = storyViewReceiptAction(input), pending = this.value.pending
    if (this.value.status !== 'ready' || !pending || pending.id !== action.id || pending.state !== action.state || (action.action === 'send' && pending.state !== 'prepared') || (action.action === 'check' && pending.state === 'prepared')) throw new Error(tr('최신 열람 준비 기록을 확인해 주세요.'))
    return this.run(async signal => {
      const validate = (): void => { signal.throwIfAborted(); this.validate() }
      if (action.action === 'check') {
        const cancellation = new AbortController(); this.observationAbort = cancellation
        const bounded = AbortSignal.any([signal, cancellation.signal, this.auth.signal, AbortSignal.timeout(35000)])
        const access = (): void => { bounded.throwIfAborted(); this.validate(true); this.observeAllowed(pending); if (this.value.pending?.id !== pending.id || this.value.pending.state !== pending.state) throw new Error('View receipt record changed') }
        const reader = new FirestoreReader(this.auth)
        try {
          access(); const doc = await reader.getDocument(`${documents}/users/${pending.ownerId}/${ownStoryCollections[pending.privacy]}/${pending.storyId}`, bounded, access); access()
          this.observation = observeStoryViewReceipt(pending, doc)
        } catch {
          try { validate(); this.validate(true); this.observeAllowed(pending); if (!signal.aborted && !cancellation.signal.aborted) this.observation = { outcome: 'unavailable', observedAt: Date.now(), message: tr('현재 스토리·청중·숨김·본인 열람 기록을 확인하지 못했습니다. 기록이 없거나 전송이 거절된 것으로 판단하지 않습니다. 기록은 유지합니다.') } }
          catch { this.value.message = tr('현재 계정이나 조회 조건이 바뀌어 관측 내용을 표시하지 않습니다. 변경 기록은 유지합니다.') }
        } finally { if (this.observationAbort === cancellation) this.observationAbort = null; reader.close() }
        if (this.observation) this.observationTimer = setTimeout(() => { this.clearObservation(); this.publish() }, 30000)
        return
      }
      if (action.action === 'dismiss') {
        const next = await this.store<null>({ kind: 'story-view-receipt-state', id: pending.id, expected: pending.state, state: 'dismissed' }, validate)
        validate(); this.value.pending = next; this.value.message = tr('이 기기의 변경 기록을 닫았습니다. 이미 시작한 서버 변경을 취소하거나 이전 열람 상태를 복원하지 않습니다.'); return
      }
      this.validate(true); this.sendAllowed(pending)
      if (pending.expiresAt <= Date.now()) throw new Error(tr('검토한 스토리가 만료되었습니다.'))
      this.value.pending = await this.store<PendingStoryViewReceipt>({ kind: 'story-view-receipt-state', id: pending.id, expected: 'prepared', state: 'submitted' }, validate)
      let outcome: 'confirmed' | 'rejected' | null = null, reader: FirestoreReader | null = null
      try {
        reader = new FirestoreReader(this.auth)
        const { state: _state, ...request } = pending
        await reader.writeStoryViewReceipt(this.uid, request, signal, () => { validate(); this.validate(true); this.sendAllowed(request); if (request.expiresAt <= Date.now()) throw new Error('Story expired before commit') })
        outcome = 'confirmed'
      } catch (error) {
        if (error instanceof StoryViewReceiptWriteFailure && !error.uncertain) outcome = 'rejected'
        else this.value.message = tr('열람 기록 결과 미확인입니다. 검토 내용을 유지하며 자동 재전송하지 않습니다. 현재 스토리 목록에서 열람 기록을 다시 확인해 주세요.')
      } finally { reader?.close() }
      if (outcome) {
        this.value.pending = await this.store<PendingStoryViewReceipt>({ kind: 'story-view-receipt-state', id: pending.id, expected: 'submitted', state: outcome }, validate)
        this.value.message = outcome === 'confirmed' ? tr('본인 열람 기록 응답을 확인했습니다. 스토리 목록을 다시 읽어 현재 열람 기록을 확인해 주세요.') : tr('변경을 시작하지 못했거나 서버가 거절했습니다. 현재 스토리와 청중 관계를 다시 확인해 주세요.')
      }
    })
  }

  async close(): Promise<void> { this.closed = true; this.pause(); await this.job?.catch(() => {}); this.value.pending = null }
}
