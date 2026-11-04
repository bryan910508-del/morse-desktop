import { FirestoreReader, type ReadCredentials } from '../network/firestore-rpc'
import { childId, documents, stringField, type FirestoreDocument } from '../network/firestore-values'
import type { NotificationContent, NotificationHost } from '../messaging/notifications'
import { alerting, notificationAlerts } from '../../shared/notification-alerts'
import { tr } from '../../shared/i18n'

// B515: a join request the channel's owner approved. Telegram tells the person with a service message in their history —
// «Your request to join the channel was approved» (Telegram-iOS `.joinedByRequest`, ServiceMessageStrings.swift:425-427;
// Telegram-Android RequestToJoinChannelApproved, MessageObject.java:5752-5757) — and it notifies as a new message does.
// A Morse channel's posts are everyone's, so the server marks the subscription instead (users/{uid}/subscriptions/{id}
// `joinedByRequest: true`, decideMorseChannelJoin) and pushes `channelJoinApproved` to the phones. This window watches
// those marked subscriptions and shows the same notice for one that appears while it runs; pressing it opens the channel.
//
// The first snapshot only records which are there (an account opening does not announce its past approvals); one that
// comes while the watch is away (locked, disconnected) is announced when it is back.
export function newApprovals(known: Set<string> | null, ids: Iterable<string>): { known: Set<string>; approved: string[] } {
  const next = new Set(ids)
  return { known: next, approved: known === null ? [] : [...next].filter(id => !known.has(id)) }
}
export const maxMarkedSubscriptions = 500

// `dropped`/`hidden`: F-RT-004's split of the notification host (what drops a notice, what only hides its words); without
// them `locked` drops it, as the chats' notifications did before.
export type JoinApprovalHost = Pick<NotificationHost, 'preferences' | 'locked' | 'show' | 'alert'> & { dropped?(): boolean; hidden?(): boolean; open(channelId: string): void }

export class ChannelJoinApprovals {
  private reader: FirestoreReader | null = null
  private stop: (() => void) | null = null
  private known: Set<string> | null = null
  private readonly shown = new Map<string, () => void>()
  private locked = false
  private closed = false

  constructor(private readonly uid: string, private readonly auth: ReadCredentials, private readonly allowed: () => void,
    private readonly host: JoinApprovalHost) {}

  resume(): void {
    if (this.closed || this.locked || this.stop) return
    try { this.allowed() } catch { return }
    const reader = this.reader ??= new FirestoreReader(this.auth)
    const parent = `${documents}/users/${this.uid}`
    this.stop = reader.watch({ query: { parent, structuredQuery: { from: [{ collectionId: 'subscriptions' }],
      where: { fieldFilter: { field: { fieldPath: 'joinedByRequest' }, op: 'EQUAL', value: { booleanValue: true } } }, limit: { value: maxMarkedSubscriptions + 1 } } } }, this.auth.signal, {
      snapshot: rows => {
        if (this.closed || !this.stop || rows.size > maxMarkedSubscriptions) return
        const ids: string[] = []
        for (const doc of rows.values()) { try { ids.push(childId(doc.name, `${parent}/subscriptions`)) } catch { /* not a subscription */ } }
        const { known, approved } = newApprovals(this.known, ids)
        this.known = known
        for (const channelId of approved) void this.announce(reader, channelId)
      },
      // A dropped listener keeps what it knew; the next snapshot tells what came meanwhile.
      state: () => {}
    }, maxMarkedSubscriptions + 1, 4 * 1024 * 1024)
  }
  pause(): void {
    this.stop?.(); this.stop = null
    this.reader?.close(); this.reader = null
  }
  setLocked(locked: boolean): void {
    if (this.locked === locked) return
    this.locked = locked
    if (locked) this.pause(); else this.resume()
  }
  close(): void { this.closed = true; this.pause(); for (const close of this.shown.values()) close(); this.shown.clear() }

  private dropped(): boolean { return this.host.dropped ? this.host.dropped() : this.host.locked() }
  // The server's push: «"<채널>" 가입 요청이 승인되었어요», by the person's channel notification switch and sound
  // (channelJoinApprovedNotifyRequester, morse-push-text.js); the app's lock hides the channel's name.
  private async announce(reader: FirestoreReader, channelId: string): Promise<void> {
    const preferences = this.host.preferences()
    if (this.closed || this.dropped() || !alerting(preferences) || (!preferences.notifyChannel && !preferences.notifyPersonal)) return
    let doc: FirestoreDocument | null = null
    try { doc = await reader.getDocument(`${documents}/channels/${channelId}`, this.auth.signal) } catch { /* the notice goes without the name */ }
    if (this.closed || this.dropped()) return
    const alerts = notificationAlerts(this.host.preferences())
    if (alerts.flash) this.host.alert?.()
    if (!alerts.show) return
    const name = doc ? stringField(doc.fields, 'name', 512).trim() : ''
    const hidden = this.host.hidden?.() === true || !this.host.preferences().showNotificationPreview
    const content: NotificationContent = { chatId: `channel:${channelId}`, title: hidden ? 'Morse' : name || tr('채널'),
      body: hidden || !name ? tr('가입 요청이 승인되었어요.') : tr('"{0}" 가입 요청이 승인되었어요.', [name.slice(0, 80)]), silent: !this.host.preferences().notificationSound }
    this.shown.get(channelId)?.()
    const close = this.host.show(content, () => { this.shown.delete(channelId); this.host.open(channelId) }, () => { this.shown.delete(channelId) })
    if (close) this.shown.set(channelId, close)
  }
}
