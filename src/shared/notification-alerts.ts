import type { Preferences } from './model'

// B378 ②: how a new message alerts, as tdesktop System::showNext does (window/notifications_manager.cpp:753-789): the
// flash or Dock bounce (flashBounceNotify) goes first and does not wait for the toast, which shows only while desktop
// notifications are on. So a message is looked at while either one is on, and each goes by its own switch.
export interface NotificationAlerts { show: boolean; flash: boolean }
type AlertPreferences = Pick<Preferences, 'notifications' | 'flashOnNotification'>
export function notificationAlerts(preferences: AlertPreferences): NotificationAlerts {
  return { show: preferences.notifications, flash: preferences.flashOnNotification }
}
export function alerting(preferences: AlertPreferences): boolean {
  const alerts = notificationAlerts(preferences)
  return alerts.show || alerts.flash
}

// B378 ①: the notifications line of the tray menu (Windows) and of the Dock menu (Mac).
// - Tray::toggleSoundNotifications (tray.cpp:156-200): turning notifications off turns the flash off too and remembers
//   that it was on; turning them on brings it back. tdesktop keeps the sound aside the same way because its sound plays
//   without a toast; here the sound is the notification's own, so it goes with the notifications and stays as it is.
// - RefreshDockMenu (menu/menu_dock.cpp:53-60) flips desktop notifications alone.
export type NotificationsMenu = 'tray' | 'dock'
export function toggledNotifications(preferences: AlertPreferences, flashRemembered: boolean, from: NotificationsMenu): { update: Partial<Preferences>; flashRemembered: boolean } {
  const notifications = !preferences.notifications
  if (from === 'dock') return { update: { notifications }, flashRemembered }
  if (notifications) {
    return flashRemembered && !preferences.flashOnNotification
      ? { update: { notifications, flashOnNotification: true }, flashRemembered: false }
      : { update: { notifications }, flashRemembered }
  }
  return preferences.flashOnNotification
    ? { update: { notifications, flashOnNotification: false }, flashRemembered: true }
    : { update: { notifications }, flashRemembered: false }
}
