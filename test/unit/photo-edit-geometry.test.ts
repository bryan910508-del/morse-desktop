import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dragCrop, flipped, orientedSize, pixelRect, rectToOriented, rectToPicture, rotated, toOriented, toPicture, type Orientation } from '../../src/renderer/src/media/photo-edit-geometry'

// tdesktop PhotoModifications keeps crop and paint in the picture's pixels and turns the picture for display.
const size = { width: 400, height: 200 }
const corners = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 200 }, { x: 0, y: 200 }]
const all: Orientation[] = [0, 90, 180, 270].flatMap(angle => [false, true].map(flip => ({ angle: angle as Orientation['angle'], flipped: flip })))

test('a quarter turn clockwise puts the top left corner at the top right', () => {
  const turned = { angle: 90, flipped: false } as const
  assert.deepEqual(orientedSize(size, 90), { width: 200, height: 400 })
  assert.deepEqual(corners.map(point => toOriented(point, size, turned)), [{ x: 200, y: 0 }, { x: 200, y: 400 }, { x: 0, y: 400 }, { x: 0, y: 0 }])
})

test('every orientation maps back to the same picture pixel', () => {
  for (const orientation of all) {
    for (const point of [...corners, { x: 123, y: 45 }]) {
      const back = toPicture(toOriented(point, size, orientation), size, orientation)
      assert.ok(Math.abs(back.x - point.x) < 1e-9 && Math.abs(back.y - point.y) < 1e-9, JSON.stringify({ orientation, point, back }))
    }
  }
})

test('rotating and flipping act on what is shown: a flip mirrors the screen, whatever the angle', () => {
  for (const orientation of all) {
    const before = orientedSize(size, orientation.angle), after = flipped(orientation)
    for (const point of [{ x: 10, y: 20 }, { x: 390, y: 180 }]) {
      const shown = toOriented(point, size, orientation), mirrored = toOriented(point, size, after)
      assert.deepEqual({ x: Math.round(mirrored.x), y: Math.round(mirrored.y) }, { x: Math.round(before.width - shown.x), y: Math.round(shown.y) })
    }
    const turned = rotated(orientation), shown = toOriented({ x: 10, y: 20 }, size, orientation), next = toOriented({ x: 10, y: 20 }, size, turned)
    assert.deepEqual({ x: Math.round(next.x), y: Math.round(next.y) }, { x: Math.round(before.height - shown.y), y: Math.round(shown.x) })
  }
})

test('a crop drawn on the turned picture is the same area of the picture', () => {
  const crop = { x: 50, y: 20, width: 100, height: 60 }
  for (const orientation of all) {
    const back = rectToPicture(rectToOriented(crop, size, orientation), size, orientation)
    assert.deepEqual(back, crop)
  }
})

test('the crop frame stays inside the picture and keeps its minimum size', () => {
  const area = { width: 400, height: 200 }, start = { x: 100, y: 50, width: 200, height: 100 }
  assert.deepEqual(dragCrop(start, 'move', 500, -500, area, 40), { x: 200, y: 0, width: 200, height: 100 })
  assert.deepEqual(dragCrop(start, 'nw', -500, 500, area, 40), { x: 0, y: 110, width: 300, height: 40 })
  assert.deepEqual(dragCrop(start, 'e', -1000, 0, area, 40), { x: 100, y: 50, width: 40, height: 100 })
  assert.deepEqual(pixelRect({ x: -3.4, y: 10.6, width: 500, height: 30.2 }, area), { x: 0, y: 11, width: 400, height: 30 })
})
