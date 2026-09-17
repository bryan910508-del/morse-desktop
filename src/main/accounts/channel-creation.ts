import { observeChannelCreation } from './channel-creation-observation'
import { documents } from '../network/firestore-values'
import type { ChannelCreationObservation } from '../../shared/channel-creation'
import { channelCreationRequest, type ChannelCreationAction, type ChannelCreationOwner, type ChannelCreationPrepare, type ChannelCreationRequest, type ChannelCreationSnapshot, type PendingChannelCreation } from '../../shared/channel-creation'
import type { ChannelCreationCommand } from '../storage/channel-creation-table'
import { FirestoreReader, type ReadCredentials } from '../network/firestore-rpc'
import { ChannelCreationFailure } from '../network/channel-creation-write'
import { tr } from '../../shared/i18n'
export class ChannelCreation {
  private closed = false
  private job: Promise<void> | null = null
  private abort: AbortController | null = null
  private pending: PendingChannelCreation | null = null
  private status: ChannelCreationSnapshot['status'] = 'loading'
  private message = ''
  private observation: ChannelCreationObservation | null = null
  private observationTimer: ReturnType<typeof setTimeout> | null = null
  constructor(private readonly uid: string, private readonly auth: ReadCredentials, private readonly allowed: (network: boolean) => void,
    private readonly owner: () => ChannelCreationOwner,
    private readonly store: <T>(command: ChannelCreationCommand, validate: () => void) => Promise<T>, private readonly changed: () => void) {}
  private validate(network = false): void { if (this.closed) throw new Error(tr('계정이 변경되었습니다.')); this.auth.signal.throwIfAborted(); this.allowed(network) }
  private source(request: ChannelCreationRequest): void {
    this.validate(true)
    const current = channelCreationRequest({ id: request.id, name: request.name, description: request.description, ...this.owner() })
    if (JSON.stringify(current) !== JSON.stringify(channelCreationRequest(request))) throw new ChannelCreationFailure(false)
  }
  get snapshot(): ChannelCreationSnapshot {
    let canPrepare = false, canSend = false
    if (this.status === 'ready' && !this.job) {
      try { this.validate(true); this.owner(); canPrepare = !this.pending; if (this.pending?.state === 'prepared') { const { state: _state, ...request } = this.pending; this.source(request); canSend = true } } catch { /* Local records remain recoverable without current posting authority. */ }
    }
    let canCheck = false
    try { this.validate(true); canCheck = this.status === 'ready' && !this.job && Boolean(this.pending && ['submitted', 'confirmed'].includes(this.pending.state)) } catch { /* Current account metadata reads do not require the original profile version. */ }
    const observation = canCheck && this.observation && Date.now() - this.observation.observedAt < 30000 ? { ...this.observation } : null
    const p = this.pending
    // The owner photo URL and public key are wire caches, never renderer preview data.
    return { observation, canCheck, status: this.status, busy: Boolean(this.job), canPrepare, canSend, message: this.message,
      pending: p ? { id: p.id, name: p.name, description: p.description, state: p.state, ownerName: p.ownerInfo.displayName } : null }
  }
  private clearObservation(): void { this.observation = null; if (this.observationTimer) clearTimeout(this.observationTimer); this.observationTimer = null }
  pause(): void { this.abort?.abort(); this.clearObservation() }
  private publish(): void { if (!this.closed) this.changed() }
  private run(operation: (signal: AbortSignal) => Promise<void>): Promise<void> {
    this.validate()
    if (this.job) throw new Error(tr('진행 중인 채널 생성 작업을 확인해 주세요.'))
    this.clearObservation()
    const abort = new AbortController(); this.abort = abort; this.message = ''
    const task = Promise.resolve().then(() => operation(abort.signal)).catch(error => {
      this.status = 'error'; this.message = tr('채널 생성 기록을 다시 불러와 주세요. 저장 결과가 불확실한 동안 새 요청을 준비하지 않습니다.'); throw error
    }).finally(() => { if (this.job === task) this.job = null; if (this.abort === abort) this.abort = null; this.publish() })
    this.job = task; this.publish(); return task
  }
  refresh(): Promise<void> {
    return this.run(async signal => {
      const validate = (): void => { signal.throwIfAborted(); this.validate() }
      const pending = await this.store<PendingChannelCreation | null>({ kind: 'channel-creation-read' }, validate)
      validate(); this.pending = pending; this.status = 'ready'
    })
  }
  prepare(input: ChannelCreationPrepare): Promise<void> {
    if (this.status !== 'ready' || this.pending) throw new Error(tr('이전 채널 생성 기록을 먼저 확인해 주세요.'))
    this.validate(true)
    const request = channelCreationRequest({ ...input, ...this.owner() })
    return this.run(async signal => {
      const validate = (): void => { signal.throwIfAborted(); this.source(request) }
      this.pending = await this.store<PendingChannelCreation>({ kind: 'channel-creation-prepare', request }, validate)
      this.status = 'ready'; this.message = tr('이 기기에 생성 내용을 저장했습니다. 이름·소개·기본 설정과 소유자 표시를 확인한 뒤 채널을 만드세요.')
    })
  }
  action(action: ChannelCreationAction): Promise<void> {
    const pending = this.pending
    if (this.status !== 'ready' || !pending || pending.id !== action.id || pending.state !== action.state || (action.action === 'send' && pending.state !== 'prepared') || (action.action === 'check' && !['submitted', 'confirmed'].includes(pending.state))) throw new Error(tr('최신 채널 생성 기록을 확인해 주세요.'))
    const { state: _state, ...request } = pending
    return this.run(async signal => {
      const validate = (): void => { signal.throwIfAborted(); this.validate() }
      if (action.action === 'check') {
        const access = (): void => { validate(); this.validate(true) }
        access()
        const reader = new FirestoreReader(this.auth)
        try {
          const doc = await reader.getDocument(`${documents}/channels/${pending.id}`, signal, access)
          access(); this.observation = observeChannelCreation(request, doc)
        } catch {
          try { access(); this.observation = { outcome: 'unavailable', discussion: 'unobserved', observedAt: Date.now(), message: tr('현재 채널 문서를 확인하지 못했습니다. 부재·삭제·거절로 판정하지 않고 제출 기록을 유지합니다.') } }
          catch { this.message = tr('계정·잠금·연결 상태가 변경되어 이전 조회 결과를 표시하지 않습니다. 제출 기록은 유지합니다.') }
        } finally { reader.close() }
        if (this.observation) this.observationTimer = setTimeout(() => { this.clearObservation(); this.publish() }, 30000)
        return
      }
      if (action.action === 'dismiss') {
        this.pending = await this.store<null>({ kind: 'channel-creation-state', id: pending.id, expected: pending.state, state: 'dismissed' }, validate)
        this.message = tr('이 기기의 생성 기록만 닫았습니다. 서버 채널과 토론방은 삭제하거나 취소하지 않습니다.'); return
      }
      this.source(request)
      this.pending = await this.store<PendingChannelCreation>({ kind: 'channel-creation-state', id: pending.id, expected: 'prepared', state: 'submitted' }, validate)
      let outcome: 'confirmed' | 'rejected' | null = null, reader: FirestoreReader | null = null
      try {
        reader = new FirestoreReader(this.auth)
        await reader.createChannel(this.uid, request, signal, () => { validate(); this.source(request) })
        outcome = 'confirmed'
      } catch (error) {
        if (error instanceof ChannelCreationFailure && !error.uncertain) outcome = 'rejected'
        else this.message = tr('채널 생성 결과 미확인 상태입니다. 요청 ID와 내용을 보존하며 자동으로 다시 보내지 않습니다. 현재 채널 목록만으로 과거 응답을 판정하지 않습니다.')
      } finally { reader?.close() }
      if (outcome) {
        this.pending = await this.store<PendingChannelCreation>({ kind: 'channel-creation-state', id: pending.id, expected: 'submitted', state: outcome }, validate)
        this.message = outcome === 'confirmed' ? tr('채널 문서 생성 응답을 확인했습니다. 토론방 생성은 별도 서버 작업이며 준비 완료를 확인한 것은 아닙니다. 최신 내 채널 목록에서 채널을 열 수 있습니다.') : tr('채널 생성을 시작하지 못했거나 서버가 거절했습니다. 기록을 닫고 최신 소유자 정보에서 다시 준비해 주세요.')
      }
    })
  }
  async close(): Promise<void> { this.closed = true; this.pause(); await this.job?.catch(() => {}); this.pending = null }
}
