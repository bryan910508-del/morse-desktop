// B184d (contract with iOS B184d · B184e · B184g, review 11-06 08:1x): where a room was left — the message nearest the
// composer that was on screen and the distance from its bottom edge to the list's bottom edge — so the room opens there
// again. tdesktop keeps the same in its History while the app runs (scrollTopItem + scrollTopOffset, history.h:503-508,
// counted on every scroll and forgotten at the bottom, history_inner_widget.cpp:4578-4598); here it is kept beside the
// kept history in main (kept-histories.ts), in memory only, so a relaunch opens as before.
// The order is iOS's (ChatRoomView+Lifecycle.swift:134-139, Telegram iOS ChatHistoryViewForLocation.swift:182-222): a
// notice's message, then the first unread, then the left place when its message is in the page, then the bottom.
export interface LeftPlace { messageId: string; distance: number }

const distanceLimit = 100_000

// What the window hands over on leaving; anything else is no place.
export function leftPlaceOf(value: unknown): LeftPlace | null {
  if (!value || typeof value !== 'object') return null
  const { messageId, distance } = value as Record<string, unknown>
  if (typeof messageId !== 'string' || !messageId || messageId.length > 256 || typeof distance !== 'number' || !Number.isFinite(distance)) return null
  return { messageId, distance: Math.max(-distanceLimit, Math.min(distanceLimit, distance)) }
}

export interface PlaceRow { messageId: string | null; start: number; end: number }

// The place a list shows now: none at its bottom; otherwise the lowest message row on screen and how far its bottom edge
// is above the list's bottom edge. Rows are the ones the list has drawn, in order; a row that is not a message (a date,
// an item still being sent) is passed over.
export function placeOnScreen(rows: readonly PlaceRow[], scrollTop: number, viewHeight: number, atBottom: boolean): LeftPlace | null {
  if (atBottom) return null
  const viewBottom = scrollTop + viewHeight
  for (let index = rows.length - 1; index >= 0; index--) {
    const row = rows[index]!
    if (row.messageId && row.start < viewBottom && row.end > scrollTop) return { messageId: row.messageId, distance: viewBottom - row.end }
  }
  return null
}

// The left place to open at, when nothing comes before it: only when its message is in the page the room opens with
// (a place outside it, or a message deleted since, opens at the bottom — review (c)).
export function placeToOpen(place: LeftPlace | null | undefined, messageIds: readonly string[]): LeftPlace | null {
  return place && messageIds.includes(place.messageId) ? place : null
}
