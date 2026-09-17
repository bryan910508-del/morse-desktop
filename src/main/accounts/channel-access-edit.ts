import { continuableAccessStates, type ChannelAccessAction, type ChannelAccessRequest, type ChannelAccessEditSnapshot, type ChannelAccessState, type PendingChannelAccess } from '../../shared/channel-access-edit'
import type { ChannelAccessCommand } from '../storage/channel-access-table'
import { ChannelAccessFailure } from '../network/channel-access-write'
import { syncChannelDiscussion } from '../network/channel-discussion-sync'
import { FirestoreReader, type ReadCredentials } from '../network/firestore-rpc'
import { documents, documentVersion, stringField, type FirestoreDocument } from '../network/firestore-values'
import { editableChannelAccess } from './channel-access'
import { tr } from '../../shared/i18n'

export class ChannelAccessEditor {
  private closed = false
  private job: Promise<void> | null = null
  private abort: AbortController | null = null
  private remoteChannel: string | null = null
  private value: ChannelAccessEditSnapshot = { status: 'loading', busy: false, canContinue: false, pending: null, message: '' }
  constructor(private readonly uid: string, private readonly auth: ReadCredentials, private readonly allowed: () => void,
    private readonly source: (channelId: string, version?: string) => FirestoreDocument,
    private readonly store: <T>(command: ChannelAccessCommand, validate?: () => void) => Promise<T>, private readonly changed: () => void) {}
  private validate(): void { if (this.closed) throw new Error(tr('계정이 변경되었습니다.')); this.auth.signal.throwIfAborted(); this.allowed() }
  private matches(doc: FirestoreDocument, request: ChannelAccessRequest, before: boolean): boolean {
    return doc.name === `${documents}/channels/${request.channelId}` && stringField(doc.fields, 'ownerId', 160) === this.uid &&
      JSON.stringify(editableChannelAccess(doc)) === JSON.stringify(before ? request.settings : request.next) &&
      (!before || (documentVersion(doc) === request.version && stringField(doc.fields, 'name', 512) === request.title))
  }
  private observed(request: ChannelAccessRequest, before: boolean): FirestoreDocument {
    this.validate()
    const doc = this.source(request.channelId, before ? request.version : undefined)
    if (!this.matches(doc, request, before)) throw new Error(tr('채널 설정이나 소유권이 변경되었습니다. 최신 정보에서 다시 준비해 주세요.'))
    return doc
  }
  get snapshot(): ChannelAccessEditSnapshot {
    const pending = this.value.pending
    let canContinue = false
    if (this.value.status === 'ready' && !this.value.busy && pending && continuableAccessStates.includes(pending.state)) {
      try { this.observed(pending, ['prepared', 'save-rejected'].includes(pending.state)); canContinue = true } catch { /* Keep stale preparations reviewable. */ }
    }
    return { ...this.value, canContinue, pending: pending ? { ...pending, settings: { ...pending.settings }, next: { ...pending.next } } : null }
  }
  pause(): void { this.abort?.abort() }
  prune(): void { if (this.remoteChannel) { try { this.validate(); this.source(this.remoteChannel) } catch { this.pause() } } }
  private publish(): void { if (!this.closed) this.changed() }
  private run(work: (signal: AbortSignal) => Promise<void>): Promise<void> {
    this.validate()
    if (this.job) throw new Error(tr('진행 중인 채널 설정 작업을 마쳐 주세요.'))
    const abort = new AbortController(); this.abort = abort; this.value.busy = true; this.value.message = ''
    const signal = AbortSignal.any([abort.signal, this.auth.signal, AbortSignal.timeout(210000)])
    const task = Promise.resolve().then(() => { signal.throwIfAborted(); return work(signal) }).catch(error => {
      this.value.status = 'error'; this.value.message = error instanceof Error ? error.message : tr('설정 기록을 확인하지 못했습니다. 다시 불러와 주세요.'); throw error
    }).finally(() => { if (this.job === task) this.job = null; if (this.abort === abort) this.abort = null; this.remoteChannel = null; this.value.busy = false; this.publish() })
    this.job = task; this.publish(); return task
  }
  // async: a locked screen or a job still ending rejects instead of throwing into AccountSession.setConnection.
  async refresh(): Promise<void> {
    return this.run(async signal => {
      const validate = () => { signal.throwIfAborted(); this.validate() }
      this.value.pending = await this.store<PendingChannelAccess | null>({ kind: 'channel-access-read' }, validate)
      validate(); this.value.status = 'ready'
    })
  }
  prepare(request: ChannelAccessRequest): Promise<void> {
    if (this.value.status !== 'ready' || this.value.pending) throw new Error(tr('이전 채널 설정 기록을 먼저 확인해 주세요.'))
    this.observed(request, true)
    return this.run(async signal => {
      this.value.pending = await this.store<PendingChannelAccess>({ kind: 'channel-access-prepare', request }, () => { signal.throwIfAborted(); this.observed(request, true) })
      this.value.status = 'ready'; this.value.message = tr('변경 내용을 기기에 보관했습니다. 영향과 진행 단계를 확인한 뒤 시작해 주세요.')
    })
  }
  private async fresh(request: ChannelAccessRequest, before: boolean, signal: AbortSignal): Promise<FirestoreDocument> {
    const reader = new FirestoreReader(this.auth)
    try {
      const doc = await reader.getDocument(`${documents}/channels/${request.channelId}`, signal)
      signal.throwIfAborted(); this.validate(); this.source(request.channelId)
      if (!doc || !this.matches(doc, request, before)) throw new Error('Changed settings')
      return doc
    } catch { throw new ChannelAccessFailure(false) }
    finally { reader.close() }
  }
  action(action: ChannelAccessAction): Promise<void> {
    const request = this.value.pending
    if (this.value.status !== 'ready' || !request || request.id !== action.id || request.state !== action.state) throw new Error(tr('최신 설정 기록을 확인해 주세요.'))
    if (action.action === 'continue' && !continuableAccessStates.includes(request.state)) throw new Error(tr('응답 미확인 단계는 다시 제출하지 않습니다.'))
    return this.run(async signal => {
      const validate = () => { signal.throwIfAborted(); this.validate() }
      const state = async (expected: ChannelAccessState, next: ChannelAccessState | 'dismissed') => {
        this.value.pending = await this.store<PendingChannelAccess | null>({ kind: 'channel-access-state', id: request.id, expected, state: next }, validate)
        this.publish()
      }
      if (action.action === 'dismiss') { await state(request.state, 'dismissed'); this.value.message = tr('기기 기록만 닫았습니다. 이미 요청한 저장·참여·동기화는 취소하지 않습니다.'); return }
      if (action.action === 'check') {
        const reader = new FirestoreReader(this.auth)
        try {
          const doc = await reader.getDocument(`${documents}/channels/${request.channelId}`, signal)
          validate()
          if (!doc || stringField(doc.fields, 'ownerId', 160) !== this.uid) throw new Error('Unavailable channel')
          this.value.message = JSON.stringify(editableChannelAccess(doc)) === JSON.stringify(request.next) ? tr('현재 설정이 준비한 값과 같습니다. 과거 저장이나 토론방·참여자 동기화의 성공을 증명하지 않으며 미확인 단계는 재제출하지 않습니다.') : tr('현재 설정이 준비한 값과 다릅니다. 이후 변경이 있었을 수 있으며 과거 처리 결과를 확정하지 않습니다.')
        } catch { this.value.message = tr('현재 설정을 확인하지 못했습니다. 접근 권한·연결 문제와 과거 처리 결과를 구분해 주세요.') }
        finally { reader.close() }
        return
      }
      this.remoteChannel = request.channelId
      while (this.value.pending && continuableAccessStates.includes(this.value.pending.state)) {
        const current = this.value.pending.state
        if (current === 'prepared' && request.mode === 'sync') {
          await this.fresh(request, true, signal)
          await state(current, 'settings-ready'); continue
        }
        const phase = ['prepared', 'save-rejected'].includes(current) ? 'save' : ['settings-ready', 'join-rejected'].includes(current) ? 'join' : 'sync'
        const submitted = phase === 'save' ? 'saving' : phase === 'join' ? 'joining' : 'syncing'
        const completed = phase === 'save' ? 'settings-ready' : phase === 'join' ? 'discussion-ready' : 'completed'
        await state(current, submitted)
        let outcome: 'confirmed' | 'rejected' | 'uncertain' = 'uncertain'
        try {
          if (phase === 'save') {
            const reader = new FirestoreReader(this.auth)
            try { await reader.setChannelAccess(this.uid, request, signal, () => this.observed(request, true)) }
            finally { reader.close() }
          } else {
            const doc = await this.fresh(request, false, signal)
            const discussionId = stringField(doc.fields, 'discussionChatId', 160)
            if (phase === 'sync' && !discussionId) throw new ChannelAccessFailure(false)
            await syncChannelDiscussion(this.auth, request.channelId, phase, signal, () => { validate(); this.source(request.channelId) }, discussionId || `channel_discuss_${request.channelId}`)
          }
          outcome = 'confirmed'
        } catch (error) { if (error instanceof ChannelAccessFailure && !error.uncertain) outcome = 'rejected' }
        if (outcome === 'confirmed') { await state(submitted, completed); continue }
        if (outcome === 'rejected') {
          await state(submitted, phase === 'save' ? 'save-rejected' : phase === 'join' ? 'join-rejected' : 'sync-rejected')
          this.value.message = tr('이 단계는 시작하지 못했거나 서버가 거절했습니다. 앞서 확인한 단계는 유지됩니다. 최신 설정을 확인한 뒤 명시적으로 남은 단계를 다시 진행할 수 있습니다.')
        } else this.value.message = tr('이 단계의 응답을 확인하지 못했습니다. 이미 처리되었을 수 있어 다시 제출하지 않습니다. 현재 설정 조회는 과거 성공 증명과 구분합니다.')
        return
      }
      this.value.message = tr('모든 단계의 응답을 확인했습니다. 이후 다른 기기의 변경과 현재 서버 상태는 별도로 확인해 주세요.')
    })
  }
  async close(): Promise<void> { this.closed = true; this.pause(); await this.job?.catch(() => {}); this.value.pending = null }
}
