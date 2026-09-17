import type { DiscussionJoinAction, DiscussionJoinRequest, DiscussionJoinSnapshot, DiscussionJoinState, PendingDiscussionJoin } from '../../shared/channel-discussion-join'
import type { DiscussionJoinCommand } from '../storage/channel-discussion-join-table'
import { joinDiscussion } from '../network/channel-discussion-join'
import { ChannelAccessFailure } from '../network/channel-access-write'
import { FirestoreReader, type ReadCredentials } from '../network/firestore-rpc'
import { decodeDialog, documents, stringField } from '../network/firestore-values'
import { tr } from '../../shared/i18n'
export class ChannelDiscussionJoin {
  private closed = false
  private job: Promise<void> | null = null
  private abort: AbortController | null = null
  private value: DiscussionJoinSnapshot = { status: 'loading', busy: false, canSend: false, pending: null, message: '' }
  constructor(private readonly uid: string, private readonly auth: ReadCredentials, private readonly allowed: () => void,
    private readonly source: (request: DiscussionJoinRequest) => void,
    private readonly store: <T>(command: DiscussionJoinCommand, validate?: () => void) => Promise<T>, private readonly changed: () => void) {}
  get snapshot(): DiscussionJoinSnapshot {
    let canSend = false
    if (this.value.status === 'ready' && !this.value.busy && this.value.pending?.state === 'prepared') {
      try { this.validate(); this.source(this.value.pending); canSend = true } catch { /* Preserve a stale preparation for explicit dismissal. */ }
    }
    return { ...this.value, canSend, pending: this.value.pending ? { ...this.value.pending } : null }
  }
  pause(): void { this.abort?.abort() }
  private validate(): void { if (this.closed) throw new Error(tr('계정이 변경되었습니다.')); this.auth.signal.throwIfAborted(); this.allowed() }
  private publish(): void { if (!this.closed) this.changed() }
  private run(operation: (signal: AbortSignal) => Promise<void>): Promise<void> {
    this.validate()
    if (this.job) throw new Error(tr('진행 중인 토론방 참여 작업을 마쳐 주세요.'))
    const abort = new AbortController(); this.abort = abort; this.value.busy = true; this.value.message = ''
    const task = Promise.resolve().then(() => operation(abort.signal)).catch(error => {
      this.value.status = 'error'; this.value.message = tr('참여 기록을 다시 불러와 주세요. 초안·첨부·전송 대기와 같은 방의 나가기·채널 설정 기록을 먼저 정리해야 합니다.'); throw error
    }).finally(() => { if (this.job === task) this.job = null; if (this.abort === abort) this.abort = null; this.value.busy = false; this.publish() })
    this.job = task; this.publish(); return task
  }
  // async: a locked screen or a job still ending rejects instead of throwing into AccountSession.setConnection.
  async refresh(): Promise<void> {
    return this.run(async signal => {
      const validate = (): void => { signal.throwIfAborted(); this.validate() }
      const pending = await this.store<PendingDiscussionJoin | null>({ kind: 'discussion-join-read' }, validate)
      validate(); this.value.pending = pending; this.value.status = 'ready'
    })
  }
  prepare(request: DiscussionJoinRequest): Promise<void> {
    if (this.value.status !== 'ready' || this.value.pending) throw new Error(tr('이전 토론방 참여 기록을 먼저 확인해 주세요.'))
    this.source(request)
    return this.run(async signal => {
      const validate = (): void => { signal.throwIfAborted(); this.validate(); this.source(request) }
      this.value.pending = await this.store<PendingDiscussionJoin>({ kind: 'discussion-join-prepare', request }, validate)
      this.value.status = 'ready'; this.value.message = tr('참여할 토론방을 이 기기에 저장했습니다. 영향을 확인한 뒤 참여 요청을 눌러 주세요.')
    })
  }
  action(action: DiscussionJoinAction): Promise<void> {
    const pending = this.value.pending
    if (this.value.status !== 'ready' || !pending || pending.id !== action.id || pending.state !== action.state) throw new Error(tr('최신 토론방 참여 기록을 확인해 주세요.'))
    if (action.action === 'send' && pending.state !== 'prepared') throw new Error(tr('이미 제출한 참여 요청은 다시 보내지 않습니다.'))
    if (action.action === 'check' && !['submitted', 'confirmed'].includes(pending.state)) throw new Error(tr('제출한 참여 기록을 선택해 주세요.'))
    return this.run(async signal => {
      const validate = (): void => { signal.throwIfAborted(); this.validate() }
      const state = async (expected: DiscussionJoinState, next: DiscussionJoinState | 'dismissed'): Promise<void> => {
        this.value.pending = await this.store<PendingDiscussionJoin | null>({ kind: 'discussion-join-state', id: pending.id, expected, state: next }, validate)
      }
      if (action.action === 'dismiss') {
        await state(pending.state, 'dismissed'); this.value.message = tr('이 기기의 기록과 작성 잠금을 해제했습니다. 서버 참여를 취소하거나 토론방에서 나가지 않습니다.'); return
      }
      if (action.action === 'send') {
        this.source(pending)
        await state('prepared', 'submitted')
        let outcome: 'confirmed' | 'rejected' | null = null
        try {
          await joinDiscussion(this.auth, this.uid, pending, signal, () => { validate(); this.source(pending) })
          outcome = 'confirmed'
        } catch (error) {
          if (error instanceof ChannelAccessFailure && !error.uncertain) outcome = 'rejected'
          else this.value.message = tr('참여 요청이 반영되었을 수 있습니다. 다시 보내지 않습니다. 현재 접근 상태 확인은 이전 요청의 성공을 증명하지 않습니다.')
        }
        if (outcome) {
          await state('submitted', outcome)
          this.value.message = outcome === 'confirmed' ? tr('확인한 토론방 ID의 참여 응답을 받았습니다. 현재 참여·기록 공개·작성 조건은 이후 변경될 수 있습니다.') : tr('참여 요청을 시작하지 못했거나 서버가 거절했습니다. 기록을 닫고 최신 채널에서 다시 준비해 주세요.')
        }
        return
      }
      const reader = new FirestoreReader(this.auth)
      try {
        const doc = await reader.getDocument(`${documents}/chats/${pending.chatId}`, signal)
        validate()
        if (!doc || doc.name !== `${documents}/chats/${pending.chatId}` || doc.fields.isChannelDiscussion?.booleanValue !== true || stringField(doc.fields, 'channelId', 160) !== pending.channelId) throw new Error('Discussion scope unavailable')
        const chat = decodeDialog(doc, this.uid).summary
        if (chat.id !== pending.chatId || chat.kind !== 'group' || !chat.participantUids.includes(this.uid)) throw new Error('Current participation unavailable')
        this.value.message = tr('현재 이 토론방의 참여자로 조회됩니다. 이전 요청의 성공이나 기록·작성 권한을 판정하지 않으며 참여 요청을 반복하지 않습니다.')
      } catch { this.value.message = tr('현재 토론방 접근을 확인하지 못했습니다. 이전 참여 요청의 실패·취소를 뜻하지 않습니다. 요청을 반복하지 않습니다.') }
      finally { reader.close() }
    })
  }
  async close(): Promise<void> { this.closed = true; this.pause(); await this.job?.catch(() => {}); this.value.pending = null }
}
