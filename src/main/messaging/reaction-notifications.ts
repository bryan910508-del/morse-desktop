import { createHash } from 'node:crypto'
import type { MessagePosition } from '../../shared/model'
import { readCovers, readCursor, type ReadCursor } from '../../shared/read-receipts'
import { alerting, notificationAlerts } from '../../shared/notification-alerts'
import type { NotificationCommand } from '../storage/notification-protocol'
import type { FirestoreReader } from '../network/firestore-rpc'
import { decodeMessage, documents, historyReadable, mapField, stringField, type FirestoreDocument, type ReadDialog } from '../network/firestore-values'
import { cleanNotice, messageWords, type NotificationHost } from './notifications'
import { tr } from '../../shared/i18n'
import { defaultReactionSettings, type ReactionSettings } from '../../shared/reaction-settings'

// B545 (contracts/B545-reaction-push.md §9, reports/desktop/2026-11-04-b545-desktop.md §3): a reaction to this account's
// message is announced from the room it is written on, chats/{id}.unseenReactionByUid[me], which the chat list already
// watches — the desktop's counterpart of the server's `reaction` push, which it does not receive. tdesktop announces a
// reaction as the message's reactions change (HistoryItem::updateReactions → CheckReactionNotificationSchedule,
// history/history_item.cpp:5467-5484, history/history_item_helpers.cpp:1307-1345). On since the server's (마″) deploy
// (11-05 07:11, with B545c: a reaction taken back clears its unseenReactionByUid entry, so the list's next look withdraws
// the notice as 'reaction-seen'); false turns the three pieces off again at once.
export const reactionNoticesEnabled = true

export interface ReactionHint { chatId: string; messageId: string; actorUid: string; emoji: string; version: number }
export { defaultReactionSettings, type ReactionSettings } from '../../shared/reaction-settings'
export function reactionSettingsOf(doc: FirestoreDocument | null | undefined): ReactionSettings {
  if (!doc) return defaultReactionSettings
  const fields = mapField(doc.fields, 'reactions')
  const source = (key: 'messages' | 'stories') => { const value = stringField(fields, key, 16); return value === 'nobody' || value === 'everyone' ? value : 'contacts' }
  const sound = stringField(fields, 'sound', 16)
  const shown = (fields.showSender as { booleanValue?: unknown } | undefined)?.booleanValue
  return {
    messages: source('messages'), stories: source('stories'),
    showSender: shown !== false,
    sound: sound === 'default' || sound === 'none' ? sound : null
  }
}

// The rooms whose unseen reaction has just changed. The first look only remembers (an account opening does not announce
// what it already had, as chat-top-notices.ts advancedTops), and a secret chat has none (the server writes none there).
export class ReactionNotices {
  private known = new Map<string, string>()
  private looked = false
  constructor(private readonly announce: (hint: ReactionHint) => void) {}
  observe(index: Map<string, ReadDialog>): void {
    const first = !this.looked
    this.looked = true
    for (const chatId of [...this.known.keys()]) if (!index.has(chatId)) this.known.delete(chatId)
    for (const [chatId, dialog] of index) {
      const unseen = dialog.summary.unseenReaction
      if (!unseen?.actorUid || dialog.summary.kind === 'secret') { this.known.delete(chatId); continue }
      const key = reactionKey(unseen.messageId, unseen.actorUid, unseen.reactionVersion), before = this.known.get(chatId)
      this.known.set(chatId, key)
      if (first || before === key) continue
      this.announce({ chatId, messageId: unseen.messageId, actorUid: unseen.actorUid, emoji: unseen.emoji, version: unseen.reactionVersion })
    }
  }
}
const reactionKey = (messageId: string, actorUid: string, version: number) => `${messageId}|${actorUid}|${version}`

// Whether the message document still has this person's reaction (contract §9: until B545c clears a taken-back reaction
// on the server, as tdesktop finds no unread reaction left just before it shows one, window/notifications_manager.cpp:953-968).
export function reactedBy(doc: FirestoreDocument, actorUid: string): boolean {
  const map = mapField(doc.fields, 'reactions')
  return Object.values(map).some(value => {
    const values = (value as { arrayValue?: { values?: unknown } }).arrayValue?.values
    return Array.isArray(values) && values.some(item => (item as { stringValue?: unknown })?.stringValue === actorUid)
  })
}

// The words, as the server's reaction push (morse-push-text.js reaction): who reacted, with what, to which message; or
// only that one came, when the sender is not to be shown, the words are hidden, or the name or the message is missing.
export function reactionNoticeText(chatTitle: string, name: string, emoji: string, preview: string, shown: boolean): { title: string; body: string } {
  if (!shown || !name.trim() || !preview.trim()) return { title: 'Morse', body: tr('새 반응') }
  return { title: cleanNotice(chatTitle, 80), body: cleanNotice(tr('{0}님이 {1} 반응: “{2}”', [name, emoji, preview]), 240) }
}

interface Shown { hint: ReactionHint; position: MessagePosition; read: ReadCursor | undefined; close(): void; stop(): void; timer?: ReturnType<typeof setTimeout> }
interface Context { ready: boolean; reader: FirestoreReader | null; dialogs: Map<string, ReadDialog>; reactions: ReactionSettings }
const hour = 60 * 60 * 1000

// One shown reaction a room (the server keeps one unseen reaction a room); the same person's reaction to the same message
// at most once an hour, as tdesktop (kReactionNotificationEach, window/notifications_manager.cpp:66, :293-309) — the phones
// replace theirs by the push's collapse key instead (contract §9).
export class ReactionNotifications {
  private closed = false
  private generation = new AbortController()
  private shown = new Map<string, Shown>()
  private sent = new Map<string, number>()
  constructor(private readonly uid: string, private readonly ownerSignal: AbortSignal, private readonly context: () => Context,
    private readonly host: NotificationHost, private readonly claim: (command: NotificationCommand) => Promise<boolean>,
    private readonly now: () => number = Date.now) {}

  private dropped(): boolean { return this.host.dropped ? this.host.dropped() : this.host.locked() }
  private active(signal: AbortSignal): boolean {
    return !this.closed && !signal.aborted && !this.ownerSignal.aborted && this.context().ready && !this.dropped() && alerting(this.host.preferences())
  }
  // The room's reason not to announce this reaction (contract §3, in its order), or the room.
  private room(hint: ReactionHint): ReadDialog | string {
    const dialog = this.context().dialogs.get(hint.chatId)
    if (!dialog || !historyReadable(dialog)) return 'no-dialog'
    if (dialog.summary.kind === 'secret') return 'secret'
    if (!dialog.summary.participantUids.includes(this.uid)) return 'not-participant'
    if (dialog.summary.muted) return 'muted'
    const unseen = dialog.summary.unseenReaction
    if (!unseen || reactionKey(unseen.messageId, unseen.actorUid ?? '', unseen.reactionVersion) !== reactionKey(hint.messageId, hint.actorUid, hint.version)) return 'reaction-seen'
    if (!this.host.preferences().inAppNotifications && this.host.appActive()) return 'in-app-off'
    if (this.host.foreground(hint.chatId)) return 'foreground'
    return dialog
  }
  receive(hint: ReactionHint): void {
    if (this.closed || this.ownerSignal.aborted || this.dropped() || !alerting(this.host.preferences()) || hint.actorUid === this.uid) return
    const signal = AbortSignal.any([this.generation.signal, this.ownerSignal])
    void this.confirm(hint, signal).catch(() => {})
  }
  private async confirm(hint: ReactionHint, signal: AbortSignal): Promise<void> {
    const context = this.context(), reader = context.reader, settings = context.reactions
    if (!reader || !this.active(signal) || typeof this.room(hint) === 'string' || settings.messages === 'nobody') return
    const pair = `${hint.chatId}|${hint.messageId}|${hint.actorUid}`, last = this.sent.get(pair)
    if (last !== undefined && this.now() - last < hour) return
    const name = `${documents}/chats/${hint.chatId}/messages/${hint.messageId}`
    const rows = await reader.query(`${documents}/chats/${hint.chatId}`, { from: [{ collectionId: 'messages' }],
      where: { fieldFilter: { field: { fieldPath: '__name__' }, op: 'EQUAL', value: { referenceValue: name } } }, limit: { value: 1 } }, signal)
    const [blocked, contact] = await Promise.all([
      reader.getDocument(`${documents}/users/${this.uid}/blocked/${hint.actorUid}`, signal),
      settings.messages === 'contacts' ? reader.getDocument(`${documents}/users/${this.uid}/contacts/${hint.actorUid}`, signal) : Promise.resolve(null)])
    if (!this.active(signal) || rows.length !== 1 || rows[0]!.name !== name || blocked || (settings.messages === 'contacts' && !contact)) return
    const doc = rows[0]!, room = this.room(hint)
    if (typeof room === 'string') return
    const message = decodeMessage(doc, room)
    if (!message || message.senderId !== this.uid || message.system || !reactedBy(doc, hint.actorUid)) return
    if (!await this.claim({ kind: 'notification-claim', chatId: hint.chatId, messageId: `r_${createHash('sha256').update(reactionKey(hint.messageId, hint.actorUid, hint.version)).digest('hex').slice(0, 40)}` }) || !this.active(signal)) return
    const again = this.room(hint)
    if (typeof again === 'string') return
    const alerts = notificationAlerts(this.host.preferences())
    if (alerts.flash) this.host.alert?.()
    if (!alerts.show) return
    this.remove(hint.chatId, 'replaced')
    for (const [key, at] of this.sent) if (this.now() - at >= hour) this.sent.delete(key)
    this.sent.set(pair, this.now())
    const preview = this.host.preferences().showNotificationPreview && !this.host.hidden?.()
    const text = reactionNoticeText(again.summary.title, again.participantNames[hint.actorUid] ?? '', hint.emoji, messageWords(message), preview && settings.showSender)
    const silent = settings.sound === 'none' || (settings.sound === null && !this.host.preferences().notificationSound)
    const entry: Shown = { hint, position: message.position, read: again.summary.readPositions[this.uid], close: () => {}, stop: () => {} }
    this.shown.set(hint.chatId, entry)
    const close = this.host.show({ chatId: hint.chatId, title: text.title, body: text.body, silent }, () => {
      if (this.shown.get(hint.chatId) !== entry || !this.active(signal)) return
      this.remove(hint.chatId, 'clicked'); this.host.open(hint.chatId, hint.messageId)
    }, () => { if (this.shown.get(hint.chatId) === entry) this.remove(hint.chatId, 'system-closed') })
    if (!close || this.shown.get(hint.chatId) !== entry) { close?.(); this.remove(hint.chatId, 'not-shown'); return }
    entry.close = close
    // The message going, or this person's reaction leaving it, takes the notice back (contract §6 messageDeleted).
    entry.stop = reader.watch({ documents: { documents: [name] } }, signal, {
      snapshot: rows => {
        if (this.shown.get(hint.chatId) !== entry) return
        const next = rows.get(name), room = this.context().dialogs.get(hint.chatId)
        if (!next) this.remove(hint.chatId, 'reaction:watch:gone')
        else if (!room || !decodeMessage(next, room)) this.remove(hint.chatId, 'reaction:watch:not-notifiable')
        else if (!reactedBy(next, hint.actorUid)) this.remove(hint.chatId, 'reaction:watch:taken-back')
      }, state: state => { if (state === 'error' && this.shown.get(hint.chatId) === entry) this.remove(hint.chatId, 'reaction:watch:error') }
    }, 1)
    entry.timer = setTimeout(() => { if (this.shown.get(hint.chatId) === entry) this.remove(hint.chatId, 'reaction:expired') }, hour)
  }
  private remove(chatId: string, reason: string): void {
    const item = this.shown.get(chatId)
    if (!item) return
    this.shown.delete(chatId); clearTimeout(item.timer); item.stop(); item.close()
    this.host.withdrawn?.(reason)
  }
  // The list again: seen on another device, the room gone, muted — and a read that moved forward in it over the message
  // (contract §6 A3). Only a new read takes it back: a reaction is to an older message of mine, always behind where the
  // room is already read, so looking at the stored read position again (focus, preferences) would take it back at once.
  resume(cause: 'list' | 'focus' | 'history' | 'preferences' | 'other'): void {
    for (const [chatId, entry] of this.shown) {
      if (!this.active(this.generation.signal) || !notificationAlerts(this.host.preferences()).show) { this.remove(chatId, `reaction:resume:${cause}:inactive`); continue }
      const room = this.room(entry.hint)
      if (typeof room === 'string' && room !== 'foreground' && room !== 'in-app-off') { this.remove(chatId, `reaction:resume:${cause}:${room}`); continue }
      if (cause !== 'list' || typeof room === 'string') continue
      const read = room.summary.readPositions[this.uid]
      if (read && JSON.stringify(read) !== JSON.stringify(entry.read) && readCovers(read, readCursor(entry.position))) this.remove(chatId, `reaction:resume:list:read`)
      else entry.read = read
    }
  }
  // This device read the room up to `position` just now.
  observed(chatId: string, position: MessagePosition): void {
    const item = this.shown.get(chatId)
    if (item && readCovers(readCursor(position), readCursor(item.position))) this.remove(chatId, 'reaction:read-here')
  }
  pause(): void {
    this.generation.abort(); this.generation = new AbortController()
    for (const chatId of [...this.shown.keys()]) this.remove(chatId, 'reaction:paused')
  }
  close(): void { this.closed = true; this.pause(); this.sent.clear() }
}
