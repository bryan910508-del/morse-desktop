import type { ManualUnreadRequest, ManualUnreadSnapshot } from '../../shared/manual-unread'
import { effectiveUnreadCount } from '../../shared/manual-unread'
import { FirestoreReader, type ReadCredentials } from '../network/firestore-rpc'
import { decodeDialog, documents } from '../network/firestore-values'
import { ManualUnreadFailure, setManualUnread } from '../network/manual-unread-api'
import { ManualReadBlocked } from '../messaging/read-sync'
import { tr } from '../../shared/i18n'

interface Attempt { request: ManualUnreadRequest; value: ManualUnreadSnapshot; task: Promise<void> }
export class ManualUnread {
  private closed = false
  private latest: Attempt | null = null
  private attempts = new Map<string, Attempt>()
  private active: { attempt: Attempt; abort: AbortController; task: Promise<void> } | null = null
  constructor(private readonly uid: string, private readonly auth: ReadCredentials,
    private readonly validate: (request: ManualUnreadRequest, exact: boolean) => void,
    private readonly guard: (chatId: string, signal: AbortSignal, operation: () => Promise<void>) => Promise<void>,
    private readonly changed: () => void) {}
  get snapshot(): ManualUnreadSnapshot | null { return this.latest ? { ...this.latest.value } : null }
  canChange(chatId: string): boolean { return !this.closed && !this.active && this.attempts.get(chatId)?.value.state !== 'uncertain' }
  needsCheck(chatId: string): boolean { return !this.closed && !this.active && this.attempts.get(chatId)?.value.state === 'uncertain' }
  private publish(): void { if (!this.closed) this.changed() }
  pause(): void { this.active?.abort.abort() }
  prune(): void {
    if (!this.active) return
    try { this.validate(this.active.attempt.request, false) } catch { this.pause() }
  }
  set(request: ManualUnreadRequest): Promise<void> {
    if (this.closed) throw new Error(tr('계정을 다시 연결해 주세요.'))
    const previous = this.attempts.get(request.chatId)
    if (previous?.request.id === request.id) {
      if (JSON.stringify(previous.request) !== JSON.stringify(request)) throw new Error(tr('같은 요청의 내용을 변경할 수 없습니다.'))
      return previous.task
    }
    if (!this.canChange(request.chatId) || [...this.attempts.values()].some(item => item.request.id === request.id)) throw new Error(tr('이전 읽음 요청의 결과를 먼저 확인해 주세요.'))
    this.validate(request, true)
    const abort = new AbortController()
    const attempt: Attempt = { request, task: Promise.resolve(), value: { id: request.id, chatId: request.chatId, markedUnread: request.markedUnread,
      state: 'saving', checking: false, message: tr('읽음 동기화를 확인하고 표시를 변경하고 있습니다…') } }
    this.attempts.set(request.chatId, attempt); this.latest = attempt
    const task = this.write(attempt, abort.signal).finally(() => { if (this.active?.abort === abort) this.active = null; this.publish() })
    attempt.task = task; this.active = { attempt, abort, task }; this.publish()
    return task
  }
  private async write(attempt: Attempt, signal: AbortSignal): Promise<void> {
    try {
      await this.guard(attempt.request.chatId, signal, () => setManualUnread(this.auth, attempt.request.chatId, attempt.request.markedUnread, signal, () => this.validate(attempt.request, true)))
      attempt.value.state = 'saved'; attempt.value.message = attempt.request.markedUnread ? tr('읽지 않음 표시를 저장했습니다. 목록은 서버 상태로 갱신됩니다.') : tr('읽음 처리를 저장했습니다. 목록은 서버 상태로 갱신됩니다.')
    } catch (error) {
      attempt.value.state = error instanceof ManualUnreadFailure && error.uncertain ? 'uncertain' : 'rejected'
      attempt.value.message = error instanceof ManualUnreadFailure || error instanceof ManualReadBlocked ? error.message : tr('변경을 시작하지 못했습니다. 연결과 최신 대화 상태를 확인해 주세요.')
    }
  }
  check(chatId: string): Promise<void> {
    const attempt = this.attempts.get(chatId)
    if (this.closed || this.active || !attempt) throw new Error(tr('읽음 요청과 연결 상태를 확인해 주세요.'))
    this.validate(attempt.request, false)
    const abort = new AbortController(); this.latest = attempt; attempt.value.checking = true
    const task = this.read(attempt, abort.signal).finally(() => { attempt.value.checking = false; if (this.active?.abort === abort) this.active = null; this.publish() })
    this.active = { attempt, abort, task }; this.publish()
    return task
  }
  private async read(attempt: Attempt, signal: AbortSignal): Promise<void> {
    let reader: FirestoreReader | null = null
    try {
      reader = new FirestoreReader(this.auth)
      const doc = await reader.getDocument(`${documents}/chats/${attempt.request.chatId}`, signal)
      signal.throwIfAborted(); this.validate(attempt.request, false)
      if (!doc) throw new Error('Missing chat')
      const dialog = decodeDialog(doc, this.uid).summary
      if (dialog.kind === 'secret' || dialog.id !== attempt.request.chatId) throw new Error('Chat scope mismatch')
      // There is no server operation receipt. A matching Boolean cannot prove
      // which client changed it, or prove that an earlier request was cancelled.
      attempt.value.state = 'observed'
      attempt.value.message = tr('조회한 현재 상태: {0}, 미읽음 {1}개. 이전 요청의 성공 여부를 확정한 것은 아닙니다.', [dialog.markedUnread ? tr('수동 읽지 않음 표시 있음') : tr('수동 읽지 않음 표시 없음'), effectiveUnreadCount(dialog)])
    } catch { attempt.value.message = tr('현재 읽음 상태를 조회하지 못했습니다. 자동으로 다시 변경하지 않습니다. 연결 후 다시 확인해 주세요.') }
    finally { reader?.close() }
  }
  async close(): Promise<void> { this.closed = true; this.pause(); await this.active?.task; this.attempts.clear(); this.latest = null }
}
