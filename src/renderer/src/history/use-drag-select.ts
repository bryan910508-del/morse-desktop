import { useEffect, useRef, type RefObject } from 'react'
import { applyDragSelection, dragChooses, dragSelectionRange, type DragPoint, type DragRange, type DragRowBox, type DragStart } from './drag-select'

// B519: the pointer side of choosing messages by dragging (tdesktop HistoryInner mouseActionStart :2238-2328,
// mouseActionUpdate :5397-5756, mouseActionFinish :2539-2663). drag-select.ts is the reading of the range.
//
// A press on a message's text is the browser's own text selection; it stays one while the pointer is in that message
// and gives way to choosing messages once the pointer reaches another (selectingText :5474-5477). A press beside the
// text — the bubble's padding, the row beside the bubble — chooses messages once the pointer has moved the drag start
// distance or reached another row (:5487-5493). While messages are chosen every press is the latter (:2265-2272). Rows
// are held by their key, not their element: the list is virtual, and a row scrolled away is not in the page.
export interface DragRow { key: string; id: string | null }
export interface DragPreview { ids: ReadonlySet<string>; choose: boolean }
export interface DragSelectOptions {
  enabled(): boolean
  // The list's rows in order, as the virtual list numbers them: `id` is the message a drag may choose, else null.
  rows(): readonly DragRow[]
  chosen(): readonly string[] | null
  preview(value: DragPreview | null): void
  apply(next: string[]): void
}

// QApplication::startDragDistance's default.
const dragDistance = 10
// What a press acts on by itself: a link, a button, a player, a field (tdesktop: a pressed ClickHandler, :2261-2264).
const control = 'a, button, [role="button"], input, textarea, select, video, audio, [contenteditable="true"], .voice-message-wrap'
const overlaid = (): boolean => Boolean(document.querySelector('.layer, .popup-menu, .entity-panel'))

interface Pressed { key: string; y: number; box: DragRowBox; inside: boolean; x0: number; y0: number }
type Mode = { kind: 'prepare'; start: Pressed } | { kind: 'text'; start: Pressed } | { kind: 'range'; start: Pressed; range: DragRange | null; choose: boolean; shown: boolean }

function rowBox(row: HTMLElement): { rect: DOMRect; box: DragRowBox; bubble: DOMRect | null } {
  const rect = row.getBoundingClientRect()
  // The message's own bubble — not the day's date pill a row can carry above it, which is in the row's top margin.
  const bubble = (row.querySelector<HTMLElement>('.history-message .bubble') ?? row.querySelector<HTMLElement>('.history-service > *'))?.getBoundingClientRect() ?? null
  return { rect, bubble, box: bubble ? { height: rect.height, marginTop: Math.max(0, bubble.top - rect.top), marginBottom: Math.max(0, rect.bottom - bubble.bottom) }
    : { height: rect.height, marginTop: 0, marginBottom: 0 } }
}

export function useDragSelect(scroll: RefObject<HTMLElement | null>, options: DragSelectOptions): void {
  const optionsRef = useRef(options); optionsRef.current = options
  useEffect(() => {
    const element = scroll.current
    if (!element) return
    let mode: Mode | null = null, pointer = { x: 0, y: 0 }, frame = 0, swallowClick = false
    const indexOf = (key: string): number => optionsRef.current.rows().findIndex(row => row.key === key)
    // The rendered row at a height, the pointer's height kept inside the list so a pointer above or below it reads
    // the first or the last row shown.
    const rowAt = (y: number): { index: number; row: HTMLElement } | null => {
      const view = element.getBoundingClientRect(), at = Math.min(Math.max(y, view.top + 1), view.bottom - 1)
      let best: { index: number; row: HTMLElement; distance: number } | null = null
      for (const row of Array.from(element.querySelectorAll<HTMLElement>('.history-row[data-index]'))) {
        const rect = row.getBoundingClientRect(), distance = at < rect.top ? rect.top - at : at >= rect.bottom ? at - rect.bottom + 1 : 0
        if (rect.height > 0 && (!best || distance < best.distance)) best = { index: Number(row.dataset.index), row, distance }
      }
      return best && Number.isInteger(best.index) ? best : null
    }
    const stopScroll = (): void => { if (frame) cancelAnimationFrame(frame); frame = 0 }
    const end = (): void => {
      stopScroll(); mode = null
      element.classList.remove('drag-choosing')
      window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', cancel, true); window.removeEventListener('blur', cancel)
    }
    const cancel = (): void => { if (mode?.kind === 'range') optionsRef.current.preview(null); end() }
    const toRange = (start: Pressed): void => {
      window.getSelection()?.removeAllRanges()
      element.classList.add('drag-choosing')
      mode = { kind: 'range', start, range: null, choose: true, shown: false }
    }
    const update = (): void => {
      if (mode?.kind !== 'range') return
      const rows = optionsRef.current.rows(), startIndex = indexOf(mode.start.key), under = rowAt(pointer.y)
      if (startIndex < 0 || !under) { cancel(); return }
      const { rect, box } = rowBox(under.row)
      const start: DragStart = { index: startIndex, y: mode.start.y, box: mode.start.box, inside: mode.start.inside }
      const now: DragPoint = { index: under.index, y: pointer.y - rect.top, box }
      const range = dragSelectionRange(start, now, dragDistance)
      const ids = range ? rows.slice(range.from, range.to + 1).map(row => row.id) : []
      const choose = range ? dragChooses(range, rows.map(row => row.id), new Set(optionsRef.current.chosen() ?? [])) : mode.choose
      const same = mode.range && range && mode.range.from === range.from && mode.range.to === range.to && mode.choose === choose
      if (same || (!range && !mode.range)) return
      // tdesktop sets the focus on the list as the first range is drawn (updateDragSelection :5777-5780), so Delete and
      // the copy shortcut act on what is chosen.
      if (range && !mode.shown) element.focus({ preventScroll: true })
      mode = { ...mode, range, choose, shown: mode.shown || Boolean(range) }
      // Once a range was drawn the list stays in choosing while the drag goes on (inSelectionMode :5012-5026).
      optionsRef.current.preview(range ? { ids: new Set(ids.filter((id): id is string => id !== null)), choose } : mode.shown ? { ids: new Set(), choose } : null)
    }
    // Past the list's top or bottom the list rolls, faster the farther the pointer is (tdesktop _selectScroll :5748-5756).
    const roll = (): void => {
      frame = 0
      if (mode?.kind !== 'range') return
      const view = element.getBoundingClientRect()
      const past = pointer.y < view.top ? pointer.y - view.top : pointer.y > view.bottom ? pointer.y - view.bottom : 0
      if (!past) return
      element.scrollTop += Math.sign(past) * Math.min(40, Math.max(2, Math.abs(past) / 2))
      update()
      frame = requestAnimationFrame(roll)
    }
    const move = (event: PointerEvent): void => {
      if (!mode) return
      pointer = { x: event.clientX, y: event.clientY }
      if (mode.kind === 'prepare') {
        const under = rowAt(pointer.y), key = under ? optionsRef.current.rows()[under.index]?.key : undefined
        if (key === mode.start.key && Math.hypot(pointer.x - mode.start.x0, pointer.y - mode.start.y0) < dragDistance) return
        toRange(mode.start)
      } else if (mode.kind === 'text') {
        const under = rowAt(pointer.y), key = under ? optionsRef.current.rows()[under.index]?.key : undefined
        if (!key || key === mode.start.key) return
        toRange(mode.start)
      }
      update()
      if (!frame) frame = requestAnimationFrame(roll)
    }
    const up = (event: PointerEvent): void => {
      if (event.button !== 0 || !mode) return
      const was = mode
      end()
      // A click beside the text lets the text selection go (needTextSelectionClear :2566-2567, :2620-2621); Chromium
      // keeps a selection when the press is on what cannot be selected, so it is let go here.
      if (was.kind === 'prepare') {
        const selection = window.getSelection()
        if (selection && !selection.isCollapsed && selection.anchorNode && element.contains(selection.anchorNode)) selection.removeAllRanges()
      }
      if (was.kind !== 'range') return
      // The click that ends a drag is not a click on the row it ends on (needItemSelectionToggle :2557-2565).
      swallowClick = true; setTimeout(() => { swallowClick = false }, 0)
      optionsRef.current.preview(null)
      if (!was.range) return
      const ids = optionsRef.current.rows().slice(was.range.from, was.range.to + 1).map(row => row.id)
      const chosen = optionsRef.current.chosen()
      const next = applyDragSelection(chosen ?? [], ids, was.choose)
      if (chosen === null && !next.length) return
      optionsRef.current.apply(next)
    }
    const down = (event: PointerEvent): void => {
      if (event.button !== 0 || event.ctrlKey || mode || !optionsRef.current.enabled() || overlaid()) return
      const target = event.target as HTMLElement | null
      const row = target?.closest<HTMLElement>('.history-row[data-index]')
      if (!target || !row || !element.contains(row) || target.closest(control)) return
      const key = optionsRef.current.rows()[Number(row.dataset.index)]?.key
      if (!key) return
      const { rect, box, bubble } = rowBox(row)
      const inside = Boolean(bubble && event.clientX >= bubble.left && event.clientX < bubble.right && event.clientY >= bubble.top && event.clientY < bubble.bottom)
      const start: Pressed = { key, y: event.clientY - rect.top, box, inside, x0: event.clientX, y0: event.clientY }
      pointer = { x: event.clientX, y: event.clientY }
      mode = optionsRef.current.chosen() === null && target.closest('.selectable') ? { kind: 'text', start } : { kind: 'prepare', start }
      window.addEventListener('pointermove', move, true); window.addEventListener('pointerup', up, true)
      window.addEventListener('pointercancel', cancel, true); window.addEventListener('blur', cancel)
    }
    // A press beside the text starts no text selection, and a drag that turned to choosing messages extends none.
    const selectStart = (event: Event): void => { if (mode && mode.kind !== 'text') event.preventDefault() }
    const click = (event: MouseEvent): void => { if (swallowClick) { swallowClick = false; event.stopPropagation(); event.preventDefault() } }
    const key = (event: KeyboardEvent): void => { if (event.key === 'Escape' && mode?.kind === 'range') { event.stopPropagation(); event.preventDefault(); cancel() } }
    element.addEventListener('pointerdown', down)
    element.addEventListener('click', click, true)
    document.addEventListener('selectstart', selectStart)
    window.addEventListener('keydown', key, true)
    return () => {
      cancel()
      element.removeEventListener('pointerdown', down)
      element.removeEventListener('click', click, true)
      document.removeEventListener('selectstart', selectStart)
      window.removeEventListener('keydown', key, true)
    }
  }, [scroll])
}
