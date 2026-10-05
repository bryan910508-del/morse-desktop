import { millisDown, type HistoryClearRequest, type HistoryClearUpTo } from '../../shared/history-clears'
import type { HistoryClearCommand, StoredHistoryClear } from '../storage/history-clear-table'
import { MorseCallableFailure } from '../network/morse-callable'
import { recordRetry } from '../platform/connection-diagnostics'
import { tr } from '../../shared/i18n'

// A room's history cleared for everyone, carried out the way Telegram carries messages.deleteHistory (A4 contract,
// telegram-refs R-3): the boundary is fixed when the person presses and kept on the device with the request
// (MessagesController pending task with max_id), and the request goes again with that same boundary until the server
// answers — at once when the network comes back (network/reachability.ts), otherwise after 2 s doubling to a minute.
// The server takes the boundary as that message's own time and never moves a boundary back, so a request whose answer
// was lost can go again without clearing anything the person had not seen. That holds only on a server that takes a
// fixed boundary: one that answers with `applied` (A4 §7-2). Until one has, a request whose answer was lost is held,
// not sent again. A request that never left always goes again. The server's refusal ends the request.
// How «대화 삭제» reaches the server for a chat (session.ts deleteChat). B113: the official notice chat is cleared for its
// one reader by clearMorseChatHistory, which takes type 'system' (morse-release-authority.js:583-590) — its document is
// the server's alone (firestore.rules refuses a client delete or update), so neither a pair's history delete nor a
// document delete is sent; it leaves the list emptied and comes back with the next notice, as Telegram's 777000 does.
export type ChatDeleteRoute = 'hide' | 'direct-delete' | 'document' | 'service-clear'
export function chatDeleteRoute(dialog: { kind: string; service?: true }, forEveryone: boolean): ChatDeleteRoute {
  if (dialog.service) return 'service-clear'
  if (!forEveryone) return 'hide'
  return dialog.kind === 'direct' ? 'direct-delete' : 'document'
}
export function historyClearRetryDelay(attempt: number): number { return Math.min(60000, 2000 * 2 ** Math.max(0, attempt - 1)) }

export interface HistoryClearSession {
  // The newest message of a chat at or before `seen` (the room's last message as the person saw it), after the room's
  // current boundary; null when there is none.
  newest(chatId: string, seen: { seconds: number; nanoseconds: number }, signal: AbortSignal): Promise<{ id: string; seconds: number; nanoseconds: number } | null>
  call(name: string, data: Record<string, unknown>, signal: AbortSignal): Promise<Record<string, unknown>>
}
type Outcome = { done: number | null } | { refused: string } | { again: unknown; held: boolean }
const callables: Record<HistoryClearRequest['kind'], string> = { 'chat-clear': 'clearMorseChatHistory', 'direct-delete': 'deleteDirectChatHistory', 'inquiry-clear': 'clearMorseInquiryHistory' }
const failure = (kind: HistoryClearRequest['kind']): string => kind === 'direct-delete' ? tr('대화를 삭제하지 못했습니다.') : tr('대화 기록을 삭제하지 못했습니다.')
// Whether a request may go now: a held one only with its boundary, once the server is known to take one.
const sendable = (row: StoredHistoryClear, applies: boolean): boolean => row.state === 'queued' || (applies && row.request.upTo !== null)

export class HistoryClears {
  private rows: StoredHistoryClear[] = []
  private applies = false
  private loaded = false
  private closed = false
  private task: Promise<void> | null = null
  private rerun = false
  private generation = new AbortController()
  private readonly retries = new Map<string, { attempt: number; at: number }>()
  // Whoever pressed waits for the first try only: 'done', or 'unconfirmed' while the queue carries on.
  private readonly waiting = new Map<string, { resolve(value: 'done' | 'unconfirmed'): void; reject(error: Error): void }>()
  private wake: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly allowed: () => void, private readonly store: <T>(command: HistoryClearCommand) => Promise<T>,
    private readonly open: () => HistoryClearSession,
    // A request that is over: the server's boundary in milliseconds when it cleared, null when there was nothing to clear.
    private readonly settled: (request: HistoryClearRequest, cutoff: number | null, done: boolean) => void = () => {}) {}

  async load(): Promise<void> {
    await this.reload()
    this.loaded = true
    this.kick()
  }
  // A new clear for a room replaces one of the same kind still waiting there: its boundary is later.
  async enqueue(request: HistoryClearRequest): Promise<'done' | 'unconfirmed'> {
    if (this.closed) throw new Error(tr('계정이 변경되었습니다.'))
    if (!this.loaded) await this.load()
    const replaces = this.rows.filter(row => row.request.kind === request.kind && row.request.targetId === request.targetId).map(row => row.request.id)
    await this.store({ kind: 'history-clear-put', request, replaces, createdAt: Date.now() })
    for (const id of replaces) { this.retries.delete(id); this.answer(id, 'unconfirmed') }
    const first = new Promise<'done' | 'unconfirmed'>((resolve, reject) => this.waiting.set(request.id, { resolve, reject }))
    await this.reload(); this.kick()
    // Not connected, or the screen locked: it is kept and goes when the queue can send.
    if (!this.active(this.generation.signal)) this.answer(request.id, 'unconfirmed')
    return first
  }
  // The network is back: what waits goes now, its waits started over.
  retryNow(): void { this.retries.clear(); this.unschedule(); this.kick() }
  pause(): void {
    this.generation.abort(); this.generation = new AbortController(); this.retries.clear(); this.unschedule()
    for (const id of [...this.waiting.keys()]) this.answer(id, 'unconfirmed')
  }
  resume(): void { this.kick() }
  async close(): Promise<void> {
    this.closed = true; this.pause()
    await this.task?.catch(() => {})
  }

  private async reload(): Promise<void> {
    const list = await this.store<{ applies: boolean; rows: StoredHistoryClear[] }>({ kind: 'history-clear-list' })
    this.rows = list.rows; this.applies = list.applies
  }
  private answer(id: string, value: 'done' | 'unconfirmed' | Error): void {
    const waiter = this.waiting.get(id)
    if (!waiter) return
    this.waiting.delete(id)
    if (value instanceof Error) waiter.reject(value); else waiter.resolve(value)
  }
  private unschedule(): void { if (this.wake) { clearTimeout(this.wake); this.wake = null } }
  private active(signal: AbortSignal): boolean {
    if (this.closed || signal.aborted) return false
    try { this.allowed(); return true } catch { return false }
  }
  private kick(): void {
    if (!this.loaded || !this.active(this.generation.signal)) return
    if (this.task) { this.rerun = true; return }
    const task = this.drain(this.generation.signal)
    this.task = task
    void task.catch(() => {}).finally(() => {
      if (this.task !== task) return
      this.task = null
      if (this.rerun) { this.rerun = false; this.kick() }
    })
  }
  private next(now: number): StoredHistoryClear | null {
    return this.rows.find(row => sendable(row, this.applies) && (this.retries.get(row.request.id)?.at ?? 0) <= now) ?? null
  }
  private async drain(signal: AbortSignal): Promise<void> {
    while (this.active(signal)) {
      const row = this.next(Date.now())
      if (!row) {
        const due = this.rows.filter(item => sendable(item, this.applies)).map(item => this.retries.get(item.request.id)?.at ?? 0).filter(at => at > Date.now())
        this.unschedule()
        if (due.length) this.wake = setTimeout(() => { this.wake = null; this.kick() }, Math.max(50, Math.min(...due) - Date.now()))
        return
      }
      await this.attempt(row.request, signal)
      await this.reload()
    }
  }
  private async attempt(request: HistoryClearRequest, signal: AbortSignal): Promise<void> {
    let outcome: Outcome, sent = request
    try { ({ outcome, sent } = await this.perform(request, signal)) }
    catch (error) { outcome = { again: error, held: false } }
    if (!this.active(signal) && !('done' in outcome) && !('refused' in outcome)) return
    if ('done' in outcome) {
      await this.store({ kind: 'history-clear-remove', id: request.id })
      this.retries.delete(request.id); this.settled(sent, outcome.done, true); this.answer(request.id, 'done')
    } else if ('refused' in outcome) {
      await this.store({ kind: 'history-clear-remove', id: request.id })
      this.retries.delete(request.id); this.settled(sent, null, false); this.answer(request.id, new Error(outcome.refused))
    } else {
      const attempt = (this.retries.get(request.id)?.attempt ?? 0) + 1
      recordRetry(`history-${request.kind}`, 'send', outcome.again, outcome.held ? undefined : historyClearRetryDelay(attempt))
      if (outcome.held) await this.store({ kind: 'history-clear-update', request: sent, state: 'held' })
      this.retries.set(request.id, { attempt, at: Date.now() + historyClearRetryDelay(attempt) })
      this.answer(request.id, 'unconfirmed')
    }
  }
  private async perform(request: HistoryClearRequest, signal: AbortSignal): Promise<{ outcome: Outcome; sent: HistoryClearRequest }> {
    const session = this.open()
    let sent = request
    // The first send finds the message the person saw last and keeps it: every later send carries the same boundary.
    if (!sent.upTo && sent.seen && sent.kind !== 'inquiry-clear') {
      const newest = await session.newest(sent.targetId, sent.seen, signal)
      // Nothing left at or before what the person saw: the room is already cleared that far.
      if (!newest) return { outcome: { done: null }, sent }
      const upTo: HistoryClearUpTo = { messageId: newest.id, createdAtMillis: millisDown(newest) }
      sent = { ...sent, upTo }
      await this.store({ kind: 'history-clear-update', request: sent, state: 'queued' })
    }
    const data: Record<string, unknown> = sent.kind === 'inquiry-clear' ? { inquiryId: sent.targetId } : { chatId: sent.targetId }
    if (sent.upTo) data.upTo = sent.upTo
    try {
      const result = await session.call(callables[sent.kind], data, signal)
      if (typeof result.applied === 'boolean' && !this.applies) { this.applies = true; await this.store({ kind: 'history-clear-server-applies' }).catch(() => {}) }
      return { outcome: { done: typeof result.cutoff === 'number' && Number.isFinite(result.cutoff) ? result.cutoff : null }, sent }
    } catch (error) {
      if (error instanceof MorseCallableFailure && error.delivery === 'answered') return { outcome: { refused: failure(sent.kind) }, sent }
      // An answer lost: sent again only with a boundary, and only to a server known to take one.
      const uncertain = error instanceof MorseCallableFailure && error.uncertain
      return { outcome: { again: error, held: uncertain && !(this.applies && sent.upTo) }, sent }
    }
  }
}
