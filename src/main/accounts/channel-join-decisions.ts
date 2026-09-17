import type { ChannelJoinDecisionAction, ChannelJoinDecisionRequest, ChannelJoinDecisionSnapshot, ChannelJoinDecisionState, PendingChannelJoinDecision } from '../../shared/channel-join-decisions'
import type { ChannelJoinDecisionCommand } from '../storage/channel-join-decision-table'
import { decideChannelJoin, ChannelJoinDecisionFailure } from '../network/channel-join-decisions'
import { FirestoreReader, type ReadCredentials } from '../network/firestore-rpc'
import { documents, stringField } from '../network/firestore-values'
import { tr } from '../../shared/i18n'

export class ChannelJoinDecisions {
  private closed = false
  private job: Promise<void> | null = null
  private abort: AbortController | null = null
  private remoteChannel: string | null = null
  private value: ChannelJoinDecisionSnapshot = { status: 'loading', busy: false, canSend: false, pending: null, message: '' }
  constructor(private readonly uid: string, private readonly auth: ReadCredentials, private readonly allowed: () => void,
    private readonly source: (request: ChannelJoinDecisionRequest) => void, private readonly owner: (channelId: string) => void,
    private readonly store: <T>(command: ChannelJoinDecisionCommand, validate?: () => void) => Promise<T>, private readonly changed: () => void) {}
  get snapshot(): ChannelJoinDecisionSnapshot {
    let canSend = false
    if (this.value.status === 'ready' && !this.value.busy && this.value.pending?.state === 'prepared') {
      try { this.validate(); this.source(this.value.pending); canSend = true } catch { /* A stale selection remains reviewable. */ }
    }
    return { ...this.value, canSend, pending: this.value.pending ? { ...this.value.pending } : null }
  }
  pause(): void { this.abort?.abort() }
  prune(): void { if (this.remoteChannel) { try { this.owner(this.remoteChannel) } catch { this.pause() } } }
  private validate(): void { if (this.closed) throw new Error(tr('계정이 변경되었습니다.')); this.auth.signal.throwIfAborted(); this.allowed() }
  private publish(): void { if (!this.closed) this.changed() }
  private run(operation: (signal: AbortSignal) => Promise<void>): Promise<void> {
    this.validate()
    if (this.job) throw new Error(tr('진행 중인 가입 처리를 마쳐 주세요.'))
    const abort = new AbortController(); this.abort = abort; this.value.busy = true; this.value.message = ''
    const signal = AbortSignal.any([abort.signal, this.auth.signal, AbortSignal.timeout(180000)])
    const task = Promise.resolve().then(() => operation(signal)).catch(error => {
      this.value.status = 'error'; this.value.message = tr('가입 처리 기록을 확인하지 못했습니다. 다시 불러온 뒤 확인해 주세요.'); throw error
    }).finally(() => { if (this.job === task) this.job = null; if (this.abort === abort) this.abort = null; this.remoteChannel = null; this.value.busy = false; this.publish() })
    this.job = task; this.publish(); return task
  }
  // async: a locked screen or a job still ending rejects instead of throwing into AccountSession.setConnection.
  async refresh(): Promise<void> {
    return this.run(async signal => {
      const validate = (): void => { signal.throwIfAborted(); this.validate() }
      const pending = await this.store<PendingChannelJoinDecision | null>({ kind: 'channel-join-decision-read' }, validate)
      validate(); this.value.pending = pending; this.value.status = 'ready'
    })
  }
  prepare(request: ChannelJoinDecisionRequest): Promise<void> {
    if (this.value.status !== 'ready' || this.value.pending || request.userId === this.uid) throw new Error(tr('이전 기록과 선택한 신청자를 확인해 주세요.'))
    this.source(request)
    return this.run(async signal => {
      const validate = (): void => { signal.throwIfAborted(); this.validate(); this.source(request) }
      this.value.pending = await this.store<PendingChannelJoinDecision>({ kind: 'channel-join-decision-prepare', request }, validate)
      this.value.status = 'ready'; this.value.message = tr('처리 내용을 기기에 저장했습니다. 최종 확인 후 서버에 요청합니다.')
    })
  }
  action(action: ChannelJoinDecisionAction): Promise<void> {
    const pending = this.value.pending
    if (this.value.status !== 'ready' || !pending || pending.id !== action.id || pending.state !== action.state) throw new Error(tr('최신 가입 처리 기록을 확인해 주세요.'))
    if (action.action === 'send' && pending.state !== 'prepared') throw new Error(tr('이미 제출한 가입 처리는 재전송하지 않습니다.'))
    if (action.action === 'check' && !['submitted', 'confirmed', 'rejected'].includes(pending.state)) throw new Error(tr('제출한 기록을 선택해 주세요.'))
    return this.run(async signal => {
      const validate = (): void => { signal.throwIfAborted(); this.validate() }
      const state = async (expected: ChannelJoinDecisionState, next: ChannelJoinDecisionState | 'dismissed'): Promise<void> => {
        this.value.pending = await this.store<PendingChannelJoinDecision | null>({ kind: 'channel-join-decision-state', id: pending.id, expected, state: next }, validate)
      }
      if (action.action === 'dismiss') { await state(pending.state, 'dismissed'); this.value.message = tr('기기의 처리 기록을 닫았습니다. 서버의 가입 요청과 구독은 변경하지 않았습니다.'); return }
      if (action.action === 'send') {
        this.source(pending); this.remoteChannel = pending.channelId
        await state('prepared', 'submitted')
        let outcome: 'confirmed' | 'rejected' | null = null
        try { await decideChannelJoin(this.auth, this.uid, pending, signal, () => { validate(); this.source(pending) }); outcome = 'confirmed' }
        catch (error) {
          if (error instanceof ChannelJoinDecisionFailure && !error.uncertain) outcome = 'rejected'
          else this.value.message = tr('승인·거절이 적용되었을 수 있습니다. 같은 요청은 다시 보내지 않습니다. 현재 기록을 별도로 조회해 주세요.')
        }
        if (outcome) {
          await state('submitted', outcome)
          this.value.message = outcome === 'confirmed' ? tr('서버 처리 응답을 확인했습니다. 현재 구독·요청 상태는 이후 바뀔 수 있습니다.') : tr('요청을 시작하지 못했거나 서버가 거절했습니다. 기록을 닫고 최신 대기 목록에서 다시 준비해 주세요.')
        }
        return
      }
      const reader = new FirestoreReader(this.auth)
      try {
        const path = `${documents}/channels/${pending.channelId}`, channel = await reader.getDocument(path, signal)
        validate()
        if (!channel || stringField(channel.fields, 'ownerId', 160) !== this.uid) throw new Error('Owner unavailable')
        const join = await reader.getDocument(`${path}/joinRequests/${pending.userId}`, signal)
        const sub = await reader.getDocument(`${path}/subscribers/${pending.userId}`, signal)
        validate()
        const raw = join?.fields.status?.stringValue
        const label = !join ? tr('요청 기록 없음') : raw === 'pending' ? tr('승인 대기') : raw === 'denied' ? tr('거절 기록 있음') : raw === 'approved' ? tr('승인 기록 있음') : tr('요청 상태 미확인')
        this.value.message = tr('현재 조회 결과: {0}, 구독 기록 {1}. 각각 조회하는 동안에도 상태가 바뀔 수 있습니다. 이전 요청의 성공 증거로 사용하거나 재전송하지 않습니다.', [label, sub ? tr('있음') : tr('없음')])
      } catch { this.value.message = tr('현재 기록을 읽지 못했습니다. 연결·소유자 권한을 확인해 주세요. 이전 처리는 반복하지 않습니다.') }
      finally { reader.close() }
    })
  }
  async close(): Promise<void> { this.closed = true; this.pause(); await this.job?.catch(() => {}); this.value.pending = null }
}
