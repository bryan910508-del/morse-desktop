// B519: choosing messages by dragging over them, as tdesktop's HistoryInner does (history_inner_widget.cpp @42f8a36d4).
// A press on a message's text selects text, and keeps selecting text only while the pointer stays in that message
// (selectingText :5474-5477); a press beside the text, or the pointer reaching another message, chooses whole messages
// from the first one to the one under the pointer (:5666-5724). This file is the reading of that range; the pointer
// handling is use-drag-select.ts.

// Telegram's Config MaxSelectedItems (config.h:13): a drag adds messages, top first, until this many are chosen.
export const maxSelectedMessages = 100

// A row of the list: its height and the space above and below its bubble (the date, the unread bar, the row's padding —
// tdesktop's Element marginTop/marginBottom).
export interface DragRowBox { height: number; marginTop: number; marginBottom: number }
// Where the pointer is: the row's place in the list and the point's height inside that row (it can be above or below it).
export interface DragPoint { index: number; y: number; box: DragRowBox }
// Where the press was; `inside` is whether it was on the bubble (PointState other than Outside).
export interface DragStart extends DragPoint { inside: boolean }
// `down`: the pointer is below where the press was, so the pressed side of the range is its top.
export interface DragRange { from: number; to: number; down: boolean }

// HistoryInner::mouseActionUpdate :5677-5711: the rows from the pressed one to the one under the pointer, leaving out
// the pressed row when the press was beside its bubble and the pointer went away from that side, and the row under the
// pointer while the pointer is only in its margin on the near side. `distance` is the drag start distance.
export function dragSelectionRange(start: DragStart, now: DragPoint, distance: number): DragRange | null {
  const same = start.index === now.index
  const down = start.index < now.index || (same && start.y < now.y)
  let from: number | null = start.index, to: number | null = now.index
  if (!start.inside) {
    if (down) {
      if (start.y >= start.box.height - start.box.marginBottom || (same && (now.y < start.y + distance || now.y < start.box.marginTop))) {
        from = from !== to ? from + 1 : null
      }
    } else if (start.y < start.box.marginTop || (same && (now.y >= start.y - distance || now.y >= start.box.height - start.box.marginBottom))) {
      from = from !== to ? from - 1 : null
    }
  }
  if (!same && from !== null) {
    if (down) {
      if (now.y < now.box.marginTop) to = from !== to ? to - 1 : null
    } else if (now.y >= now.box.height - now.box.marginBottom) to = from !== to ? to + 1 : null
  }
  if (from === null || to === null) return null
  return { from: Math.min(from, to), to: Math.max(from, to), down }
}

// :5712-5722: the drag chooses the range, or lets it go when the first row it reaches that can be chosen (counted from
// the pressed side) is chosen already.
export function dragChooses(range: DragRange, ids: readonly (string | null)[], chosen: ReadonlySet<string>): boolean {
  const order = range.down ? ids.slice(range.from, range.to + 1) : ids.slice(range.from, range.to + 1).reverse()
  const first = order.find((id): id is string => id !== null)
  return first !== undefined && !chosen.has(first)
}

// HistoryInner::applyDragSelection :6335-6399 with addSelectionRange :6315-6333 and changeSelection :6046-6050: a drag
// that chooses adds the rows in list order while the count stays at most maxSelectedMessages; one that lets go removes
// them. `ids` are the range's rows, null for a row that cannot be chosen (canBeSelected).
export function applyDragSelection(chosen: readonly string[], ids: readonly (string | null)[], choose: boolean, max = maxSelectedMessages): string[] {
  if (!choose) {
    const out = new Set(ids.filter((id): id is string => id !== null))
    return chosen.filter(id => !out.has(id))
  }
  const next = [...chosen], have = new Set(chosen)
  for (const id of ids) {
    if (id === null || have.has(id)) continue
    if (next.length + 1 > max) break
    next.push(id); have.add(id)
  }
  return next
}
