// B286: the composer's height for its text, measured on a copy outside the layout. Setting the field itself to 'auto'
// to measure it collapsed it to one line for a moment inside the layout effect: the history above grew, its scroll was
// clamped to the new end, and the frame painted with the messages pushed down until the bottom was kept again (Phase1:
// 38 px a line). tdesktop's field reports its height and HistoryWidget resizes the scroll area once
// (fieldResized → updateHistoryGeometry, history_widget.cpp:7745-7752, 8601-8724); here the field goes straight from
// its old height to its new one, and the history keeps its bottom in the same frame (keepBottomOnResize).
type Measured = Pick<HTMLTextAreaElement, 'value' | 'className' | 'offsetWidth' | 'offsetHeight' | 'clientHeight'>
interface Mirror { value: string; className: string; style: { width: string }; readonly scrollHeight: number }
let mirror: Mirror | null = null
export function fieldHeight(element: Measured, max: number, make: () => Mirror = defaultMirror): number {
  mirror ??= make()
  mirror.className = element.className
  mirror.style.width = `${element.offsetWidth}px`
  mirror.value = element.value
  // scrollHeight is the text and its padding; the borders are added, so the field's own box never scrolls.
  return Math.min(max, mirror.scrollHeight + (element.offsetHeight - element.clientHeight))
}
function defaultMirror(): Mirror {
  const copy = document.createElement('textarea')
  copy.setAttribute('aria-hidden', 'true')
  copy.tabIndex = -1
  copy.rows = 1
  Object.assign(copy.style, { position: 'absolute', top: '0', left: '-10000px', visibility: 'hidden', pointerEvents: 'none', height: '0', minHeight: '0', overflow: 'hidden' })
  document.body.appendChild(copy)
  return copy
}
