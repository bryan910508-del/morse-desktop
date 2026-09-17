import { historyReadable } from '../network/firestore-values'
import type { ChatMessage, MessagePosition, Preferences } from '../../shared/model'
import { comparePosition } from '../../shared/model'
import type { NotificationHint } from '../../shared/notifications'
import { readCovers, readCursor } from '../../shared/read-receipts'
import type { NotificationCommand } from '../storage/notification-protocol'
import type { FirestoreReader } from '../network/firestore-rpc'
import { decodeMessage, documents, expiry, stringField, type FirestoreDocument, type ReadDialog } from '../network/firestore-values'
import { tr } from '../../shared/i18n'

export interface NotificationContent { chatId: string; title: string; body: string; silent: boolean }
export interface NotificationHost {
  preferences(): Preferences
  locked(): boolean
  foreground(chatId: string): boolean
  // The window is in front and being used (iOS «앱 사용 중»).
  appActive(): boolean
  show(content: NotificationContent, click: () => void, dismiss: () => void): (() => void) | null
  open(chatId: string): void
  report(message: string): void
}
interface Context { ready: boolean; reader: FirestoreReader | null; dialogs: Map<string, ReadDialog> }
interface Pending extends NotificationHint { at: number }
interface Displayed { doc: FirestoreDocument; position: MessagePosition; version: string; close(): void; stop(): void; timer?: ReturnType<typeof setTimeout> }
// The card keeps the post's first 180 characters, or the server's own words when the post has none.
export function channelPostNotice(doc: FirestoreDocument, fallbackTitle: string): { title: string; body: string } {
  const text = stringField(doc.fields, 'text', 1000).trim(), kind = stringField(doc.fields, 'mediaType', 32)
  const generic = text === '' || text === '새 게시물' || text === '새 사진 게시물' || text === '새 영상 게시물'
  const body = !generic ? text : kind === 'image' ? tr('📷 새 사진 게시물') : kind === 'video' ? tr('🎬 새 영상 게시물') : tr('새 게시물이 올라왔어요')
  return { title: stringField(doc.fields, 'channelName', 512).trim() || fallbackTitle, body }
}
const clean = (value: string, max: number) => value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').slice(0, max)

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
    private readonly claim: (command: NotificationCommand) => Promise<boolean>) {}

  receive(hint: NotificationHint): void {
    if (this.closed || this.ownerSignal.aborted || this.host.locked() || !this.host.preferences().notifications) return
    const key = `${hint.chatId}/${hint.id}`
    if (this.recent.has(key)) return
    this.recent.add(key)
    if (this.recent.size > 4096) this.recent.delete(this.recent.values().next().value!)
    if (this.pending.size >= 256) { this.host.report(tr('수신 알림이 많아 일부 표시를 생략했습니다. 대화 목록에서 확인해 주세요.')); return }
    this.pending.set(key, { ...hint, at: Date.now() }); this.kick()
  }
  private active(signal: AbortSignal): boolean {
    return !this.closed && !signal.aborted && !this.ownerSignal.aborted && this.context().ready &&
      !this.host.locked() && this.host.preferences().notifications
  }
  private message(doc: FirestoreDocument, chatId: string, suppressForeground = true): ChatMessage | null {
    const dialog = this.context().dialogs.get(chatId)
    if (!dialog || dialog.summary.kind === 'secret' || dialog.summary.muted || !dialog.summary.participantUids.includes(this.uid)) return null
    const message = decodeMessage(doc, dialog)
    // A channel post arrives as the server's «channelPost» card in the channel's discussion chat.
    const channelPost = Boolean(message && message.kind === 'channelPost' && message.system && dialog.summary.discussion)
    // MorsePushPreferences: 1:1, group and channel notifications apart, and none while the app is in use when that is off.
    const preferences = this.host.preferences()
    if ((channelPost ? !preferences.notifyChannel : dialog.summary.kind === 'group' ? !preferences.notifyGroup : !preferences.notifyPersonal) ||
      (!preferences.inAppNotifications && this.host.appActive())) return null
    if (!message || message.senderId === this.uid || message.encrypted || (message.system && !channelPost) || !message.readEligible || message.kind === 'unsupported' ||
        readCovers(dialog.summary.readPositions[this.uid], readCursor(message.position)) || (suppressForeground && this.host.foreground(chatId))) return null
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
    this.remove(hint.chatId)
    if (this.displayed.size >= 12) this.remove(this.displayed.keys().next().value!)
    const preview = this.host.preferences().showNotificationPreview
    const dialog = this.context().dialogs.get(hint.chatId)!
    const labels: Partial<Record<ChatMessage['kind'], string>> = { image: tr('사진'), video: tr('동영상'), voice: tr('음성 메시지'), file: tr('파일'), sticker: tr('스티커'), location: tr('위치'), event: tr('이벤트'), channelPost: tr('게시물', [], 'kind') }
    const body = message.kind === 'text' ? message.text : [labels[message.kind] || tr('메시지'), message.caption].filter(Boolean).join(' · ')
    const entry: Displayed = { doc, position: message.position, version: message.version, close: () => {}, stop: () => {} }
    this.displayed.set(hint.chatId, entry)
    // onChannelPostCreated's push: the channel's name over the post's words, or a line for a photo or video post.
    const post = message.kind === 'channelPost' ? channelPostNotice(doc, dialog.summary.title) : null
    const close = this.host.show({ chatId: hint.chatId, title: preview ? clean(post?.title ?? dialog.summary.title, 80) : 'Morse',
      body: post ? preview ? clean(post.body, 240) : tr('새 게시물이 올라왔어요') : preview ? clean(`${message.senderName ? `${message.senderName}: ` : ''}${body}`, 240) : tr('새 메시지가 도착했습니다.'), silent: message.silent === true || !this.host.preferences().notificationSound },
    () => {
      if (this.displayed.get(hint.chatId) !== entry || !this.active(signal) || !this.message(entry.doc, hint.chatId, false)) return
      this.remove(hint.chatId); this.host.open(hint.chatId)
    }, () => { if (this.displayed.get(hint.chatId) === entry) this.remove(hint.chatId) })
    if (!close || this.displayed.get(hint.chatId) !== entry) { close?.(); this.remove(hint.chatId); return }
    entry.close = close
    // Only displayed notifications own document subscriptions; history loading
    // never creates candidates. Edits/deletion withdraw an outdated preview.
    let loadingCount = 0
    entry.stop = reader.watch({ documents: { documents: [name] } }, signal, {
      snapshot: rows => {
        if (this.displayed.get(hint.chatId) !== entry) return
        try {
          const next = rows.get(name), decoded = next && this.message(next, hint.chatId)
          if (!decoded || decoded.version !== entry.version) this.remove(hint.chatId)
          else entry.doc = next!
        } catch { this.remove(hint.chatId) }
      }, state: state => {
        // The initial loading event is synchronous. Any later reset/retry loses
        // preview authority and withdraws the banner until a new message arrives.
        if ((state === 'error' || (state === 'loading' && ++loadingCount > 1)) && this.displayed.get(hint.chatId) === entry) this.remove(hint.chatId)
      }
    }, 1)
    if (this.displayed.get(hint.chatId) !== entry) { entry.stop(); return }
    const until = Math.min(60 * 60 * 1000, Math.max(1, (expiry(doc) ?? Date.now() + 60 * 60 * 1000) - Date.now()))
    entry.timer = setTimeout(() => { if (this.displayed.get(hint.chatId) === entry) this.remove(hint.chatId) }, until)
  }
  private remove(chatId: string): void {
    const item = this.displayed.get(chatId)
    if (!item) return
    this.displayed.delete(chatId); clearTimeout(item.timer); item.stop(); item.close()
  }
  resume(): void {
    for (const [chatId, entry] of this.displayed) {
      try { if (!this.active(this.generation.signal) || !this.message(entry.doc, chatId)) this.remove(chatId) }
      catch { this.remove(chatId) }
    }
    this.kick()
  }
  observed(chatId: string, position: MessagePosition): void {
    const item = this.displayed.get(chatId)
    if (item && readCovers(readCursor(position), readCursor(item.position))) this.remove(chatId)
  }
  pause(): void {
    this.generation.abort(); this.generation = new AbortController(); clearTimeout(this.wake); this.wake = undefined
    this.pending.clear(); for (const chatId of this.displayed.keys()) this.remove(chatId)
  }
  async close(): Promise<void> { this.closed = true; this.pause(); await this.task; this.recent.clear() }
}
