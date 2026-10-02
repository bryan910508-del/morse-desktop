import { useEffect, useRef, useSyncExternalStore, type RefObject } from 'react'
import { ArrowLeft, Reply } from 'lucide-react'
import { desktop, useDesktopEvent } from '../app/store'
import { SwipeGesture, swipeIdleEndMs, type SwipeDirection, type SwipeFrame, type SwipeKind } from './swipe-gesture'

// B58: two-finger horizontal swipes on one surface (the chat, or the side panel), the way the pointer's position
// decides in Telegram — the wheel events go to what is under it. swipe-gesture.ts is the reading; this wires it to the
// DOM and draws it.
export interface SwipePlace { x: number; y: number }
export interface SwipeOptions {
  enabled: () => boolean
  resolve(direction: SwipeDirection, place: SwipePlace): SwipeKind | null
  finish(kind: SwipeKind): void
  // The reply's message row, to slide its bubble (Telegram moves the message, history_view_message.cpp:1723-1726).
  row?: () => HTMLElement | null
}

// Whether something under the pointer scrolls sideways itself (Telegram canConsumeHorizontalScroll): a sticker or
// album strip keeps its own swipe.
export function scrollsSideways(target: Element | null, stop: Element, direction: SwipeDirection): boolean {
  for (let node = target; node && node !== stop; node = node.parentElement) {
    const style = getComputedStyle(node)
    if (!/(auto|scroll)/.test(style.overflowX) || node.scrollWidth <= node.clientWidth) continue
    // Fingers right scroll it back towards its start, fingers left on towards its end.
    if (direction === 'right-to-left' ? node.scrollLeft > 0 : node.scrollLeft + node.clientWidth < node.scrollWidth - 1) return true
  }
  return false
}
// A layer, a menu or the emoji panel open: no swipe (as Telegram's panels above the chat take the events).
const overlaid = (): boolean => Boolean(document.querySelector('.layer, .popup-menu, .entity-panel'))

function store() {
  let value: SwipeFrame | null = null
  const listeners = new Set<() => void>()
  return {
    set(next: SwipeFrame | null): void { value = next; for (const listener of listeners) listener() },
    use: (): SwipeFrame | null => useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => value)
  }
}

export function useSwipe(target: RefObject<HTMLElement | null>, options: SwipeOptions) {
  const optionsRef = useRef(options); optionsRef.current = options
  const frames = useRef(store()).current
  const state = useRef<{ gesture: SwipeGesture; idle: ReturnType<typeof setTimeout> | null; coasting: boolean; row: HTMLElement | null } | null>(null)
  if (!state.current) {
    const slide = (frame: SwipeFrame | null): void => {
      const s = state.current!
      if (frame?.kind === 'reply' && !s.row) s.row = optionsRef.current.row?.() ?? null
      const bubble = s.row?.querySelector<HTMLElement>('.bubble')
      if (bubble) {
        bubble.style.transition = frame ? 'none' : 'transform 150ms ease-out'
        bubble.style.transform = frame?.kind === 'reply' ? `translateX(${frame.translation}px)` : ''
      }
      if (!frame) s.row = null
    }
    state.current = { idle: null, coasting: false, row: null, gesture: new SwipeGesture({
      resolve: direction => {
        const place = lastPlace.current
        const element = target.current
        if (!element || overlaid() || scrollsSideways(document.elementFromPoint(place.x, place.y), element, direction)) return null
        return optionsRef.current.resolve(direction, place)
      },
      frame: frame => { slide(frame); frames.set(frame) },
      finish: kind => optionsRef.current.finish(kind)
    }, () => desktop.value?.swipeBack !== false) }
  }
  const lastPlace = useRef<SwipePlace>({ x: 0, y: 0 })
  // A fling, where Chromium reports one, ends the swipe as the fingers lifting does; the wheel events coasting after it
  // are not a new swipe until they pause (Telegram's ScrollMomentum). Otherwise a pause in the wheel ends it.
  useDesktopEvent(event => {
    if (event.type !== 'scroll-phase') return
    const s = state.current!
    s.gesture.end(); s.coasting = true
  })
  useEffect(() => {
    const element = target.current
    if (!element) return
    const s = state.current!
    const wheel = (event: WheelEvent): void => {
      // A mouse wheel (lines or pages), shift with a wheel, or a pinch is never a swipe.
      if (event.deltaMode !== 0 || event.shiftKey || event.ctrlKey || !optionsRef.current.enabled()) return
      if (s.idle) clearTimeout(s.idle)
      s.idle = setTimeout(() => { s.idle = null; s.coasting = false; s.gesture.end() }, swipeIdleEndMs)
      if (s.coasting) return
      if (!s.gesture.active) lastPlace.current = { x: event.clientX, y: event.clientY }
      if (s.gesture.wheel(event.deltaX, event.deltaY)) event.preventDefault()
    }
    const leave = (): void => { if (s.gesture.active) s.gesture.end() }
    element.addEventListener('wheel', wheel, { passive: false })
    element.addEventListener('pointerleave', leave)
    return () => {
      element.removeEventListener('wheel', wheel); element.removeEventListener('pointerleave', leave)
      if (s.idle) clearTimeout(s.idle)
      s.gesture.end()
    }
  }, [target])
  return frames.use
}

// The swipe back: a round plate with an arrow coming in from the left edge (SetupSwipeBack, swipe_handler.cpp:395-534),
// the chat's service colours, fading in with the ratio and bouncing once it is reached.
export function SwipeBackPlate({ frame }: { frame: SwipeFrame | null }) {
  if (!frame || frame.kind !== 'back') return null
  const ratio = Math.min(frame.ratio, 1), size = 150
  const left = -size * 0.8 + (size * 0.5 - size + size * 0.8) * ratio
  return <div className={`swipe-back${frame.reached ? ' reached' : ''}`} style={{ left, opacity: ratio }} aria-hidden="true"><span><ArrowLeft size={30} strokeWidth={2.6} /></span></div>
}
// The reply: an arrow in a circle beside the sliding bubble, its ring filling with the ratio (history_view_message.cpp:2236-2310).
export function SwipeReplyIcon({ frame, row, host }: { frame: SwipeFrame | null; row: HTMLElement | null; host: HTMLElement | null }) {
  if (!frame || frame.kind !== 'reply' || !row || !host) return null
  const ratio = Math.min(frame.ratio, 1), size = 36
  const box = row.getBoundingClientRect(), base = host.getBoundingClientRect()
  const bubble = row.querySelector('.bubble')?.getBoundingClientRect()
  const own = row.classList.contains('own')
  const outer = 80 + (own || !bubble ? box.right - base.left : bubble.right - base.left - frame.translation)
  const shift = Math.min(size * 1.5 * frame.ratio, -frame.translation) + 80 * ratio * (own ? 1 : 0.7)
  const circumference = Math.PI * (size - 4)
  return <div className={`swipe-reply${frame.reached ? ' reached' : ''}`} aria-hidden="true"
    style={{ left: outer - shift, top: (bubble ?? box).top - base.top + ((bubble ?? box).height - size) / 2, opacity: ratio }}>
    <svg className="swipe-ring" width={size} height={size}><circle cx={size / 2} cy={size / 2} r={(size - 4) / 2} strokeDasharray={`${circumference * ratio} ${circumference}`} /></svg>
    <Reply size={18} />
  </div>
}
