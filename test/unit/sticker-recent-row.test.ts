import assert from 'node:assert/strict'
import { test } from 'node:test'
import { recentDisplayLimit, recentStickerRow } from '../../src/shared/stickers'

// Review 10-10 (latest Telegram source check): tdesktop's «Recent» row leaves out the favourites and shows 20
// (stickers_list_widget.cpp:78, :3352-3367 — the same in 64ca5475 and feec5f9d). Only the drawing changes.
const items = (ids: string[]) => ids.map(id => ({ id }))
const ids = (row: { id: string }[]) => row.map(item => item.id)

test('a sticker that is a favourite is not shown again in the recent row', () => {
  assert.deepEqual(ids(recentStickerRow(items(['a', 'b', 'c', 'd']), items(['b', 'x']))), ['a', 'c', 'd'])
  assert.deepEqual(ids(recentStickerRow(items(['a', 'b']), null)), ['a', 'b'], 'favourites not read yet: the list as it is')
})

test('the row shows 20 at most — the 21st on is not drawn, counted after the favourites are left out', () => {
  assert.equal(recentDisplayLimit, 20)
  const thirty = Array.from({ length: 30 }, (_, i) => `s${i + 1}`)
  assert.deepEqual(ids(recentStickerRow(items(thirty), [])), thirty.slice(0, 20))
  // Two favourites among the first twenty: the row still fills to twenty from further down (tdesktop counts what it adds).
  assert.deepEqual(ids(recentStickerRow(items(thirty), items(['s2', 's5']))), thirty.filter(id => id !== 's2' && id !== 's5').slice(0, 20))
  assert.deepEqual(ids(recentStickerRow(items(['a', 'a', 'b']), [])), ['a', 'b'], 'each sticker once')
})

test('a sticker taken out of the favourites is back in the recent row, at its place in the list', () => {
  const recent = items(['a', 'b', 'c'])
  assert.deepEqual(ids(recentStickerRow(recent, items(['b']))), ['a', 'c'])
  assert.deepEqual(ids(recentStickerRow(recent, [])), ['a', 'b', 'c'])
})
