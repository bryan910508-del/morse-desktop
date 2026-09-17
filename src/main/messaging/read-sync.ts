import { historyReadable } from '../network/firestore-values'
import type { MessagePosition } from '../../shared/model'
import { comparePosition } from '../../shared/model'
import { idleReadSync, type ReadSyncState } from '../../shared/read-receipts'
import type { ReadDialog } from '../network/firestore-values'
import { ServerRejection } from '../network/contracts'
import type { ReadReceiptCommand, ReadReceiptStore, StoredReadReceipt } from '../storage/read-receipt-protocol'
import type { AccountAuthorization } from './outbox'
import { tr } from '../../shared/i18n'

interface Context { ready: boolean; foreground: boolean; dialogs: Map<string, ReadDialog> }
const terminal = new Set(['NOT_PARTICIPANT', 'INVALID_TARGET', 'INVALID_PAYLOAD', 'MESSAGE_NOT_FOUND'])
export class ManualReadBlocked extends Error {}

export class ReadSync {
  private closed = false
  private failed = false
  private generation = new AbortController()
  private task: Promise<void> | null = null
  private writes = new Set<Promise<unknown>>()
  private syncNeeded = true
  private rerun = false
  private wake?: ReturnType<typeof setTimeout>
  private retry = new Map<string, { at: number; attempts: number }>()
  private states = new Map<string, ReadSyncState>()
  private held = new Set<string>()
  private inFlight: string | null = null

  constructor(private readonly uid: string, private readonly auth: AccountAuthorization,
    private readonly storage: ReadReceiptStore, private readonly context: () => Context,
    private readonly changed: () => void) {}

  state(chatId: string): ReadSyncState {
    return this.failed ? { state: 'error', message: tr('읽음 위치를 저장하지 못했습니다. 앱을 다시 열어 주세요.') } : this.states.get(chatId) ?? idleReadSync
  }
  private publish(rows: StoredReadReceipt[]): void {
    if (this.closed) return
    const next = new Map(rows.map(row => [row.chatId, row.reason
      ? { state: 'error' as const, message: tr('이 메시지의 읽음 처리를 확인하지 못했습니다. 다음 수신 메시지를 확인하면 다시 동기화합니다.') }
      : row.pending ? { state: 'pending' as const, message: this.retry.has(row.chatId) ? tr('읽음 저장을 다시 시도하고 있습니다.') : tr('읽음 동기화 대기 중…') }
        : idleReadSync]))
    if (JSON.stringify([...next]) !== JSON.stringify([...this.states])) { this.states = next; this.changed() }
  }
  private active(signal: AbortSignal): boolean {
    const context = this.context()
    return !this.closed && !this.failed && !signal.aborted && !this.auth.signal.aborted &&
      this.auth.sender.ready && context.ready && context.foreground
  }
  private eligible(chatId: string, target: MessagePosition): boolean {
    const dialog = this.context().dialogs.get(chatId)
    return Boolean(!this.held.has(chatId) && dialog && historyReadable(dialog) && dialog.summary.kind !== 'secret' && dialog.summary.participantUids.includes(this.uid) &&
      (!dialog.cutoff || comparePosition(target, dialog.cutoff) >= 0))
  }
  private async store<T = void>(command: ReadReceiptCommand): Promise<T> {
    if (this.closed || this.failed) throw new Error(tr('읽음 저장소를 사용할 수 없습니다.'))
    const operation = this.storage<T>(command)
    this.writes.add(operation)
    try { return await operation }
    catch (error) {
      if (!this.closed) { this.failed = true; this.pause(); this.changed() }
      throw error
    } finally { this.writes.delete(operation) }
  }
  async observe(chatId: string, target: MessagePosition): Promise<boolean> {
    if (!this.active(this.generation.signal) || !this.eligible(chatId, target)) return false
    // Capture authorization was checked synchronously against the displayed
    // history. A later blur does not undo an observation already made.
    await this.store({ kind: 'read-enqueue', chatId, target })
    if (this.closed) return false
    this.kick()
    return true
  }
  async withManualChange(chatId: string, signal: AbortSignal, operation: () => Promise<void>): Promise<void> {
    if (this.closed || this.failed || this.held.has(chatId)) throw new ManualReadBlocked(tr('읽음 동기화 상태를 확인해 주세요.'))
    this.held.add(chatId)
    try {
      // Already-observed reads are not discarded or cancelled to make room for
      // a manual marker. An unconfirmed prior emission must settle first.
      await Promise.all([...this.writes])
      signal.throwIfAborted()
      if (this.inFlight === chatId) throw new ManualReadBlocked(tr('읽음 동기화가 진행 중입니다. 대화에서 동기화를 마친 뒤 다시 선택해 주세요.'))
      const rows = await this.store<StoredReadReceipt[]>({ kind: 'read-list' })
      signal.throwIfAborted()
      if (rows.some(row => row.chatId === chatId && row.pending)) throw new ManualReadBlocked(tr('확인되지 않은 읽음 동기화가 남아 있습니다. 대화를 열어 동기화를 마친 뒤 다시 선택해 주세요.'))
      await operation()
    } finally { this.held.delete(chatId); if (!this.closed) this.resume() }
  }
  pause(): void { this.generation.abort(); this.generation = new AbortController(); clearTimeout(this.wake) }
  resume(): void { this.syncNeeded = true; this.kick() }
  private kick(): void {
    if (!this.active(this.generation.signal)) return
    if (this.task) { this.rerun = true; return }
    clearTimeout(this.wake)
    const task = this.drain(this.generation.signal)
    this.task = task
    void task.catch(() => { /* store() exposes persistent storage failures */ }).finally(() => {
      if (this.task !== task) return
      this.task = null
      if (this.rerun) { this.rerun = false; this.kick() }
    })
  }
  private async drain(signal: AbortSignal): Promise<void> {
    while (this.active(signal)) {
      if (this.syncNeeded) {
        this.syncNeeded = false
        const authorities = [...this.context().dialogs.values()].filter(dialog => dialog.summary.kind !== 'secret')
          .map(dialog => ({ chatId: dialog.summary.id, cursor: historyReadable(dialog) ? dialog.summary.readPositions[this.uid] ?? null : null, cutoff: historyReadable(dialog) ? dialog.cutoff : null }))
        await this.store({ kind: 'read-sync', authorities })
        if (this.syncNeeded) continue
      }
      const rows = await this.store<StoredReadReceipt[]>({ kind: 'read-list' })
      if (!this.active(signal)) return
      this.publish(rows)
      if (this.syncNeeded) continue
      const pending = rows.filter(row => row.pending && this.eligible(row.chatId, row.observed))
      const row = pending.find(value => (this.retry.get(value.chatId)?.at ?? 0) <= Date.now())
      if (!row) {
        if (pending.length) {
          const next = Math.min(...pending.map(value => this.retry.get(value.chatId)?.at ?? Date.now()))
          this.wake = setTimeout(() => this.kick(), Math.max(1, next - Date.now()))
        }
        return
      }
      try {
        this.inFlight = row.chatId
        const ack = await this.auth.sender.markRead(row.chatId, row.observed, signal)
        if (!this.active(signal)) return
        // Atomic coverage check in the worker preserves any newer pending target.
        await this.store({ kind: 'read-confirm', chatId: row.chatId, cursor: ack.cursor })
        this.retry.delete(row.chatId)
      } catch (error) {
        if (!this.active(signal)) return
        if (error instanceof ServerRejection && terminal.has(error.reason)) {
          await this.store({ kind: 'read-reject', chatId: row.chatId, through: row.observed, reason: error.reason })
          this.retry.delete(row.chatId)
        } else {
          const attempts = Math.min(6, (this.retry.get(row.chatId)?.attempts ?? 0) + 1)
          this.retry.set(row.chatId, { at: Date.now() + Math.min(60000, 1000 * 2 ** attempts), attempts })
        }
      } finally { this.inFlight = null }
    }
  }
  async close(): Promise<void> {
    this.closed = true; this.pause()
    await this.task?.catch(() => {})
    await Promise.allSettled([...this.writes])
    this.states.clear(); this.retry.clear()
  }
}
