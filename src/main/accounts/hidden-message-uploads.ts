import type { HiddenMessages } from './hidden-messages'
import { MorseCallableFailure } from '../network/morse-callable'
import { recordRetry } from '../platform/connection-diagnostics'

// B327b (contract §2-2, §3): «나에게만 삭제» goes to the server as Telegram's messages.deleteMessages without revoke —
// drawn here first, then a request kept until answered (tdesktop Histories::deleteMessages, data_histories.cpp:813-836,
// v7.3.1; TI's pending operation). hideMorseMessagesForMe takes a room's 1–100 ids at a time. What this device hid
// before the server kept a list goes the same way, once (its rows were never sent).
export type HideRoute = { kind: 'chat' | 'inquiry'; roomId: string } | 'local' | 'later'
export interface HideUploadSession { call(name: string, data: Record<string, unknown>, signal: AbortSignal): Promise<unknown> }
export type HideAnswer = 'done' | 'too-many' | 'unconfirmed'

// The server's answers that end a request: it will never take these ids. TOO_MANY_HIDDEN is the room's list being full.
export function hideRefusal(error: unknown): 'refused' | 'too-many' | 'account' | null {
  if (!(error instanceof MorseCallableFailure) || error.delivery !== 'answered') return null
  if (error.reason === 'TOO_MANY_HIDDEN') return 'too-many'
  if (error.reason === 'ACCOUNT_CHANGED') return 'account'
  if (['SECRET_CHAT', 'NOT_SUPPORTED', 'NOT_PARTICIPANT', 'CHAT_MISSING', 'INVALID_REQUEST'].includes(error.reason)) return 'refused'
  return error.status === 'INVALID_ARGUMENT' || error.status === 'PERMISSION_DENIED' ? 'refused' : null
}
// Again after 2 s, doubling to 5 minutes; the server's own wait (the account's hourly limit) where it gives one.
export function hideRetryDelay(attempt: number, retryAfterSec?: number): number {
  if (typeof retryAfterSec === 'number' && Number.isFinite(retryAfterSec) && retryAfterSec > 0) return Math.min(3600, retryAfterSec) * 1000
  return Math.min(300000, 2000 * 2 ** Math.max(0, attempt - 1))
}

export class HiddenMessageUploads {
  private task: Promise<void> | null = null
  private again = false
  private attempt = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private abort = new AbortController()
  private paused = true
  private closed = false
  private readonly waiters = new Set<{ chatId: string; ids: Set<string>; done(answer: HideAnswer): void }>()

  constructor(private readonly hidden: HiddenMessages, private readonly route: (chatId: string) => HideRoute,
    private readonly session: () => HideUploadSession | null, private readonly uid: string) {}

  // How the first request for these ids was answered; 'unconfirmed' while it waits for the network.
  answer(chatId: string, messageIds: string[]): Promise<HideAnswer> {
    if (this.closed || this.paused) return Promise.resolve('unconfirmed')
    return new Promise(done => { this.waiters.add({ chatId, ids: new Set(messageIds), done }); this.kick() })
  }
  kick(): void {
    if (this.closed || this.paused || this.timer) return
    if (this.task) { this.again = true; return }
    const task = this.drain().finally(() => { if (this.task === task) this.task = null; if (this.again) { this.again = false; this.kick() } })
    this.task = task
  }
  // The network is back: a wait ends now (Telegram SessionPrivate::restartNow).
  retryNow(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    this.kick()
  }
  pause(): void {
    this.paused = true
    this.abort.abort(); this.abort = new AbortController()
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    this.answerAll('unconfirmed')
  }
  resume(): void {
    if (this.closed) return
    this.paused = false
    this.kick()
  }
  async close(): Promise<void> {
    this.closed = true
    this.pause()
    await this.task?.catch(() => {})
  }
  private async drain(): Promise<void> {
    // The list is asked again for each request: an answer may have settled more than its own batch (a full room).
    const later = new Set<string>()
    for (;;) {
      const batch = this.hidden.pending().find(item => !later.has(item.chatId))
      if (!batch || this.closed || this.paused) return
      const route = this.route(batch.chatId)
      if (route === 'later') { later.add(batch.chatId); continue }
      if (route === 'local') { await this.hidden.settle(batch.chatId, batch.messageIds, 2).catch(() => {}); this.answer_(batch, 'done'); continue }
      const session = this.session()
      if (!session) return
      try {
        await session.call('hideMorseMessagesForMe', { kind: route.kind, roomId: route.roomId, messageIds: batch.messageIds, expectedUid: this.uid }, this.abort.signal)
        this.attempt = 0
        await this.hidden.settle(batch.chatId, batch.messageIds, 1).catch(() => {})
        this.answer_(batch, 'done')
      } catch (error) {
        if (this.closed || this.paused) return
        const refusal = hideRefusal(error)
        if (refusal === 'account') { this.pause(); return }
        if (refusal) {
          // Kept hidden here; the server will not take them. TOO_MANY_HIDDEN: the room's list is full, so the room's
          // others are not sent either (contract §6 — «기록 비우기(나에게만)» is the way).
          const room = refusal === 'too-many' ? this.hidden.pending().filter(item => item.chatId === batch.chatId) : [batch]
          for (const item of room) { await this.hidden.settle(item.chatId, item.messageIds, 2).catch(() => {}); this.answer_(item, refusal === 'too-many' ? 'too-many' : 'done') }
          continue
        }
        this.attempt++
        const wait = hideRetryDelay(this.attempt, error instanceof MorseCallableFailure ? error.retryAfterSec : undefined)
        recordRetry('hide-for-me', 'send', error, wait)
        this.answer_(batch, 'unconfirmed')
        this.timer = setTimeout(() => { this.timer = null; this.kick() }, wait)
        return
      }
    }
  }
  private answer_(batch: { chatId: string; messageIds: string[] }, answer: HideAnswer): void {
    for (const waiter of [...this.waiters]) if (waiter.chatId === batch.chatId && batch.messageIds.some(id => waiter.ids.has(id))) { this.waiters.delete(waiter); waiter.done(answer) }
  }
  private answerAll(answer: HideAnswer): void {
    for (const waiter of [...this.waiters]) { this.waiters.delete(waiter); waiter.done(answer) }
  }
}
