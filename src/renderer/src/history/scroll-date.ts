import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { Virtualizer } from '@tanstack/react-virtual'
import { sameDay } from '../app/format'

// HistoryInner::scrollDateCheck: while a history is being scrolled, the day of the topmost message floats over it
// and fades away a second after the scrolling stops (kScrollDateHideTimeout). Crossing into another day keeps it
// three times as long (kScrollDateHideOnDayCrossingTimeout), and the very first scroll event after the history
// settles shows nothing — Telegram only shows it once it has a previous position to compare with.
const hideTimeout = 1000, dayCrossingTimeout = 3000

export interface ScrollDate { time: number; shown: boolean }

export function useScrollDate(scroll: RefObject<HTMLDivElement | null>, virtual: Virtualizer<HTMLDivElement, Element> | null,
  times: number[], inlineDates: boolean[], ready: boolean): { value: ScrollDate | null; check(): void; reset(): void } {
  const [value, setValue] = useState<ScrollDate | null>(null)
  const last = useRef<{ index: number; offset: number; time: number } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const held = useRef(false)
  useEffect(() => () => clearTimeout(timer.current), [])

  // Where the history came to rest when it opened: Telegram's first onScroll is the chat putting itself in place,
  // so that position is recorded here and the reader's very first scroll already has something to compare with.
  useEffect(() => {
    if (!ready) return
    const element = scroll.current
    if (!element || !virtual) { last.current = null; return }
    const offset = element.scrollTop
    const item = virtual.getVirtualItems().find(entry => entry.end > offset)
    const time = item ? times[item.index] : undefined
    last.current = item && time !== undefined ? { index: item.index, offset: offset - item.start, time } : null
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the resting place is read once, when the chat settles
  }, [ready, virtual, scroll])

  const hideLater = useCallback((delay: number) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => { held.current = false; setValue(current => current && { ...current, shown: false }) }, delay)
  }, [])

  const check = useCallback(() => {
    const element = scroll.current
    if (!element || !virtual) return
    const offset = element.scrollTop
    const item = virtual.getVirtualItems().find(entry => entry.end > offset)
    const time = item ? times[item.index] : undefined
    if (!item || time === undefined) {
      last.current = null; clearTimeout(timer.current); held.current = false
      setValue(current => current && { ...current, shown: false })
      return
    }
    const previous = last.current
    const position = { index: item.index, offset: offset - item.start, time }
    last.current = position
    if (previous && previous.index === position.index && previous.offset === position.offset) return
    // The message's own date line is at the top of the screen: that line is the date, and nothing floats over it.
    const inPlace = inlineDates[item.index] === true && item.start >= offset - 4
    const crossedDay = Boolean(previous && !sameDay(previous.time, time))
    // The scrolling a chat does to put itself in place when it opens is not scrolling the reader did.
    const moved = ready && Boolean(previous)
    setValue({ time, shown: !inPlace && moved })
    if (inPlace || !moved) { clearTimeout(timer.current); held.current = false; return }
    held.current = crossedDay
    hideLater(crossedDay ? dayCrossingTimeout : hideTimeout)
  }, [scroll, virtual, times, inlineDates, ready, hideLater])

  // A history that was replaced starts again: the next scroll is the first one.
  const reset = useCallback(() => {
    last.current = null; clearTimeout(timer.current); held.current = false
    setValue(null)
  }, [])
  return { value, check, reset }
}
