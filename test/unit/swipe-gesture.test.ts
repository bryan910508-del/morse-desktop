import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SwipeGesture, swipeBackSpeedRatio, swipeThreshold, type SwipeFrame, type SwipeKind } from '../../src/renderer/src/history/swipe-gesture'

// B58 (Telegram R-66, ui/controls/swipe_handler.cpp): two-finger swipes in a chat — right goes back, left replies.
function rig(resolve: (direction: 'right-to-left' | 'left-to-right') => SwipeKind | null = direction => direction === 'right-to-left' ? 'back' : 'reply', back = true) {
  const frames: (SwipeFrame | null)[] = [], done: SwipeKind[] = []
  const gesture = new SwipeGesture({ resolve, frame: frame => frames.push(frame), finish: kind => done.push(kind) }, () => back)
  // deltaX per event; the sum is a fifth of it.
  const swipe = (...deltas: [number, number?][]) => deltas.map(([x, y]) => gesture.wheel(x, y ?? 0))
  return { gesture, frames, done, swipe, last: () => frames.at(-1) }
}

test('fingers right (deltaX below 0) go back; fingers left reply', () => {
  const back = rig()
  back.swipe([-10], ...Array.from({ length: 6 }, () => [-20] as [number]))
  assert.equal(back.last()?.kind, 'back')
  back.gesture.end()
  assert.deepEqual(back.done, ['back'])
  const reply = rig()
  reply.swipe([10], ...Array.from({ length: 6 }, () => [60] as [number]))
  assert.equal(reply.last()?.kind, 'reply')
  assert.ok(reply.last()!.translation < 0, 'the bubble moves left')
  reply.gesture.end()
  assert.deepEqual(reply.done, ['reply'])
})

test('a reply needs 50 px of summed movement, a swipe back 0.35 of that', () => {
  const reply = rig()
  // First event fixes the direction only; then 49 px (245 × 0.2) is short of 50.
  reply.swipe([5], [245])
  assert.ok(reply.last()!.ratio < 1)
  reply.gesture.end()
  assert.deepEqual(reply.done, [], 'released under the threshold: nothing')
  const back = rig()
  back.swipe([-5], [-(swipeThreshold * swipeBackSpeedRatio / 0.2) - 1])
  assert.ok(back.last()!.ratio >= 1 && back.last()!.reached)
  back.gesture.end()
  assert.deepEqual(back.done, ['back'])
})

test('it locks horizontal only when sideways leads by more than a pixel; vertical lets the page scroll', () => {
  const r = rig()
  assert.deepEqual(r.swipe([5, 0], [3, 20]), [false, false], 'down leads: vertical')
  assert.equal(r.gesture.active, false)
  assert.deepEqual(r.swipe([40, 0]), [false], 'still vertical until the fingers lift')
  r.gesture.end()
  assert.deepEqual(r.done, [])
  const h = rig()
  assert.deepEqual(h.swipe([5], [20, 2]), [false, true])
  assert.equal(h.gesture.active, true)
})

test('reached at 1, reset under 0.95, never done once pulled back under 1', () => {
  const r = rig()
  r.swipe([5], [260])
  assert.equal(r.last()!.reached, true)
  r.swipe([-30])
  assert.equal(r.last()!.reached, false, '0.92 is under 0.95')
  r.gesture.end()
  assert.deepEqual(r.done, [])
})

test('nothing to do that way, or back switched off on the Mac: the swipe is left to scrolling', () => {
  const none = rig(() => null)
  assert.deepEqual(none.swipe([5], [200]), [false, false])
  none.gesture.end()
  assert.deepEqual([none.done, none.frames], [[], []])
  const off = rig(undefined, false)
  off.swipe([-5], [-200])
  off.gesture.end()
  assert.deepEqual(off.done, [], 'back is off')
  off.swipe([5], [300])
  off.gesture.end()
  assert.deepEqual(off.done, ['reply'], 'a reply still works')
})

test('past the threshold the movement is damped, and a new swipe starts clean', () => {
  const r = rig()
  r.swipe([5], [250])
  const at1 = r.last()!.translation
  r.swipe([250])
  assert.ok(Math.abs(r.last()!.translation) < Math.abs(at1) * 2, 'twice the distance is far less than twice the shift')
  r.gesture.end()
  assert.equal(r.frames.at(-1), null, 'the frame clears when it ends')
  r.swipe([-5], [-100])
  assert.equal(r.last()!.kind, 'back')
})
