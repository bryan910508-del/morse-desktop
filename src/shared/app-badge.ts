// Portions of this file follow Telegram Desktop (https://github.com/telegramdesktop/tdesktop, v7.3.1, 6fed91ff),
// Copyright (c) 2014-2026 The Telegram Desktop Authors. Licensed under GPL-3.0-or-later; see LEGAL.
import type { DialogSummary, Preferences } from './model'
import { effectiveUnreadCount } from './manual-unread'

export interface AppBadgeState { count: number; muted: boolean }
export interface AppBadgeAccount { uid: string; dialogs: DialogSummary[] }

// B353: one account's count — tdesktop Session::unreadWithMentionsBadge (data_session.cpp:3648-3654; Morse has no
// mention counts, so it is computeUnreadBadge, :3716-3721) with its default includeMutedCounter = true (core_settings.h:1103):
// marks + messages (or chats, as countUnreadMessages picks), muted chats too, grey only when everything counted is
// muted (computeUnreadBadgeMuted, :3724-3733). The accounts list shows it beside every other account
// (settings_information.cpp:138-148, the row's hasUnread = !active, :828-834).
export function accountBadgeState(uid: string, dialogs: DialogSummary[], badgeMode: Preferences['badgeMode']): AppBadgeState {
  let count = 0, unmuted = false
  for (const dialog of dialogs) {
    // A mark counts once and only with no count (effectiveUnreadCount, B341); «채팅 수» counts the chats that have any.
    const unread = effectiveUnreadCount(dialog)
    // B113: the official notice chat stays out (A13-5 §3-5), as the server keeps it out of the account's badge.
    if (dialog.archived || dialog.kind === 'secret' || dialog.service || !dialog.participantUids.includes(uid) || !Number.isSafeInteger(unread) || unread <= 0) continue
    count = Math.min(100000, count + (badgeMode === 'chats' ? 1 : unread))
    if (!dialog.muted) unmuted = true
  }
  return { count, muted: count > 0 && !unmuted }
}

// B348: the one count the macOS Dock and the Windows taskbar both show: tdesktop's Domain::updateUnreadBadge
// (main_domain.cpp:302-314) adds every signed-in account's count, grey only when every account's is.
export function appBadgeState(preferences: Pick<Preferences, 'showUnreadBadge' | 'badgeMode'>, accounts: AppBadgeAccount[], available: boolean): AppBadgeState {
  let count = 0, unmuted = false
  if (available && preferences.showUnreadBadge) {
    for (const { uid, dialogs } of accounts) {
      const account = accountBadgeState(uid, dialogs, preferences.badgeMode)
      count = Math.min(100000, count + account.count)
      if (account.count > 0 && !account.muted) unmuted = true
    }
  }
  return { count, muted: count > 0 && !unmuted }
}

// The Dock's own text: macOS draws it, so it keeps «999+».
export function dockBadgeText(count: number): string {
  return count > 999 ? '999+' : count > 0 ? String(count) : ''
}

// tdesktop Window::GenerateCounterLayer (window/main_window.cpp:274-347): the number in a rounded box at the bottom
// right; from 1000 on, «..» and the last two digits (:276-278). Sizes, fonts, padding and corners by the text's length
// (:287-318); any other size takes the 32 px row (the switch's default).
export interface AppBadgeLayer { size: number; text: string; font: number; delta: number; radius: number }
export function appBadgeLayer(size: number, count: number): AppBadgeLayer {
  const text = count < 1000 ? String(count) : `..${String(count % 100).padStart(2, '0')}`
  const pick = (one: number, two: number, more: number): number => text.length < 2 ? one : text.length < 3 ? two : more
  switch (size) {
    case 16: return { size, text, font: pick(11, 11, 8), delta: pick(5, 2, 1), radius: pick(8, 7, 3) }
    case 20: return { size, text, font: pick(14, 13, 10), delta: pick(6, 2, 1), radius: pick(10, 9, 5) }
    case 24: return { size, text, font: pick(17, 16, 12), delta: pick(7, 3, 1), radius: pick(12, 11, 6) }
    default: return { size: 32, text, font: pick(22, 20, 16), delta: pick(9, 4, 2), radius: pick(16, 14, 8) }
  }
}
// The box's height is tdesktop's font height (f->height of its default Open Sans, whose ascent + descent is 2789/2048 of
// the size); this app's font is shorter and a little wider, so its text is centred in that box and the box kept inside
// the picture, where Open Sans's one digit fills a 16 px one exactly.
export function appBadgeFontHeight(font: number): number { return Math.round(font * 2789 / 2048) }
// Where the box and the text go once the text's width and the drawing font's ascent and descent are measured (:333-344).
export function appBadgeBox(layer: AppBadgeLayer, textWidth: number, ascent: number, descent: number) {
  const { size, delta } = layer
  const height = Math.min(size, appBadgeFontHeight(layer.font)), width = Math.min(size, Math.round(textWidth) + delta * 2)
  const x = size - width, y = size - height
  return { x, y, width, height, textX: x + (width - textWidth) / 2, textY: y + (height - ascent - descent) / 2 + ascent }
}
// B348b: tdesktop Window::WithSmallCounter (window/main_window.cpp:350-391), the count on the tray icon's logo: below
// 100 the number, from 100 on «..» and the last digit (:353-356); font half the size, padding and corners by the
// text's length (:365-370, integer sizes as Qt's), the box at the bottom right as GenerateCounterLayer's.
export function appSmallCounterLayer(size: number, count: number): AppBadgeLayer {
  const text = count < 100 ? String(count) : `..${count % 10}`
  const one = text.length < 2
  return { size, text, font: Math.floor(size / 2), delta: Math.floor(size / (one ? 8 : 16)), radius: Math.floor(size / (one ? 4 : 5)) }
}
// The overlay is a small icon (tdesktop NativeIcon(…, SM_CXSMICON), main_window_win.cpp:654): 16 px at 100 %, drawn at
// the window's scale from the sizes the table has.
export function appBadgePixels(scaleFactor: number): number {
  const wanted = 16 * (Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1)
  return [16, 20, 24, 32].find(size => size >= wanted - 0.5) ?? 32
}
