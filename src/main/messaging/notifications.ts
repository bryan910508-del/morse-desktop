import { historyReadable } from '../network/firestore-values'
import type { ChatMessage, MessagePosition, Preferences } from '../../shared/model'
import { comparePosition } from '../../shared/model'
import type { NotificationHint } from '../../shared/notifications'
import { readCovers, readCursor } from '../../shared/read-receipts'
import { alerting, notificationAlerts } from '../../shared/notification-alerts'
import type { NotificationCommand } from '../storage/notification-protocol'
import type { FirestoreReader } from '../network/firestore-rpc'
import { decodeMessage, documents, expiry, stringField, type FirestoreDocument, type ReadDialog } from '../network/firestore-values'
import { tr } from '../../shared/i18n'

export interface NotificationContent { chatId: string; title: string; body: string; silent: boolean }
export interface NotificationHost {
  preferences(): Preferences
  locked(): boolean
  // F-RT-004 (tdesktop System and Manager::getNotificationOptions, window/notifications_manager.cpp:1084-1088): what
  // drops a chat's notification — the app closing, the computer asleep — apart from what only hides its words, the app's
  // own lock (passcodeLocked → hideEverything). A screen locked by the system or a person away from the computer neither
  // drops nor hides it: the system's notification centre keeps it. Without them `locked` drops, as before.
  dropped?(): boolean
  hidden?(): boolean
  foreground(chatId: string): boolean
  // The window is in front and being used (iOS «앱 사용 중»).
  appActive(): boolean
  show(content: NotificationContent, click: () => void, dismiss: () => void): (() => void) | null
  // B378 ②: flash the taskbar button or bounce the Dock icon once for a new message (the shell skips a window in front).
  alert?(): void
  // F-MB-003: messageId when the notice is this account's own message — tdesktop opens exactly it (item->out(),
  // window/notifications_manager.cpp:1343-1346); otherwise the chat opens at its first unread.
  open(chatId: string, messageId?: string): void
  report(message: string): void
  // rh-3: why a shown notification was taken back (tap-check.log) — a reason code, never the chat or the message.
  withdrawn?(reason: string): void
}
// Who asked to look at the shown notifications again: the chat list's rebuild (a read on another device lands here),
// the window coming into use, a chat opened, the preferences, or a reconnect.
export type ResumeCause = 'list' | 'focus' | 'history' | 'preferences' | 'other'
interface Context { ready: boolean; reader: FirestoreReader | null; dialogs: Map<string, ReadDialog> }
interface Pending extends NotificationHint { at: number }
// What a shown notification says, so that only a change to it counts as an edit: the message's document also changes when
// it is marked delivered or read, gets a reaction, or the server finishes sending a scheduled one, and none of those make
// the words shown out of date (tdesktop takes a notification back only with its message, history.cpp:742).
interface Displayed { doc: FirestoreDocument; position: MessagePosition; shown: string; title: string; detailed: boolean; close(): void; stop(): void; timer?: ReturnType<typeof setTimeout> }
// The card keeps the post's first 180 characters, or the server's own words when the post has none.
export function channelPostNotice(doc: FirestoreDocument, fallbackTitle: string): { title: string; body: string } {
  const text = stringField(doc.fields, 'text', 1000).trim(), kind = stringField(doc.fields, 'mediaType', 32)
  const generic = text === '' || text === '새 게시물' || text === '새 사진 게시물' || text === '새 영상 게시물'
  const body = !generic ? text : kind === 'image' ? tr('📷 새 사진 게시물') : kind === 'video' ? tr('🎬 새 영상 게시물') : tr('새 게시물이 올라왔어요')
  return { title: stringField(doc.fields, 'channelName', 512).trim() || fallbackTitle, body }
}
const clean = (value: string, max: number) => value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').slice(0, max)
// The title and words of a message's notification: the chat (or the channel) over the message, or only that something came.
export function noticeText(message: ChatMessage, doc: FirestoreDocument, chatTitle: string, preview: boolean): { title: string; body: string } {
  // onChannelPostCreated's push: the channel's name over the post's words, or a line for a photo or video post.
  const post = message.kind === 'channelPost' ? channelPostNotice(doc, chatTitle) : null
  if (!preview) return { title: 'Morse', body: post ? tr('새 게시물이 올라왔어요') : tr('새 메시지가 도착했습니다.') }
  if (post) return { title: clean(post.title, 80), body: clean(post.body, 240) }
  return { title: clean(chatTitle, 80), body: clean(`${message.senderName ? `${message.senderName}: ` : ''}${messageWords(message)}`, 240) }
}
// A message's own words for a notice: its text, or what kind it is with its caption.
export function messageWords(message: ChatMessage): string {
  const labels: Partial<Record<ChatMessage['kind'], string>> = { image: tr('사진'), video: tr('동영상'), voice: tr('음성 메시지'), file: tr('파일'), sticker: tr('스티커'), location: tr('위치'), event: tr('이벤트'), channelPost: tr('게시물', [], 'kind') }
  return message.kind === 'text' ? message.text : [labels[message.kind] || tr('메시지'), message.caption].filter(Boolean).join(' · ')
}
export const cleanNotice = clean

export class AccountNotifications {
  private closed = false
  private generation = new AbortController()
  private pending = new Map<string, Pending>()
  private recent = new Set<string>()
  private displayed = new Map<string, Displayed>()
  private task: Promise<void> | null = null
  private wake?: ReturnType<typeof setTimeout>
  constructor(private readonly uid: string, private readonly ownerSignal: AbortSignal,
    private readonly context: () => Context, private readonly host: NotificationHost,
    private readonly claim: (command: NotificationCommand) => Promise<boolean>,
    // B545: this account's reaction notices, which go with its notifications (resume, reads, pause, close).
    private readonly reactions?: { resume(cause: ResumeCause): void; observed(chatId: string, position: MessagePosition): void; pause(): void; close(): void }) {}

  private dropped(): boolean { return this.host.dropped ? this.host.dropped() : this.host.locked() }
  receive(hint: NotificationHint): void {
    if (this.closed || this.ownerSignal.aborted || this.dropped() || !alerting(this.host.preferences())) return
    const key = `${hint.chatId}/${hint.id}`
    if (this.recent.has(key)) return
    this.recent.add(key)
    if (this.recent.size > 4096) this.recent.delete(this.recent.values().next().value!)
    if (this.pending.size >= 256) { this.host.report(tr('수신 알림이 많아 일부 표시를 생략했습니다. 대화 목록에서 확인해 주세요.')); return }
    this.pending.set(key, { ...hint, at: Date.now() }); this.kick()
  }
  private active(signal: AbortSignal): boolean {
    return !this.closed && !signal.aborted && !this.ownerSignal.aborted && this.context().ready &&
      !this.dropped() && alerting(this.host.preferences())
  }
  private message(doc: FirestoreDocument, chatId: string, suppressForeground = true): ChatMessage | null {
    const verdict = this.judge(doc, chatId, suppressForeground)
    return typeof verdict === 'string' ? null : verdict
  }
  // The message, or the reason it is not to be shown (rh-3: the reason goes into tap-check.log when a shown one is taken back).
  private judge(doc: FirestoreDocument, chatId: string, suppressForeground: boolean): ChatMessage | string {
    const dialog = this.context().dialogs.get(chatId)
    if (!dialog) return 'no-dialog'
    if (dialog.summary.kind === 'secret') return 'secret'
    if (!dialog.summary.participantUids.includes(this.uid)) return 'not-participant'
    const message = decodeMessage(doc, dialog)
    // F-RT-004: this account's own message the server sent at the time set for it is announced to its sender, even in a muted
    // chat and read or not (tdesktop computeSkipState showForMuted = item->out() && item->isFromScheduled(),
    // window/notifications_manager.cpp:348-350).
    const reminder = Boolean(message && message.senderId === this.uid && message.wasScheduled)
    if (dialog.summary.muted && !reminder) return 'muted'
    // A channel post arrives as the server's «channelPost» card in the channel's discussion chat.
    const channelPost = Boolean(message && message.kind === 'channelPost' && message.system && dialog.summary.discussion)
    // MorsePushPreferences: 1:1, group and channel notifications apart, and none while the app is in use when that is off.
    const preferences = this.host.preferences()
    if (channelPost ? !preferences.notifyChannel : dialog.summary.kind === 'group' ? !preferences.notifyGroup : !preferences.notifyPersonal) return 'kind-off'
    if (!preferences.inAppNotifications && this.host.appActive()) return 'in-app-off'
    if (!message || (message.senderId === this.uid && !reminder) || message.encrypted || (message.system && !channelPost && !message.memberService) || !message.readEligible || message.kind === 'unsupported') return 'not-notifiable'
    if (!reminder && readCovers(dialog.summary.readPositions[this.uid], readCursor(message.position))) return 'read-position'
    if (suppressForeground && this.host.foreground(chatId)) return 'foreground'
    return message
  }
  private kick(): void {
    for (const [key, item] of this.pending) if (Date.now() - item.at > 60000) this.pending.delete(key)
    if (this.task || this.wake || !this.pending.size || !this.active(this.generation.signal)) return
    // Unknown chats wait for the account's next consistent dialog snapshot.
    if (![...this.pending.values()].some(item => Boolean(this.context().dialogs.get(item.chatId) && historyReadable(this.context().dialogs.get(item.chatId)!)))) return
    // A short collection window coalesces bursts into the same bounded drain.
    this.wake = setTimeout(() => {
      this.wake = undefined
      const signal = AbortSignal.any([this.generation.signal, this.ownerSignal])
      const task = this.drain(signal).catch(() => {
        if (this.active(signal)) this.host.report(tr('알림을 확인하지 못했습니다. 대화 목록에서 확인해 주세요.'))
      }); this.task = task
      void task.finally(() => { if (this.task === task) this.task = null; this.kick() })
    }, 400)
  }
  private async drain(signal: AbortSignal): Promise<void> {
    while (this.active(signal)) {
      for (const [key, item] of this.pending) if (Date.now() - item.at > 60000) this.pending.delete(key)
      const batch = [...this.pending].filter(([, item]) => Boolean(this.context().dialogs.get(item.chatId) && historyReadable(this.context().dialogs.get(item.chatId)!))).slice(0, 4)
      if (!batch.length) return
      for (const [key] of batch) this.pending.delete(key)
      const results = await Promise.allSettled(batch.map(([, item]) => this.confirm(item, signal)))
      if (this.active(signal) && results.some(result => result.status === 'rejected')) this.host.report(tr('일부 알림의 저장 메시지를 확인하지 못했습니다. 대화 목록에서 확인해 주세요.'))
    }
  }
  private async confirm(hint: Pending, signal: AbortSignal): Promise<void> {
    const reader = this.context().reader
    const candidateDialog = this.context().dialogs.get(hint.chatId)
    if (!reader || !this.active(signal) || !candidateDialog || !historyReadable(candidateDialog)) return
    const name = `${documents}/chats/${hint.chatId}/messages/${hint.id}`
    const rows = await reader.query(`${documents}/chats/${hint.chatId}`, { from: [{ collectionId: 'messages' }],
      where: { fieldFilter: { field: { fieldPath: '__name__' }, op: 'EQUAL', value: { referenceValue: name } } }, limit: { value: 1 } }, signal)
    if (!this.active(signal) || Date.now() - hint.at > 60000 || rows.length !== 1 || rows[0]!.name !== name) return
    const doc = rows[0]!, message = this.message(doc, hint.chatId)
    if (!message || !message.version) return
    if (!await this.claim({ kind: 'notification-claim', chatId: hint.chatId, messageId: hint.id }) || !this.active(signal)) return
    // Re-evaluate reads, expiry, privacy and owner state after the storage await.
    if (!this.message(doc, hint.chatId)) return
    const previous = this.displayed.get(hint.chatId)
    if (previous && comparePosition(previous.position, message.position) >= 0) return
    // B378 ②: the flash goes by its own switch, before the toast and whether or not one shows.
    const alerts = notificationAlerts(this.host.preferences())
    if (alerts.flash) this.host.alert?.()
    if (!alerts.show) return
    this.remove(hint.chatId, 'replaced')
    if (this.displayed.size >= 12) this.remove(this.displayed.keys().next().value!, 'overflow')
    const preview = this.host.preferences().showNotificationPreview && !this.host.hidden?.()
    const title = this.context().dialogs.get(hint.chatId)!.summary.title
    const text = noticeText(message, doc, title, preview)
    const entry: Displayed = { doc, position: message.position, shown: `${text.title}\n${text.body}`, title, detailed: preview, close: () => {}, stop: () => {} }
    this.displayed.set(hint.chatId, entry)
    const close = this.host.show({ chatId: hint.chatId, title: text.title, body: text.body, silent: message.silent === true || !this.host.preferences().notificationSound },
    () => {
      if (this.displayed.get(hint.chatId) !== entry || !this.active(signal) || !this.message(entry.doc, hint.chatId, false)) return
      this.remove(hint.chatId, 'clicked'); this.host.open(hint.chatId, message.senderId === this.uid ? message.id : undefined)
    }, () => { if (this.displayed.get(hint.chatId) === entry) this.remove(hint.chatId, 'system-closed') })
    if (!close || this.displayed.get(hint.chatId) !== entry) { close?.(); this.remove(hint.chatId, 'not-shown'); return }
    entry.close = close
    // Only displayed notifications own document subscriptions; history loading
    // never creates candidates. Deletion, and an edit that changes what it says, withdraw an outdated preview.
    let loadingCount = 0
    const next = (doc: FirestoreDocument | undefined): ChatMessage | string => {
      if (!doc) return 'gone'
      const verdict = this.judge(doc, hint.chatId, true)
      if (typeof verdict === 'string') return verdict
      const text = noticeText(verdict, doc, entry.title, entry.detailed)
      return `${text.title}\n${text.body}` !== entry.shown ? 'edited' : verdict
    }
    entry.stop = reader.watch({ documents: { documents: [name] } }, signal, {
      snapshot: rows => {
        if (this.displayed.get(hint.chatId) !== entry) return
        try {
          const verdict = next(rows.get(name))
          if (typeof verdict === 'string') this.remove(hint.chatId, `watch:${verdict}`)
          else entry.doc = rows.get(name)!
        } catch { this.remove(hint.chatId, 'watch:error') }
      }, state: state => {
        // The initial loading event is synchronous. Any later reset/retry loses
        // preview authority and withdraws the banner until a new message arrives.
        if ((state === 'error' || (state === 'loading' && ++loadingCount > 1)) && this.displayed.get(hint.chatId) === entry) this.remove(hint.chatId, state === 'error' ? 'watch:error' : 'watch:reset')
      }
    }, 1)
    if (this.displayed.get(hint.chatId) !== entry) { entry.stop(); return }
    const until = Math.min(60 * 60 * 1000, Math.max(1, (expiry(doc) ?? Date.now() + 60 * 60 * 1000) - Date.now()))
    entry.timer = setTimeout(() => { if (this.displayed.get(hint.chatId) === entry) this.remove(hint.chatId, 'expired') }, until)
  }
  private remove(chatId: string, reason: string): void {
    const item = this.displayed.get(chatId)
    if (!item) return
    this.displayed.delete(chatId); clearTimeout(item.timer); item.stop(); item.close()
    this.host.withdrawn?.(reason)
  }
  resume(cause: ResumeCause = 'other'): void {
    for (const [chatId, entry] of this.displayed) {
      try {
        // A shown notification goes with the notifications themselves, even while the flash keeps messages looked at.
        if (!this.active(this.generation.signal) || !notificationAlerts(this.host.preferences()).show) { this.remove(chatId, `resume:${cause}:inactive`); continue }
        // The app locked after it was shown: its words go with it.
        if (entry.detailed && this.host.hidden?.()) { this.remove(chatId, `resume:${cause}:hidden`); continue }
        const verdict = this.judge(entry.doc, chatId, true)
        if (typeof verdict === 'string') this.remove(chatId, `resume:${cause}:${verdict}`)
      } catch { this.remove(chatId, `resume:${cause}:error`) }
    }
    this.reactions?.resume(cause)
    this.kick()
  }
  observed(chatId: string, position: MessagePosition): void {
    const item = this.displayed.get(chatId)
    if (item && readCovers(readCursor(position), readCursor(item.position))) this.remove(chatId, 'read-here')
    this.reactions?.observed(chatId, position)
  }
  pause(): void {
    this.generation.abort(); this.generation = new AbortController(); clearTimeout(this.wake); this.wake = undefined
    this.pending.clear(); for (const chatId of [...this.displayed.keys()]) this.remove(chatId, 'paused')
    this.reactions?.pause()
  }
  async close(): Promise<void> { this.closed = true; this.pause(); this.reactions?.close(); await this.task; this.recent.clear() }
}
