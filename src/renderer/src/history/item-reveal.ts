// B306 ② (tdesktop HistoryWidget::startItemRevealAnimations / revealItemsCallback, history_widget.cpp:8745-8803): a
// message that joins the bottom of a history followed at its bottom — sent or received — comes up from under the
// composer. As tdesktop takes the rising height off the list (_list->changeItemsRevealHeight) and keeps the scroll at
// the bottom, the list is drawn that much shorter, clipped, and grows back over itemRevealDuration (150 ms,
// ui/chat/chat.style:58) with anim::easeOutCirc. A transform would not do: it widens the scroller's overflow and the
// bottom follows it, so nothing moves on screen. A history read away from the bottom, a hidden window or reduced motion
// (tdesktop's anim::Disabled, :4681-4689) shows it in place at once.
export const itemRevealMs = 150

// How many entries joined the end of the list: only new keys after the old last one, which is still there. A history
// read again, another chat, older pages put on top or a message on its way taking its server copy's place (the same
// key, B303) add none.
export function appendedCount(previous: readonly string[], next: readonly string[]): number {
  if (!previous.length) return 0
  const at = next.lastIndexOf(previous[previous.length - 1]!)
  if (at < 0) return 0
  const known = new Set(previous)
  for (let index = at + 1; index < next.length; index++) if (known.has(next[index]!)) return 0
  return next.length - at - 1
}
export function revealAllowed(atBottom: boolean, visible: boolean, reducedMotion: boolean): boolean {
  return atBottom && visible && !reducedMotion
}
export const easeOutCirc = (t: number): number => Math.sqrt(1 - (t - 1) ** 2)
// The height still hidden at a moment of a rise of `height` that started at `start` (ms). B409-3: not rounded — the rise
// is the row's measured height (a fraction of a pixel at 125 % or 150 %), and a rounded one hid a little more than the
// row at the start and let the list step the difference.
export function remainingAt(height: number, start: number, now: number): number {
  const t = Math.min(1, Math.max(0, (now - start) / itemRevealMs))
  return t >= 1 ? 0 : height * (1 - easeOutCirc(t))
}

// Starts the rise, adding to what a rise still running has left (tdesktop adds the new height to _itemsRevealHeight).
const rising = new WeakMap<HTMLElement, { height: number; start: number; frame: number }>()
export function reveal(scroller: HTMLElement, inner: HTMLElement, height: number, now = performance.now()): void {
  const running = rising.get(inner)
  if (running) cancelAnimationFrame(running.frame)
  const state = { height: (running ? remainingAt(running.height, running.start, now) : 0) + height, start: now, frame: 0 }
  rising.set(inner, state)
  inner.style.overflow = 'clip'
  const step = (): void => {
    const left = remainingAt(state.height, state.start, performance.now())
    // The list's height is calc(total − --reveal) (history-widget.tsx), so a render meanwhile keeps what is hidden.
    inner.style.setProperty('--reveal', `${left}px`)
    scroller.scrollTop = scroller.scrollHeight
    if (left > 0) state.frame = requestAnimationFrame(step)
    else { rising.delete(inner); inner.style.removeProperty('--reveal'); inner.style.overflow = '' }
  }
  step()
}
