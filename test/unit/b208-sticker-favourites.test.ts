import assert from 'node:assert/strict'
import { test } from 'node:test'
import Database from 'better-sqlite3-multiple-ciphers'
import { executeSticker } from '../../src/main/storage/sticker-table'

// B208 (10-07): this device's favourites list newest first, as tdesktop's do — a new one goes to the front
// (Stickers::pushFavedToFront, data_stickers.cpp:549-559) and one saved again moves there (moveFavedToFront, :561-578).
const png = (seed: number): Uint8Array => new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]), Buffer.alloc(64, seed)]))

test('favourites list newest first, and one saved again moves to the front', () => {
  const db = new Database(':memory:')
  db.exec('CREATE TABLE stickers (id TEXT PRIMARY KEY, kind TEXT NOT NULL, data BLOB NOT NULL, created_at REAL NOT NULL)')
  const now = Date.now
  let clock = 1000
  Date.now = () => (clock += 10)
  try {
    const [a, b, c] = [1, 2, 3].map(seed => (executeSticker(db, { kind: 'sticker-add', data: png(seed) }) as { id: string }).id)
    const list = (): string[] => (executeSticker(db, { kind: 'stickers-list' }) as { id: string }[]).map(row => row.id)
    assert.deepEqual(list(), [c, b, a])
    executeSticker(db, { kind: 'sticker-add', data: png(1) })
    assert.deepEqual(list(), [a, c, b], 'kept once, now first')
  } finally { Date.now = now }
})
