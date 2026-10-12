import assert from 'node:assert/strict'
import { test } from 'node:test'
import { layoutMediaGroup } from '../../src/shared/grouped-layout'
import { albumMosaic } from '../../src/renderer/src/history/album-mosaic'

// B310 (user: «앨범 첫 장만 제대로, 나머지는 띠처럼 잘림»; tdesktop Ui::LayoutMediaGroup, ui/grouped_layout.cpp): every photo
// of an album inside the group's width, placed by its own shape — the numbers are tdesktop's formulas worked by hand.
const box = (rects: ReturnType<typeof layoutMediaGroup>) => rects.map(rect => [rect.x, rect.y, rect.width, rect.height])

test('two squares side by side (layoutTwoLeftRightEqual)', () => {
  assert.deepEqual(box(layoutMediaGroup([{ width: 1, height: 1 }, { width: 1, height: 1 }])), [[0, 0, 213, 213], [217, 0, 213, 213]])
})
test('two wide ones of the same shape one over the other (layoutTwoTopBottom)', () => {
  // ratios 2: average (1+2+2)/2 = 2.5 > 1.4, the same ratio → top and bottom, height min(430/2, (430-4)/2) = 213.
  assert.deepEqual(box(layoutMediaGroup([{ width: 1280, height: 640 }, { width: 1280, height: 640 }])), [[0, 0, 430, 213], [0, 217, 430, 213]])
})
test('three with a tall first: it on the left, the other two stacked (layoutThreeLeftAndOther)', () => {
  const rects = layoutMediaGroup([{ width: 960, height: 1280 }, { width: 1280, height: 960 }, { width: 1, height: 1 }])
  assert.equal(rects[0]!.x, 0); assert.equal(rects[0]!.height, 430)
  assert.equal(rects[1]!.x, rects[2]!.x); assert.equal(rects[1]!.y + rects[1]!.height + 4, rects[2]!.y)
  assert.ok(rects.every(rect => rect.x + rect.width <= 430), 'none past the group')
})
test('three with a square first: it on top, two below (layoutThreeTopAndOther)', () => {
  const rects = layoutMediaGroup([{ width: 1, height: 1 }, { width: 960, height: 1280 }, { width: 1280, height: 960 }])
  assert.deepEqual([rects[0]!.width, rects[1]!.y === rects[2]!.y, rects[1]!.x, rects[2]!.x + rects[2]!.width], [430, true, 0, 430])
})
test('five and more: rows, each row filling the width, nothing past it (ComplexLayouter)', () => {
  const rects = layoutMediaGroup(Array.from({ length: 7 }, (_, index) => index % 2 ? { width: 1280, height: 960 } : { width: 960, height: 1280 }))
  assert.equal(rects.length, 7)
  const rows = new Map<number, number>()
  for (const rect of rects) rows.set(rect.y, Math.max(rows.get(rect.y) ?? 0, rect.x + rect.width))
  assert.ok([...rows.values()].every(right => right === 430), 'each row ends at the group\'s edge')
})
test('the album\'s tiles as hundredths of the group; a photo of unknown size is a square', () => {
  const mosaic = albumMosaic(3, { imageWidthsPx: [300, 960, 1280], imageHeightsPx: [300, 1280, 960] })
  assert.ok(mosaic.tiles.every(tile => tile.left >= 0 && tile.top >= 0 && tile.left + tile.width <= 100.01 && tile.top + tile.height <= 100.01))
  const unknown = albumMosaic(2, {})
  assert.deepEqual([unknown.width, unknown.height], [430, 213])
})

// B331 (tdesktop Photo::countCurrentSize(newWidth)): one photo's width is its own — at most 320 px, a tall one the width
// its 420 px height gives — and nothing of the window's; the bubble it is shown in narrows it further (max-width).
test('one photo or video is sized by itself, never by the window', async () => {
  const { singleMediaWidth } = await import('../../src/renderer/src/history/album-mosaic')
  assert.equal(singleMediaWidth(4 / 3), '320px')
  assert.equal(singleMediaWidth(1), '320px')
  assert.equal(singleMediaWidth(9 / 16), '236px')
  assert.equal(singleMediaWidth(0.1), '100px')
  for (const ratio of [0.2, 0.5, 1, 2, 4]) assert.doesNotMatch(singleMediaWidth(ratio), /vw|cqw/)
})
