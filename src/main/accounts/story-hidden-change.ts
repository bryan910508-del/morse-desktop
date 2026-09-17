import { ownStoryCollections, ownStoryFromDocument } from '../network/own-story-document'
import { storyHiddenFrom } from '../network/story-hidden-audience'
import { positionMilliseconds } from '../../shared/model'
import { observeStoryHiddenChange } from './story-hidden-change-observation'
import { documents } from '../network/firestore-values'
import type { StoryHiddenChangeObservation } from '../../shared/story-hidden-change'
import { storyHiddenChangeRequest, type StoryHiddenChangePrepare, type StoryHiddenChangeSnapshot, type PendingStoryHiddenChange, type StoryHiddenChangeAction } from '../../shared/story-hidden-change'
import type { StoryHiddenChangeCommand } from '../storage/story-hidden-change-table'
import { FirestoreReader, type ReadCredentials } from '../network/firestore-rpc'
import { StoryHiddenChangeFailure } from '../network/story-hidden-change-write'
import { tr } from '../../shared/i18n'
export class StoryHiddenChange {
  private closed = false
  private job: Promise<void> | null = null
  private abort: AbortController | null = null
  private observation: StoryHiddenChangeObservation | null = null
  private observationTimer: ReturnType<typeof setTimeout> | null = null
  private value: StoryHiddenChangeSnapshot = { observation: null, canCheck: false, status: 'loading', busy: false, canSend: false, pending: null, message: '' }
  constructor(private readonly uid: string, private readonly auth: ReadCredentials, private readonly allowed: (network: boolean) => void,
    private readonly source: (target: StoryHiddenChangePrepare) => { displayName: string; contactVersion: string | null },
    private readonly additionAllowed: (request: import('../../shared/story-hidden-change').StoryHiddenChangeRequest) => void,
    private readonly store: <T>(command: StoryHiddenChangeCommand, validate: () => void) => Promise<T>, private readonly changed: () => void) {}
  private validate(network = false): void { if (this.closed) throw new Error(tr('계정이 변경되었습니다.')); this.auth.signal.throwIfAborted(); this.allowed(network) }
  get snapshot(): StoryHiddenChangeSnapshot {
    let canSend = false
    if (this.value.status === 'ready' && !this.value.busy && this.value.pending?.state === 'prepared') { try { this.validate(true); canSend = true } catch { /* Local recovery remains available offline. */ } }
    let canCheck = false
    if (this.value.status === 'ready' && !this.value.busy && this.value.pending && ['submitted', 'confirmed', 'rejected'].includes(this.value.pending.state)) { try { this.validate(true); canCheck = true } catch { /* Retained record does not imply current read access. */ } }
    const observation = canCheck && this.observation && Date.now() - this.observation.observedAt < 30000 ? { ...this.observation } : null
    return { ...this.value, observation, canCheck, canSend, pending: this.value.pending ? { ...this.value.pending, original: [...this.value.pending.original], desired: [...this.value.pending.desired] } : null }
  }
  private clearObservation(): void { this.observation = null; if (this.observationTimer) clearTimeout(this.observationTimer); this.observationTimer = null }
  pause(): void { this.abort?.abort(); this.clearObservation() }
  private publish(): void { if (!this.closed) this.changed() }
  private run(operation: (signal: AbortSignal) => Promise<void>): Promise<void> {
    this.validate()
    if (this.job) throw new Error(tr('진행 중인 스토리 숨김 변경 기록을 확인해 주세요.'))
    this.clearObservation()
    const abort = new AbortController(); this.abort = abort; this.value.busy = true; this.value.message = ''
    const task = Promise.resolve().then(() => operation(abort.signal)).catch(error => {
      this.value.status = 'error'; this.value.message = tr('스토리 숨김 변경 기록을 다시 읽어 주세요. 응답이 불확실한 동안 새 변경을 준비하지 않습니다.'); throw error
    }).finally(() => { if (this.job === task) this.job = null; if (this.abort === abort) this.abort = null; this.value.busy = false; this.publish() })
    this.job = task; this.publish(); return task
  }
  refresh(): Promise<void> {
    return this.run(async signal => {
      const validate = (): void => { signal.throwIfAborted(); this.validate() }
      const pending = await this.store<PendingStoryHiddenChange | null>({ kind: 'story-hidden-change-read' }, validate)
      validate(); this.value.pending = pending; this.value.status = 'ready'
    })
  }
  prepare(input: StoryHiddenChangePrepare): Promise<void> {
    if (this.value.status !== 'ready' || this.value.pending) throw new Error(tr('이전 스토리 숨김 변경 기록을 먼저 확인해 주세요.'))
    const { id, mode, peerUid, version, privacy, storyId } = input, selected = this.source(input)
    return this.run(async signal => {
      const validate = (): void => { signal.throwIfAborted(); this.validate(true); if (JSON.stringify(this.source(input)) !== JSON.stringify(selected)) throw new Error(tr('선택한 스토리 또는 사용자가 변경되었습니다.')) }
      const reader = new FirestoreReader(this.auth)
      try {
        const doc = await reader.getDocument(`${documents}/users/${this.uid}/${ownStoryCollections[privacy]}/${storyId}`, signal, validate); validate()
        if (!doc) throw new Error(tr('현재 스토리를 확인해 주세요.'))
        const story = ownStoryFromDocument(doc, this.uid, privacy), original = storyHiddenFrom(doc).hiddenFrom, expiresAt = positionMilliseconds(story.expires)
        if (story.version !== version || expiresAt <= Date.now()) throw new Error(tr('스토리가 바뀌었거나 만료되었습니다.'))
        const desired = mode === 'add' ? [...original, peerUid] : original.filter(uid => uid !== peerUid)
        const request = storyHiddenChangeRequest({ id, mode, peerUid, version, privacy, storyId, ...selected, ownerId: this.uid, original, desired, caption: story.caption, expiresAt })
        this.value.pending = await this.store<PendingStoryHiddenChange>({ kind: 'story-hidden-change-prepare', request }, () => { validate(); if (expiresAt <= Date.now()) throw new Error(tr('스토리가 만료되었습니다.')) })
        this.value.status = 'ready'; this.value.message = tr('선택한 한 명의 숨김 추가·해제를 보관했습니다. 공개 범위와 대상을 확인한 뒤 변경해 주세요.')
      } finally { reader.close() }
    })
  }
  action(action: StoryHiddenChangeAction): Promise<void> {
    const pending = this.value.pending
    if (this.value.status !== 'ready' || !pending || pending.id !== action.id || pending.state !== action.state || (action.action === 'send' && pending.state !== 'prepared') || (action.action === 'check' && !['submitted', 'confirmed', 'rejected'].includes(pending.state))) throw new Error(tr('최신 스토리 숨김 변경 기록을 확인해 주세요.'))
    return this.run(async signal => {
      const validate = (): void => { signal.throwIfAborted(); this.validate() }
      if (action.action === 'check') {
        this.validate(true)
        const reader = new FirestoreReader(this.auth)
        const access = (): void => { validate(); this.validate(true); if (this.value.pending?.id !== pending.id || this.value.pending.state !== pending.state) throw new Error(tr('스토리 숨김 변경 기록이 변경되었습니다.')) }
        try {
          const doc = await reader.getDocument(`${documents}/users/${this.uid}/${ownStoryCollections[pending.privacy]}/${pending.storyId}`, signal, access)
          access(); this.observation = observeStoryHiddenChange(pending, doc)
        } catch {
          try { access(); this.observation = { outcome: 'unavailable', observedAt: Date.now(), message: tr('현재 스토리 숨김 설정를 확인하지 못했습니다. 부재나 변경 거절로 판단하지 않으며 기록을 유지합니다.') } }
          catch { this.value.message = tr('현재 계정과 조회 조건이 변경되어 결과를 표시하지 않습니다. 변경 기록은 유지합니다.') }
        } finally { reader.close() }
        if (this.observation) this.observationTimer = setTimeout(() => { this.clearObservation(); this.publish() }, 30000)
        return
      }
      if (action.action === 'dismiss') {
        this.value.pending = await this.store<null>({ kind: 'story-hidden-change-state', id: pending.id, expected: pending.state, state: 'dismissed' }, validate)
        this.value.message = tr('이 기기의 변경 기록을 닫았습니다. 이미 시작된 서버 변경을 취소하거나 이전 공개 대상을 복구하지 않습니다.'); return
      }
      this.validate(true)
      this.value.pending = await this.store<PendingStoryHiddenChange>({ kind: 'story-hidden-change-state', id: pending.id, expected: 'prepared', state: 'submitted' }, validate)
      let outcome: 'confirmed' | 'rejected' | null = null, reader: FirestoreReader | null = null
      try {
        reader = new FirestoreReader(this.auth)
        const { state: _state, ...request } = pending
        await reader.changeStoryHiddenAudience(this.uid, request, signal, () => { validate(); this.validate(true); if (request.mode === 'add') this.additionAllowed(request) })
        outcome = 'confirmed'
      } catch (error) {
        if (error instanceof StoryHiddenChangeFailure && !error.uncertain) outcome = 'rejected'
        else this.value.message = tr('스토리 숨김 변경 결과 미확인입니다. 요청 식별자와 검토 내용을 보존하며 자동 재전송하지 않습니다.')
      } finally { reader?.close() }
      if (outcome) {
        this.value.pending = await this.store<PendingStoryHiddenChange>({ kind: 'story-hidden-change-state', id: pending.id, expected: 'submitted', state: outcome }, validate)
        this.value.message = outcome === 'confirmed' ? tr('숨김 변경 응답을 확인했습니다. 현재 스토리 목록과 숨김 설정을 다시 읽어 주세요. 설명과 미디어는 변경하지 않습니다.') : tr('변경을 시작하지 못했거나 서버가 거절했습니다. 현재 숨김 설정를 확인해 주세요.')
      }
    })
  }
  async close(): Promise<void> { this.closed = true; this.pause(); await this.job?.catch(() => {}); this.value.pending = null }
}
