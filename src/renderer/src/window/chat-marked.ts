// Portions of this file follow Telegram Desktop (https://github.com/telegramdesktop/tdesktop, 7.2.8, 272f6f5c),
// Copyright (c) 2014-2026 The Telegram Desktop Authors. Licensed under GPL-3.0-or-later; see LEGAL.
//
// The open chat that gets «안 읽음 표시» while it is on screen — another device marked it — closes and keeps the mark, as
// Telegram's HistoryWidget::unreadCountUpdated does (history_widget.cpp:4747-4753: unreadMark() → closeCurrent()). The
// mark the chat had when it was opened is the one opening clears (showHistory, :3613-3617; session.ts
// clearOpenUnreadMark), so only a mark that comes after the chat was seen without one closes it.
export interface OpenChatMark {
  // The list is the account's own and complete: read, and not hidden behind the passcode lock.
  listReady: boolean
  // The chat's row carries the mark, where a mark means something (not a secret chat, not the memo space).
  marked: boolean
}
// `wasMarked`: what the chat was last seen with while open — null before the list showed it.
export function markArrived(wasMarked: boolean | null, now: OpenChatMark): boolean {
  return wasMarked === false && now.listReady && now.marked
}
