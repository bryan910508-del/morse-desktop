import type Database from 'better-sqlite3-multiple-ciphers'
import { createHash } from 'node:crypto'
import { maxStickerBytes, maxStickers, stickerKind, type StickerKind } from '../../shared/stickers'

export type StickerCommand =
  | { kind: 'stickers-list' }
  | { kind: 'sticker-read'; id: string }
  | { kind: 'sticker-add'; data: Uint8Array }
  | { kind: 'sticker-remove'; id: string }
  // B210 §4: the device's list after its newest went to the server (StickerLibrary.migrate).
  | { kind: 'stickers-clear' }

const validId = (id: unknown): string => {
  if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid sticker id')
  return id
}

// MorseStickerLibrary.save / items: the same bytes are kept once, within the library's limits, newest first as
// tdesktop's favourites are — a new one goes to the front (Stickers::pushFavedToFront, data_stickers.cpp:549-559) and
// one saved again moves there (moveFavedToFront, :561-578, called from setIsFaved :603-604).
export function executeSticker(db: Database.Database, command: StickerCommand): unknown {
  if (command.kind === 'stickers-list') {
    return (db.prepare('SELECT id, kind, length(data) AS size FROM stickers ORDER BY created_at DESC, rowid DESC').all() as { id: string; kind: StickerKind; size: number }[])
  }
  if (command.kind === 'sticker-read') {
    const row = db.prepare('SELECT kind, data FROM stickers WHERE id=?').get(validId(command.id)) as { kind: StickerKind; data: Buffer } | undefined
    return row ? { kind: row.kind, data: new Uint8Array(row.data) } : null
  }
  if (command.kind === 'sticker-remove') { db.prepare('DELETE FROM stickers WHERE id=?').run(validId(command.id)); return null }
  if (command.kind === 'stickers-clear') { db.prepare('DELETE FROM stickers').run(); return null }
  const data = Buffer.from(command.data)
  const kind = stickerKind(data)
  if (!kind || !data.length || data.length > maxStickerBytes) throw Object.assign(new Error('Invalid sticker'), { deliveryCode: 'invalid' })
  const id = createHash('sha256').update(data).digest('hex')
  return db.transaction(() => {
    const exists = db.prepare('SELECT 1 FROM stickers WHERE id=?').get(id)
    if (!exists) {
      const count = (db.prepare('SELECT COUNT(*) AS count FROM stickers').get() as { count: number }).count
      if (count >= maxStickers) throw Object.assign(new Error('Sticker capacity'), { deliveryCode: 'capacity' })
      db.prepare('INSERT INTO stickers(id,kind,data,created_at) VALUES(?,?,?,?)').run(id, kind, data, Date.now())
    } else db.prepare('UPDATE stickers SET created_at=? WHERE id=?').run(Date.now(), id)
    return { id, kind, size: data.length }
  })()
}
