import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dragged, fitLevel, levelIn, levelOut, levelReset, opened, resized, scaleOf, snapped, wheelSteps, zoomIn, zoomOut, zoomReset, zoomToScreenLevel } from '../../src/renderer/src/media/viewer-zoom'
import { viewerZoomKey, type ShortcutInput } from '../../src/shared/shortcuts'

// B301: zooming a picture as tdesktop's media viewer does (media_view_overlay_widget.cpp:204-206, 2792-2991, 7605-7649,
// 8079-8093, 7459-7467, 8742-8744).
const area = { width: 800, height: 600 }

test('a level is the scale z+1, or 1/(1−z) below zero; the fit is the same kind of fraction', () => {
  assert.deepEqual([scaleOf(0), scaleOf(1), scaleOf(7), scaleOf(-1), scaleOf(-7)], [1, 2, 8, 1 / 2, 1 / 8])
  assert.equal(fitLevel({ width: 1600, height: 1200 }, area), -1, 'half the size')
  assert.equal(fitLevel({ width: 400, height: 300 }, area), 1, 'twice the size')
})

test('a picture opens fitted when larger than the area, at its own size otherwise, centred', () => {
  assert.deepEqual(opened({ width: 1600, height: 1200 }, area), { level: zoomToScreenLevel, width: 800, height: 600, x: 0, y: 0 })
  assert.deepEqual(opened({ width: 400, height: 300 }, area), { level: 0, width: 400, height: 300, x: 200, y: 150 })
})

test('steps go one level at a time, the fit put in where a step passes it, from 1/8 to 8', () => {
  const full = fitLevel({ width: 2400, height: 1800 }, area) // −2: a third
  assert.equal(levelIn(-3, full), -2)
  assert.equal(levelIn(zoomToScreenLevel, -1.5), -1, 'from the fit, up to the next whole level')
  assert.equal(levelIn(-2, -1.5), zoomToScreenLevel, 'a step that passes the fit stops at it')
  assert.equal(levelOut(-1, -1.5), zoomToScreenLevel)
  assert.equal(levelIn(7, 0), 7, 'at most 8 times')
  assert.equal(levelOut(-7, 0), -7, 'at least 1/8')
  assert.equal(levelReset(3, -1.5), 0, 'its own size')
  assert.equal(levelReset(0, -1.5), zoomToScreenLevel, 'then the fit')
  assert.equal(levelReset(0, -1), -1, 'a whole fit is that level')
})

test('zooming keeps the point under the pointer still, and the picture never leaves the area', () => {
  const natural = { width: 400, height: 300 }
  const start = opened(natural, area)
  const zoomed = zoomIn(start, natural, area, { x: 300, y: 250 })
  assert.deepEqual({ level: zoomed.level, width: zoomed.width, height: zoomed.height }, { level: 1, width: 800, height: 600 })
  // The point (300, 250) was 100, 100 into the picture; at twice the size it is 200, 200 in — still under the pointer,
  // then snapped so the picture covers the area exactly.
  assert.deepEqual({ x: zoomed.x, y: zoomed.y }, { x: 0, y: 0 })
  const big = zoomIn(zoomed, natural, area, { x: 0, y: 0 })
  assert.deepEqual({ x: big.x, y: big.y, width: big.width }, { x: 0, y: 0, width: 1200 }, 'zoomed around the corner, it stays at the corner')
  assert.deepEqual(zoomOut(zoomed, natural, area), { ...start, level: 0 })
  assert.deepEqual(zoomReset(zoomed, natural, area).level, 0)
})

test('a picture larger than the area drags within its edges; a smaller one stays centred', () => {
  const big = { level: 2, x: -100, y: -50, width: 1200, height: 900 }
  assert.deepEqual(dragged(big, 500, 500, area), { ...big, x: 0, y: 0 }, 'not past the top-left edge')
  assert.deepEqual(dragged(big, -1000, -1000, area), { ...big, x: -400, y: -300 }, 'nor past the bottom-right')
  assert.deepEqual(snapped({ level: 0, x: 10, y: 10, width: 400, height: 300 }, area), { level: 0, x: 200, y: 150, width: 400, height: 300 })
})

test('a fitted picture fits again when the area changes; another keeps its size', () => {
  const natural = { width: 1600, height: 1200 }
  assert.deepEqual(resized(opened(natural, area), natural, { width: 1600, height: 1200 }), { level: zoomToScreenLevel, width: 1600, height: 1200, x: 0, y: 0 })
  const own = { level: 0, x: 0, y: 0, width: 1600, height: 1200 }
  assert.equal(resized(own, natural, { width: 2000, height: 1600 }).width, 1600)
})

test('a pinch steps every 0.25; a mouse-wheel notch with Ctrl/⌘ is one step', () => {
  let carried = { pinch: 0, wheel: 0 }, steps = 0
  for (let n = 0; n < 5; n++) { const result = wheelSteps(-10, carried); carried = result; steps += result.steps }
  assert.equal(steps, 2, '−50 of pinch is 0.5 of a scale: two steps in')
  assert.equal(wheelSteps(100, { pinch: 0, wheel: 0 }).steps, -1, 'one notch down: one step out')
  assert.equal(wheelSteps(-120, { pinch: 0, wheel: 0 }).steps, 1)
})

const key = (k: string, extra: Partial<ShortcutInput> = {}): ShortcutInput => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...extra })
test('Ctrl/⌘ with + = * ] zoom in, − _ out, 0 between its own size and the fit; nothing else', () => {
  for (const [input, kind] of [[key('=', { metaKey: true, code: 'Equal' }), 'in'], [key('+', { ctrlKey: true, shiftKey: true, code: 'Equal' }), 'in'], [key(']', { ctrlKey: true }), 'in'],
    [key('-', { metaKey: true, code: 'Minus' }), 'out'], [key('_', { ctrlKey: true, shiftKey: true }), 'out'], [key('0', { metaKey: true, code: 'Digit0' }), 'reset']] as const)
    assert.equal(viewerZoomKey(input), kind, JSON.stringify(input))
  for (const input of [key('='), key('-'), key('0'), key('0', { ctrlKey: true, altKey: true }), key('k', { ctrlKey: true })]) assert.equal(viewerZoomKey(input), null, JSON.stringify(input))
})
