// Portions of this file follow Telegram Desktop (https://github.com/telegramdesktop/tdesktop, 42f8a36d4),
// Copyright (c) 2014-2026 The Telegram Desktop Authors. Licensed under GPL-3.0-or-later; see LEGAL.
import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'

// B502: pinned chats are reordered by dragging, as Dialogs::InnerWidget does (dialogs_inner_widget.cpp):
// - a press on a pinned row becomes a drag once it has moved kStartReorderThreshold (30 px) up or down
//   (checkReorderPinnedStart :2706-2724), and only when two or more rows are pinned (startReorderPinned :2730-2731);
// - the row follows the pointer, and a row it passes half of steps aside at once (updateReorderPinned :2851-2919,
//   crossThreshold :2864-2866, movePinned :2877, the yadd slide :2879-2882);
// - let go, the row slides into its place and the order is saved once (finishReorderOnRelease :2805-2818 →
//   finishReorderPinned → savePinnedOrder :2786-2790); near the list's edge the list scrolls (checkDeltaScroll :2935).
export const reorderThreshold = 30
const slide = 150
const edge = 40

export interface PinnedRange { start: number; end: number }
export interface PinnedDrag { from: number; to: number; offset: number; settling: boolean }

// The place the dragged row takes: past a neighbour once it is half over it. Rows here are one height, so tdesktop's
// max(dragged / 2, height − dragged / 2) is half a row.
export function reorderSlot(from: number, offset: number, size: number, range: PinnedRange): number {
  const steps = Math.sign(offset) * Math.floor(Math.abs(offset) / size + 0.5)
  return Math.min(range.end - 1, Math.max(range.start, from + steps))
}
// How far a row that is not dragged stands aside while the dragged one is at `to`.
export function reorderShift(index: number, from: number, to: number, size: number): number {
  if (from < to && index > from && index <= to) return -size
  if (to < from && index >= to && index < from) return size
  return 0
}
export function moved<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items], [item] = next.splice(from, 1)
  next.splice(to, 0, item!)
  return next
}
// iOS handleTablePinnedReorder: top first, one second apart from the moment of the drop, so a chat pinned later
// still goes above them all.
export function pinRanks(count: number, now = Date.now() / 1000): number[] {
  return Array.from({ length: count }, (_, index) => now - index)
}
// The ranks a drop gives the rows it shows, top first. The rows keep the places they held among themselves, so pinned
// chats not shown here (another tab, the archive) stay where they were, as tdesktop orders each list on its own. Only
// when those places cannot be told apart (two the same, or none yet) do they take fresh ranks from the drop.
export function droppedRanks(current: readonly number[], now = Date.now() / 1000): number[] {
  const places = [...current].sort((a, b) => b - a)
  const distinct = places.every((rank, index) => Number.isFinite(rank) && rank > 0 && rank <= 1e12 && (index === 0 || rank < places[index - 1]!))
  return distinct ? places : pinRanks(current.length, now)
}

interface Press { index: number; y: number; top: number; range: PinnedRange; dragging: boolean; lastY: number }

export function usePinnedDrag({ scroll, range, size, enabled, onDrop }: {
  scroll: RefObject<HTMLDivElement | null>; range: PinnedRange | null; size: number; enabled: boolean; onDrop(from: number, to: number): void
}): { drag: PinnedDrag | null; onPointerDown(event: ReactPointerEvent<HTMLElement>): void; rowStyle(index: number, start: number): CSSProperties } {
  const [drag, setShown] = useState<PinnedDrag | null>(null)
  const shown = useRef<PinnedDrag | null>(null)
  const setDrag = useCallback((next: PinnedDrag | null) => { shown.current = next; setShown(next) }, [])
  const press = useRef<Press | null>(null), stop = useRef<(() => void) | null>(null)
  const drop = useRef(onDrop); drop.current = onDrop
  const latest = useRef(range); latest.current = range

  const end = useCallback((commit: boolean) => {
    const held = press.current
    stop.current?.(); stop.current = null; press.current = null
    if (!held?.dragging) { setDrag(null); return }
    // The click that ends a drag does not open the chat (tdesktop's release after a reorder is not a click).
    const swallow = (event: MouseEvent): void => { event.preventDefault(); event.stopPropagation() }
    window.addEventListener('click', swallow, { capture: true, once: true })
    setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0)
    const current = shown.current
    if (!current) return
    const to = commit ? current.to : current.from, settling = { from: current.from, to, offset: (to - current.from) * size, settling: true }
    setDrag(settling)
    setTimeout(() => {
      if (shown.current !== settling) return
      if (to !== settling.from) drop.current(settling.from, to)
      setDrag(null)
    }, slide)
  }, [size, setDrag])

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const box = scroll.current, held = latest.current
    if (!enabled || !box || !held || held.end - held.start < 2 || event.button !== 0 || press.current || drag) return
    const row = (event.target as HTMLElement).closest<HTMLElement>('[data-row]')
    const index = row ? Number(row.dataset.row) : NaN
    if (!Number.isInteger(index) || index < held.start || index >= held.end) return
    const state: Press = { index, y: event.clientY, top: box.scrollTop, range: held, dragging: false, lastY: event.clientY }
    press.current = state
    let speed = 0, frame = 0
    const update = (): void => {
      const current = press.current
      if (current !== state) return
      const raw = state.lastY - state.y + (box.scrollTop - state.top)
      if (!state.dragging && Math.abs(raw) < reorderThreshold) return
      state.dragging = true
      // The dragged row stays inside the pinned rows.
      const offset = Math.min((state.range.end - 1 - index) * size, Math.max((state.range.start - index) * size, raw))
      setDrag({ from: index, to: reorderSlot(index, offset, size, state.range), offset, settling: false })
    }
    const step = (): void => {
      frame = 0
      if (!speed || press.current !== state) return
      box.scrollTop += speed; update()
      frame = requestAnimationFrame(step)
    }
    const move = (moveEvent: PointerEvent): void => {
      state.lastY = moveEvent.clientY; update()
      const rect = box.getBoundingClientRect()
      speed = !state.dragging ? 0 : moveEvent.clientY < rect.top + edge ? -Math.ceil((rect.top + edge - moveEvent.clientY) / 4)
        : moveEvent.clientY > rect.bottom - edge ? Math.ceil((moveEvent.clientY - rect.bottom + edge) / 4) : 0
      if (speed && !frame) frame = requestAnimationFrame(step)
    }
    const up = (): void => end(true)
    const cancel = (): void => end(false)
    const key = (keyEvent: KeyboardEvent): void => { if (keyEvent.key === 'Escape' && state.dragging) { keyEvent.preventDefault(); end(false) } }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', key, true); box.addEventListener('scroll', update)
    stop.current = () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', key, true); box.removeEventListener('scroll', update)
    }
  }, [enabled, scroll, size, end, drag, setDrag])

  // The pinned rows changed under the drag (a pin came or went): it ends where it began, as tdesktop stops it.
  useEffect(() => {
    const held = press.current
    if (held && (!range || range.start !== held.range.start || range.end !== held.range.end || !enabled)) end(false)
  }, [range, enabled, end])
  useEffect(() => () => { stop.current?.() }, [])

  const rowStyle = useCallback((index: number, start: number): CSSProperties => {
    const base: CSSProperties = { transform: `translateY(${start}px)` }
    if (!drag || !range || index < range.start || index >= range.end) return base
    if (index === drag.from) return { transform: `translateY(${start + drag.offset}px)`, zIndex: 2, boxShadow: 'var(--shadow-elevated)',
      transition: drag.settling ? `transform ${slide}ms ease` : 'none' }
    return { transform: `translateY(${start + reorderShift(index, drag.from, drag.to, size)}px)`, transition: `transform ${slide}ms ease` }
  }, [drag, range, size])

  return { drag, onPointerDown, rowStyle }
}
