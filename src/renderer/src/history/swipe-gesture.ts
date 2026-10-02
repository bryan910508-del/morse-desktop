// B58 (Telegram R-66): a two-finger horizontal swipe, as tdesktop's Ui::Controls::SetupSwipeHandler reads one
// (ui/controls/swipe_handler.cpp at 64ca5475). Wheel deltas are summed at a fifth (kSwipeSlow, :29, :387); the first
// one fixes the direction and what it would do (:191-211); the sum then locks horizontal or vertical once one leads
// by more than a pixel (:234-245); horizontally, ratio = distance / threshold (50 px, a swipe back 0.35 of it,
// :77, :31), shown up to 1.5 and done if it is at 1 or more when the fingers lift (:168-187). The first time it
// reaches 1 it is «reached» (bounce, :250-262) until it falls under 0.95 (:263-277).
//
// Directions keep tdesktop's names. DOM deltaX has the sign of Qt's −ScrollDelta, so the sum goes below 0 when the
// fingers move right (natural scrolling) — RightToLeft, which is «back» in the chat (history_inner_widget.cpp:706-727)
// and in the side panel (info_content_widget.cpp:596-598); above 0 is LeftToRight, a reply to the message under the
// pointer. With natural scrolling off both Qt's and the DOM's signs turn, so this stays the same as Telegram.
//
// The DOM has no scroll phases, and Chromium's gesture events mark scroll sequences, not the fingers lifting (Qt
// ScrollEnd) or the momentum after (ScrollMomentum, :373-382): a pause in the wheel events (swipeIdleEndMs) ends the
// swipe, or a fling where one is reported — the platform's limit, written down in the B58 design note.
export const swipeSlow = 0.2
export const swipeThreshold = 50
export const swipeBackSpeedRatio = 0.35
export const swipeMaxRatio = 1.5
export const swipeResetReachedOn = 0.95
export const swipeIdleEndMs = 120

export type SwipeDirection = 'right-to-left' | 'left-to-right'
export type SwipeKind = 'back' | 'reply'
export interface SwipeFrame { kind: SwipeKind; ratio: number; translation: number; reached: boolean }
export interface SwipeHooks {
  // What a swipe in this direction would do where it started, or null for nothing (the sum then scrolls as usual).
  resolve(direction: SwipeDirection): SwipeKind | null
  frame(frame: SwipeFrame | null): void
  finish(kind: SwipeKind): void
}

// Logarithmic damping past the threshold (DampedOverswipe, :33-46).
export function dampedOverswipe(translation: number): number {
  if (!translation) return 0
  return Math.sign(translation) * 16 * Math.log(1 + Math.abs(translation) / 10)
}
// A swipe back keeps its ratio inside a window one wide that follows the fingers (RatioRange, :50-70).
class RatioRange {
  private min = 0
  private max = 1
  ratio(value: number): number {
    if (value < this.min) { const shift = this.min - value; this.min -= shift; this.max = this.min + 1 }
    else if (value > this.max) { const shift = value - this.max; this.min += shift; this.max = this.min + 1 }
    return (value - this.min) / (this.max - this.min)
  }
}

export class SwipeGesture {
  private started = false
  private direction: SwipeDirection | null = null
  private kind: SwipeKind | null = null
  private orientation: 'horizontal' | 'vertical' | null = null
  private dx = 0
  private dy = 0
  private threshold = swipeThreshold
  private range: RatioRange | null = null
  private reached = false
  private ratio = 0

  constructor(private readonly hooks: SwipeHooks, private readonly backAllowed: () => boolean = () => true) {}

  // One wheel event; true while it belongs to a horizontal swipe, so the page does not scroll with it.
  wheel(deltaX: number, deltaY: number): boolean {
    const x = this.dx + deltaX * swipeSlow, y = this.dy + deltaY * swipeSlow
    if (!this.started) {
      this.started = true
      this.choose(x)
      this.dx = 0; this.dy = 0
      return false
    }
    if (!this.direction) { this.choose(x); return false }
    if (this.orientation === 'vertical') return false
    this.dx = x; this.dy = y
    if (!this.orientation) {
      const lead = Math.abs(x) - Math.abs(y)
      if (lead > 1) this.orientation = 'horizontal'
      else if (lead < -1) { this.orientation = 'vertical'; return false }
      else return false
    }
    const sign = this.direction === 'left-to-right' ? 1 : -1
    const raw = x * sign / this.threshold
    this.show(this.range ? this.range.ratio(raw) : raw)
    return true
  }
  // The fingers lifted, momentum began, the pointer left, or the wheel paused (ScrollEnd / ScrollMomentum).
  end(): void {
    if (this.orientation === 'horizontal' && this.kind) {
      const done = Math.min(swipeMaxRatio, Math.max(0, this.ratio))
      if (done >= 1) this.hooks.finish(this.kind)
    }
    if (this.orientation === 'horizontal') this.hooks.frame(null)
    this.started = false; this.direction = null; this.kind = null; this.orientation = null
    this.dx = 0; this.dy = 0; this.range = null; this.reached = false; this.ratio = 0
  }
  get active(): boolean { return this.orientation === 'horizontal' }

  private choose(x: number): void {
    if (!x) return
    this.direction = x < 0 ? 'right-to-left' : 'left-to-right'
    const kind = this.hooks.resolve(this.direction)
    this.kind = kind && !(kind === 'back' && !this.backAllowed()) ? kind : null
    this.threshold = swipeThreshold * (this.kind === 'back' ? swipeBackSpeedRatio : 1)
    this.range = this.kind === 'back' ? new RatioRange() : null
    // Nothing to do this way (or back switched off in the Mac's settings): the swipe is left to scrolling (:207-211).
    if (!this.kind) this.orientation = 'vertical'
  }
  private show(ratio: number): void {
    ratio = Math.max(ratio, 0)
    this.ratio = ratio
    const sign = this.direction === 'left-to-right' ? 1 : -1
    const thresholdShift = -Math.min(ratio, 1) * this.threshold
    const overswipe = -Math.max(ratio - 1, 0) * this.threshold
    const translation = (thresholdShift + dampedOverswipe(overswipe)) * sign
    if (!this.reached && ratio >= 1) this.reached = true
    else if (this.reached && ratio < swipeResetReachedOn) this.reached = false
    this.hooks.frame({ kind: this.kind!, ratio, translation, reached: this.reached })
  }
}
