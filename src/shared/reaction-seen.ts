// When a reaction to this account's message counts as seen — tdesktop reads it only when all three hold:
// the account is the one on screen (a background account's chosen chat reads nothing), the window is marking as read
// (HistoryWidget::markingContentsRead → MainWindow::markingAsRead: shown, not minimized, exposed, active,
// history_widget.cpp:4972-4980, mainwindow.cpp:597-606), and the message's reaction place is painted inside the visible
// area (HistoryInner::paintEvent, history_inner_widget.cpp:1518-1528, :1549 → ApiWrap::markContentsRead).

// The account may read only while its window may and it is the account shown (main/index.ts canRead).
export function accountMayRead(windowReadable: boolean, activeUid: string | null | undefined, uid: string): boolean {
  return windowReadable && activeUid === uid
}

export interface ReactionSeenState {
  closed: boolean; locked: boolean; ready: boolean; canRead: boolean
  selectedChatId: string | null | undefined; chatId: string
  unseenMessageId: string | null | undefined; shownMessageId: string
}
// Main's check of what the window says it showed: the chat still open, the window still reading, the message still the
// chat's unseen reaction.
export function reactionSeenAllowed(state: ReactionSeenState): boolean {
  return !state.closed && !state.locked && state.ready && state.canRead && state.selectedChatId === state.chatId
    && Boolean(state.unseenMessageId) && state.unseenMessageId === state.shownMessageId
}

export interface Box { top: number; bottom: number; left: number; right: number }
// The window's check: the middle of the message's reactions (or of its bubble) lies inside the history's visible part,
// across from part of it, and the topmost thing drawn there belongs to that message (nothing laid over it).
export function reactionPlaceShown(place: Box | null, visible: Box, ownsPoint: (x: number, y: number) => boolean): boolean {
  if (!place || place.bottom <= place.top) return false
  const y = (place.top + place.bottom) / 2
  if (y < visible.top || y > visible.bottom) return false
  const left = Math.max(visible.left, place.left), right = Math.min(visible.right, place.right)
  if (right <= left) return false
  return ownsPoint((left + right) / 2, y)
}
