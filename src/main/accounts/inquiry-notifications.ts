import type { Preferences } from '../../shared/model'
import type { NotificationContent } from '../messaging/notifications'
import { tr } from '../../shared/i18n'

// A room's new message reaches the other side as a push on iOS (MorsePushNotificationService). This window follows
// every room of the account itself (ChannelInquiryService listenToSubscriberInquiries / listenToAllOwnerInquiries),
// so it shows the banner a chat's message shows, from what the room document already says: its newest message, who
// sent it and whether this side has read it.
//
// Only what arrives while the window is running is announced. What was already waiting when the account opened is
// the unread badge's business, exactly as Data::Session does not re-announce history on connect.
export interface InquiryNotice { inquiryId: string; channelId: string; title: string; preview: string; at: number; unread: number; fromMe: boolean }
export interface InquiryNotificationHost {
  preferences(): Preferences
  locked(): boolean
  appActive(): boolean
  // The room whose messages are being read right now shows no banner, as an open chat shows none.
  foreground(inquiryId: string): boolean
  show(content: NotificationContent, click: () => void, dismiss: () => void): (() => void) | null
  open(channelId: string, inquiryId: string): void
}
const clean = (value: string, max: number): string => value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').slice(0, max)
const maxShown = 8

export class InquiryNotifications {
  private readonly seen = new Map<string, number>()
  private readonly shown = new Map<string, { at: number; close(): void }>()
  private since = 0
  private known = false
  private closed = false
  constructor(private readonly host: InquiryNotificationHost, private readonly now: () => number = Date.now) {}

  observe(rooms: InquiryNotice[]): void {
    if (this.closed) return
    const alive = new Set(rooms.map(room => room.inquiryId))
    for (const [id, entry] of this.shown) if (!alive.has(id)) { entry.close(); this.shown.delete(id) }
    for (const id of [...this.seen.keys()]) if (!alive.has(id)) this.seen.delete(id)
    // The first list of a run only records where each room stands.
    if (!this.known) {
      this.known = true; this.since = this.now()
      for (const room of rooms) this.seen.set(room.inquiryId, room.at)
      return
    }
    for (const room of rooms) {
      const before = this.seen.get(room.inquiryId)
      this.seen.set(room.inquiryId, room.at)
      // Only a message that arrived while this window was watching: a room entering the list carries its history.
      if (!room.at || room.at <= this.since || (before !== undefined && room.at <= before)) continue
      // A room this side has read, or whose newest message is this side's own, announces nothing.
      if (room.fromMe || room.unread <= 0) { this.withdraw(room.inquiryId); continue }
      this.announce(room)
    }
  }
  private withdraw(inquiryId: string): void {
    const entry = this.shown.get(inquiryId)
    if (!entry) return
    this.shown.delete(inquiryId); entry.close()
  }
  private announce(room: InquiryNotice): void {
    const preferences = this.host.preferences()
    // A 1:1 inquiry is a personal conversation: MorsePushPreferences keeps those under «개인».
    if (this.host.locked() || !preferences.notifications || !preferences.notifyPersonal) return
    if (!preferences.inAppNotifications && this.host.appActive()) return
    if (this.host.foreground(room.inquiryId)) return
    this.withdraw(room.inquiryId)
    if (this.shown.size >= maxShown) this.withdraw(this.shown.keys().next().value!)
    const preview = preferences.showNotificationPreview
    const entry = { at: room.at, close: () => {} }
    this.shown.set(room.inquiryId, entry)
    const close = this.host.show({
      chatId: room.inquiryId,
      title: preview ? clean(room.title || tr('1:1 문의'), 80) : 'Morse',
      body: preview ? clean(room.preview || tr('새 메시지가 도착했습니다.'), 240) : tr('새 메시지가 도착했습니다.'),
      silent: !preferences.notificationSound
    }, () => {
      if (this.shown.get(room.inquiryId) !== entry || this.closed || this.host.locked()) return
      this.withdraw(room.inquiryId)
      this.host.open(room.channelId, room.inquiryId)
    }, () => { if (this.shown.get(room.inquiryId) === entry) this.shown.delete(room.inquiryId) })
    if (!close || this.shown.get(room.inquiryId) !== entry) { close?.(); this.shown.delete(room.inquiryId); return }
    entry.close = close
  }
  // A screen lock, a sign-out or a paused list withdraws every banner and forgets where the rooms stood.
  pause(): void {
    for (const id of [...this.shown.keys()]) this.withdraw(id)
    this.seen.clear(); this.known = false; this.since = 0
  }
  close(): void { this.closed = true; this.pause() }
}
