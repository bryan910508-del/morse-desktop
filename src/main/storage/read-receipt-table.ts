import type Database from 'better-sqlite3-multiple-ciphers'
import { comparePosition } from '../../shared/model'
import { compareReadCursor, readCovers, readCursor, type ReadCursor } from '../../shared/read-receipts'
import { historyPosition, identifier, object } from '../../shared/validation'
import type { ReadReceiptCommand, StoredReadReceipt } from './read-receipt-protocol'

function cursorValue(raw: unknown): ReadCursor {
  const value = object(raw)
  if (typeof value.at !== 'number' || !Number.isFinite(value.at) || value.at <= 0 || value.at > 253402300800000) throw new Error('Invalid read timestamp')
  return { at: value.at, id: value.id === '' ? '' : identifier(value.id) }
}

// This module runs only inside the existing delivery worker.
export function executeReadReceipt(db: Database.Database, command: ReadReceiptCommand): unknown {
  const list = (): StoredReadReceipt[] => {
    const rows = db.prepare('SELECT chat_id,observed,confirmed,pending,reason FROM read_receipts ORDER BY chat_id').all() as
      { chat_id: string; observed: string; confirmed: string | null; pending: number; reason: string }[]
    return rows.map(row => ({ chatId: identifier(row.chat_id), observed: historyPosition(JSON.parse(row.observed))!,
      confirmed: row.confirmed ? cursorValue(JSON.parse(row.confirmed)) : null, pending: row.pending === 1, reason: row.reason }))
  }
  const write = (row: StoredReadReceipt): void => {
    db.prepare(`INSERT INTO read_receipts(chat_id,observed,confirmed,pending,reason) VALUES(?,?,?,?,?)
      ON CONFLICT(chat_id) DO UPDATE SET observed=excluded.observed,confirmed=excluded.confirmed,pending=excluded.pending,reason=excluded.reason`)
      .run(row.chatId, JSON.stringify(row.observed), row.confirmed ? JSON.stringify(row.confirmed) : null, row.pending ? 1 : 0, row.reason)
  }
  const confirm = (row: StoredReadReceipt, cursor: ReadCursor): void => {
    if (!row.confirmed || compareReadCursor(cursor, row.confirmed) > 0) row.confirmed = cursor
    if (readCovers(row.confirmed, readCursor(row.observed)) || readCovers(cursor, readCursor(row.observed))) {
      row.pending = false; row.reason = ''
    }
    write(row)
  }
  return db.transaction(() => {
    const rows = list()
    switch (command.kind) {
      case 'read-list': return rows
      case 'read-enqueue': {
        const chatId = identifier(command.chatId), target = historyPosition(command.target)!
        const old = rows.find(row => row.chatId === chatId)
        if (old && compareReadCursor(readCursor(target), readCursor(old.observed)) <= 0) return null
        if (!old && rows.length >= 10000) throw Object.assign(new Error('Read queue full'), { deliveryCode: 'capacity' })
        write({ chatId, observed: target, confirmed: old?.confirmed ?? null,
          pending: !readCovers(old?.confirmed, readCursor(target)), reason: '' })
        return null
      }
      case 'read-confirm': {
        const row = rows.find(row => row.chatId === identifier(command.chatId))
        if (row) confirm(row, cursorValue(command.cursor))
        return null
      }
      case 'read-reject': {
        const row = rows.find(row => row.chatId === identifier(command.chatId)), through = historyPosition(command.through)!
        // An old rejection cannot discard a newer observation or overwrite an ACK.
        if (row?.pending && compareReadCursor(readCursor(row.observed), readCursor(through)) <= 0) {
          row.pending = false; row.reason = command.reason; write(row)
        }
        return null
      }
      case 'read-sync': {
        const authority = new Map(command.authorities.map(value => [identifier(value.chatId), value]))
        for (const row of rows) {
          const current = authority.get(row.chatId)
          if (!current || (current.cutoff && comparePosition(row.observed, current.cutoff) < 0)) {
            db.prepare('DELETE FROM read_receipts WHERE chat_id=?').run(row.chatId)
          } else if (current.cursor) confirm(row, cursorValue(current.cursor))
        }
        return null
      }
    }
  })()
}
