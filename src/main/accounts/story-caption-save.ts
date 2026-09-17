import { ownStoryCollections } from '../network/own-story-document'
import { observeStoryCaptionSave } from './story-caption-save-observation'
import { documents } from '../network/firestore-values'
import type { StoryCaptionSaveObservation } from '../../shared/story-caption-save'
import { storyCaptionSaveRequest, type StoryCaptionSavePrepare, type StoryCaptionSaveSnapshot, type PendingStoryCaptionSave, type StoryCaptionSaveAction } from '../../shared/story-caption-save'
import type { StoryCaptionSaveCommand } from '../storage/story-caption-save-table'
import { FirestoreReader, type ReadCredentials } from '../network/firestore-rpc'
import { StoryCaptionSaveFailure } from '../network/story-caption-save-write'
import { tr } from '../../shared/i18n'
export class StoryCaptionSave {
  private closed = false
  private job: Promise<void> | null = null
  private abort: AbortController | null = null
  private observation: StoryCaptionSaveObservation | null = null
  private observationTimer: ReturnType<typeof setTimeout> | null = null
  private value: StoryCaptionSaveSnapshot = { observation: null, canCheck: false, status: 'loading', busy: false, canSend: false, pending: null, message: '' }
  constructor(private readonly uid: string, private readonly auth: ReadCredentials, private readonly allowed: (network: boolean) => void,
    private readonly store: <T>(command: StoryCaptionSaveCommand, validate: () => void) => Promise<T>, private readonly changed: () => void) {}
  private validate(network = false): void { if (this.closed) throw new Error(tr('계정이 변경되었습니다.')); this.auth.signal.throwIfAborted(); this.allowed(network) }
  get snapshot(): StoryCaptionSaveSnapshot {
    let canSend = false
    if (this.value.status === 'ready' && !this.value.busy && this.value.pending?.state === 'prepared') { try { this.validate(true); canSend = true } catch { /* Local recovery remains available offline. */ } }
    let canCheck = false
    if (this.value.status === 'ready' && !this.value.busy && this.value.pending && ['submitted', 'confirmed', 'rejected'].includes(this.value.pending.state)) { try { this.validate(true); canCheck = true } catch { /* The old record is independent of current read access. */ } }
    const observation = canCheck && this.observation && Date.now() - this.observation.observedAt < 30000 ? { ...this.observation } : null
    return { ...this.value, observation, canCheck, canSend, pending: this.value.pending ? { ...this.value.pending, draft: { ...this.value.pending.draft } } : null }
  }
  private clearObservation(): void { this.observation = null; if (this.observationTimer) clearTimeout(this.observationTimer); this.observationTimer = null }
  pause(): void { this.abort?.abort(); this.clearObservation() }
  private publish(): void { if (!this.closed) this.changed() }
  private run(operation: (signal: AbortSignal) => Promise<void>): Promise<void> {
    this.validate()
    if (this.job) throw new Error(tr('진행 중인 스토리 저장 기록을 확인해 주세요.'))
    this.clearObservation()
    const abort = new AbortController(); this.abort = abort; this.value.busy = true; this.value.message = ''
    const task = Promise.resolve().then(() => operation(abort.signal)).catch(error => {
      this.value.status = 'error'; this.value.message = tr('스토리 저장 기록을 다시 읽어 주세요. 응답이 불확실한 동안 새 저장을 준비하지 않습니다.'); throw error
    }).finally(() => { if (this.job === task) this.job = null; if (this.abort === abort) this.abort = null; this.value.busy = false; this.publish() })
    this.job = task; this.publish(); return task
  }
  refresh(): Promise<void> {
    return this.run(async signal => {
      const validate = (): void => { signal.throwIfAborted(); this.validate() }
      const pending = await this.store<PendingStoryCaptionSave | null>({ kind: 'story-caption-save-read' }, validate)
      validate(); this.value.pending = pending; this.value.status = 'ready'
    })
  }
  prepare(input: StoryCaptionSavePrepare): Promise<void> {
    if (this.value.status !== 'ready' || this.value.pending) throw new Error(tr('이전 스토리 저장 기록을 먼저 확인해 주세요.'))
    const request = storyCaptionSaveRequest({ ...input, ownerId: this.uid })
    return this.run(async signal => {
      const validate = (): void => { signal.throwIfAborted(); this.validate() }
      this.value.pending = await this.store<PendingStoryCaptionSave>({ kind: 'story-caption-save-prepare', request }, validate)
      this.value.status = 'ready'; this.value.message = tr('저장한 기기 편집 초안을 고정했습니다. 편집 시작 원문과 변경한 설명을 확인한 뒤 스토리에 반영해 주세요.')
    })
  }
  action(action: StoryCaptionSaveAction): Promise<void> {
    const pending = this.value.pending
    if (this.value.status !== 'ready' || !pending || pending.id !== action.id || pending.state !== action.state || (action.action === 'send' && pending.state !== 'prepared') || (action.action === 'check' && !['submitted', 'confirmed', 'rejected'].includes(pending.state))) throw new Error(tr('최신 스토리 저장 기록을 확인해 주세요.'))
    return this.run(async signal => {
      const validate = (): void => { signal.throwIfAborted(); this.validate() }
      if (action.action === 'check') {
        this.validate(true)
        const reader = new FirestoreReader(this.auth)
        const access = (): void => { validate(); this.validate(true); if (this.value.pending?.id !== pending.id || this.value.pending.state !== pending.state) throw new Error(tr('스토리 저장 기록이 변경되었습니다.')) }
        try {
          const doc = await reader.getDocument(`${documents}/users/${this.uid}/${ownStoryCollections[pending.privacy]}/${pending.storyId}`, signal, access)
          access(); this.observation = observeStoryCaptionSave(pending, doc)
        } catch {
          try { access(); this.observation = { outcome: 'unavailable', observedAt: Date.now(), message: tr('현재 스토리 문서를 확인하지 못했습니다. 부재·삭제·거절로 판단하지 않습니다. 저장 기록과 초안을 유지합니다.') } }
          catch { this.value.message = tr('현재 계정과 조회 조건이 변경되어 결과를 표시하지 않습니다. 저장 기록은 유지합니다.') }
        } finally { reader.close() }
        if (this.observation) this.observationTimer = setTimeout(() => { this.clearObservation(); this.publish() }, 30000)
        return
      }
      if (action.action === 'dismiss') {
        this.value.pending = await this.store<null>({ kind: 'story-caption-save-state', id: pending.id, expected: pending.state, state: 'dismissed' }, validate)
        this.value.message = tr('이 기기의 저장 기록을 닫았습니다. 서버 스토리를 삭제하거나 시작된 요청을 취소하지 않습니다.'); return
      }
      this.validate(true)
      this.value.pending = await this.store<PendingStoryCaptionSave>({ kind: 'story-caption-save-state', id: pending.id, expected: 'prepared', state: 'submitted' }, validate)
      let outcome: 'confirmed' | 'rejected' | null = null, reader: FirestoreReader | null = null
      try {
        reader = new FirestoreReader(this.auth)
        const { state: _state, ...request } = pending
        await reader.saveStoryCaption(this.uid, request, signal, () => { validate(); this.validate(true) })
        outcome = 'confirmed'
      } catch (error) {
        if (error instanceof StoryCaptionSaveFailure && !error.uncertain) outcome = 'rejected'
        else this.value.message = tr('스토리 수정 결과 미확인입니다. 요청 식별자와 초안을 보존하며 자동 재전송하지 않습니다.')
      } finally { reader?.close() }
      if (outcome) {
        this.value.pending = await this.store<PendingStoryCaptionSave>({ kind: 'story-caption-save-state', id: pending.id, expected: 'submitted', state: outcome }, validate)
        this.value.message = outcome === 'confirmed' ? tr('스토리 수정 응답을 확인하고 해당 기기 편집 초안을 비웠습니다. 현재 스토리 목록은 별도로 조회해 주세요.') : tr('저장을 시작하지 못했거나 서버가 거절했습니다. 초안은 유지됩니다.')
      }
    })
  }
  async close(): Promise<void> { this.closed = true; this.pause(); await this.job?.catch(() => {}); this.value.pending = null }
}
