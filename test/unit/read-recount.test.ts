import assert from 'node:assert/strict'
import { test } from 'node:test'
import Database from 'better-sqlite3-multiple-ciphers'
import { executeReadReceipt } from '../../src/main/storage/read-receipt-table'
import type { StoredReadReceipt } from '../../src/main/storage/read-receipt-protocol'

// B104 (server reading 10-04: four 1:1 rooms kept an old unreadCounts while their read position was at the newest
// message; the server's markRead answers alreadyApplied without counting again): a chat the server still counts unread
// is read again even where it was read already, so the server's recount can reach it. Telegram marks it read locally
// once the read position reaches the last message (data_histories.cpp:258-272); Morse's count is the server's.
const database = () => {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE read_receipts (chat_id TEXT PRIMARY KEY, observed TEXT NOT NULL, confirmed TEXT, pending INTEGER NOT NULL, reason TEXT NOT NULL DEFAULT '')`)
  return db
}
const last = { seconds: 1700000000, nanoseconds: 0, id: 'm9' }
const cursor = { at: 1700000000000, id: 'm9' }
const rows = (db: Database.Database) => executeReadReceipt(db, { kind: 'read-list' }) as StoredReadReceipt[]

test('a chat read to its last message is not sent again — unless the server still counts it unread', () => {
  const db = database()
  executeReadReceipt(db, { kind: 'read-sync', authorities: [] })
  // Read and acknowledged before.
  executeReadReceipt(db, { kind: 'read-enqueue', chatId: 'c1', target: last })
  executeReadReceipt(db, { kind: 'read-confirm', chatId: 'c1', cursor })
  assert.equal(rows(db)[0]!.pending, false)
  executeReadReceipt(db, { kind: 'read-enqueue', chatId: 'c1', target: last })
  assert.equal(rows(db)[0]!.pending, false, 'nothing new to send')
  executeReadReceipt(db, { kind: 'read-enqueue', chatId: 'c1', target: last, recount: true })
  assert.deepEqual([rows(db)[0]!.pending, rows(db)[0]!.reason], [true, 'recount'], 'the server still counts it: sent again')
})

test('a recount read survives the list\'s read position and ends with the server\'s answer', () => {
  const db = database()
  executeReadReceipt(db, { kind: 'read-enqueue', chatId: 'c1', target: last, recount: true })
  executeReadReceipt(db, { kind: 'read-sync', authorities: [{ chatId: 'c1', cursor, cutoff: null }] })
  assert.equal(rows(db)[0]!.pending, true, 'the position it is sent despite does not cancel it')
  executeReadReceipt(db, { kind: 'read-confirm', chatId: 'c1', cursor })
  assert.deepEqual([rows(db)[0]!.pending, rows(db)[0]!.reason], [false, ''], 'answered: done')
})
