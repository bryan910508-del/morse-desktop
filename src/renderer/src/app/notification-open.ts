// A pressed notification of another account opens once the window shows that account — a chat, and (B-menu-now) a 1:1
// inquiry room the same way: main switches the account and sends the open at once, so the window may hear the open
// before it shows the account. Kept for a short while only: an old press does not open a screen much later.
export type NotificationTarget = { kind: 'chat'; chatId: string } | { kind: 'inquiry'; channelId: string; inquiryId: string }
export interface PendingNotification { accountUid: string; target: NotificationTarget; at: number }
export const pendingNotificationMs = 15000

// The open arrives: at once when its account is shown, else kept (a newer press replaces an older one).
export function notificationArrived(shown: string | null, accountUid: string, target: NotificationTarget, now: number): { open: NotificationTarget | null; pending: PendingNotification | null } {
  return shown === accountUid ? { open: target, pending: null } : { open: null, pending: { accountUid, target, at: now } }
}
// The window shows an account: the kept open for it goes, if it is still fresh; one for another account stays.
export function accountShown(pending: PendingNotification | null, shown: string | null, now: number): { open: NotificationTarget | null; pending: PendingNotification | null } {
  if (!pending || pending.accountUid !== shown) return { open: null, pending }
  return { open: now - pending.at < pendingNotificationMs ? pending.target : null, pending: null }
}
