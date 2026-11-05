import assert from 'node:assert/strict'
import { test } from 'node:test'
import { stickerPackFromDocument } from '../../src/main/network/sticker-pack-read'
import { stickerPackRemoveWrite } from '../../src/main/network/sticker-pack-write'
import { documents, type FirestoreDocument } from '../../src/main/network/firestore-values'
import { maxStickerPackItems } from '../../src/shared/sticker-packs'

// B527: a sticker listed twice in a pack (the same file id with another emoji) shows once — the first — as Telegram keeps
// one item per file (EmojiPagerContentSignals.swift:1942-1951) and iOS 92b62bbc · Android 23bda625 now read it; removing
// it takes every line of it and the count is what is left (iOS afcffda4 · Android 23bda625).
const setId = 'set1'
const hex = (n: number) => n.toString(16).padStart(64, '0')
const line = (n: number, emoji: string) => ({ mapValue: { fields: { id: { stringValue: hex(n) }, kind: { stringValue: 'png' },
  path: { stringValue: `sticker_sets/${setId}/${hex(n)}.png` }, emoji: { stringValue: emoji }, bytes: { integerValue: '10' } } } })
const pack = (lines: unknown[]): FirestoreDocument => ({ name: `${documents}/stickerSets/${setId}`, updateTime: { seconds: '1', nanos: 0 },
  fields: { ownerUid: { stringValue: 'me' }, title: { stringValue: '팩' }, stickers: { arrayValue: { values: lines } }, count: { integerValue: String(lines.length) } } } as unknown as FirestoreDocument)

test('B527: the same sticker listed twice shows once, the first line', () => {
  const read = stickerPackFromDocument(pack([line(1, '😀'), line(2, '🙂'), line(1, '😎')]))!
  assert.deepEqual(read.items.map(item => [item.id, item.emoji]), [[hex(1), '😀'], [hex(2), '🙂']])
})

test('B527: the limit counts stickers, not repeated lines', () => {
  const lines = [line(1, 'a'), line(1, 'b'), ...Array.from({ length: maxStickerPackItems }, (_, n) => line(n + 2, 'c'))]
  const read = stickerPackFromDocument(pack(lines))!
  assert.equal(read.items.length, maxStickerPackItems)
  assert.equal(new Set(read.items.map(item => item.id)).size, maxStickerPackItems)
})

test('B527: removing a sticker listed twice takes both lines, and the count is what is left', () => {
  const write = stickerPackRemoveWrite(pack([line(1, '😀'), line(2, '🙂'), line(1, '😎')]), hex(1)) as { update: { fields: { stickers: { arrayValue: { values: unknown[] } }; count: { integerValue: string } } } }
  assert.equal(write.update.fields.stickers.arrayValue.values.length, 1)
  assert.equal(write.update.fields.count.integerValue, '1')
})
