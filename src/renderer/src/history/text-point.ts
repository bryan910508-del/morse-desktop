// B287: tdesktop runs a message's double-click quick action (reply, or the favourite reaction) only beside its text — the
// cursor over nothing or over the date — and a double-click on the text selects a word (history_inner_widget.cpp:2700-2731:
// TextSelectType::Words when the cursor is CursorState::Text, the quick action only for None/Date; the same in
// history_view_list_widget.cpp:3925-3999). A link or a button under the pointer is neither.
// Whether a double-click at (x, y) on `target` is on a message's text (or a link or button in it) — so not the quick action.
// The caret lands on the nearest character even beside a line's end, so the point counts only inside a character's box.
export function onMessageText(target: EventTarget | null, x: number, y: number, doc: Pick<Document, 'caretRangeFromPoint' | 'createRange'> = document): boolean {
  const element = target as Element | null
  if (!element || typeof element.closest !== 'function') return false
  if (element.closest('a, button, [role="button"]')) return true
  const host = element.closest('.selectable')
  if (!host) return false
  const caret = doc.caretRangeFromPoint?.(x, y)
  const node = caret?.startContainer
  if (!caret || !node || node.nodeType !== 3 || !host.contains(node)) return false
  const length = (node as Text).length
  for (const at of [caret.startOffset - 1, caret.startOffset]) {
    if (at < 0 || at >= length) continue
    const range = doc.createRange()
    range.setStart(node, at); range.setEnd(node, at + 1)
    for (const box of Array.from(range.getClientRects())) if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) return true
  }
  return false
}
