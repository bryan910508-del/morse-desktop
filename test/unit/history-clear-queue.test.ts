import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, test } from 'node:test'
import Database from 'better-sqlite3-multiple-ciphers'
import { HistoryClears, historyClearRetryDelay, type HistoryClearSession } from '../../src/main/accounts/history-clears'
import { executeHistoryClear, type HistoryClearCommand } from '../../src/main/storage/history-clear-table'
import { MorseCallableFailure } from '../../src/main/network/morse-callable'
import { millisDown, type HistoryClearRequest } from '../../src/shared/history-clears'

// A4 contract: a history cleared for everyone carries the boundary fixed when it was pressed — the room's last message
// then — and goes again with that same boundary until answered, as Telegram keeps max_id in its pending task
// (telegram-refs R-3). A lost answer goes again only to a server known to take the boundary (`applied`, A4 §7-2).
function database(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE history_clears (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, target TEXT NOT NULL, payload TEXT NOT NULL, state TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE history_clear_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`)
  return db
}
interface Server { newest: { id: string; seconds: number; nanoseconds: number } | null; calls: { name: string; data: Record<string, unknown> }[]; next: (() => Record<string, unknown>)[] }
const opened: HistoryClears[] = []
after(async () => { for (const queue of opened) await queue.close() })
function queue(db: Database.Database, server: Server) {
  const settled: { id: string; cutoff: number | null; done: boolean }[] = []
  const session = (): HistoryClearSession => ({
    newest: async () => server.newest,
    call: async (name, data) => { server.calls.push({ name, data }); const answer = server.next.shift(); return answer ? answer() : { ok: true, cutoff: 5000, applied: true } }
  })
  const clears = new HistoryClears(() => {}, async <T>(command: HistoryClearCommand) => executeHistoryClear(db, command) as T, session,
    (request, cutoff, done) => settled.push({ id: request.id, cutoff, done }))
  opened.push(clears)
  return { clears, settled }
}
const server = (newest: Server['newest'] = { id: 'm9', seconds: 1790000000, nanoseconds: 123_987_654 }): Server => ({ newest, calls: [], next: [] })
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const seen = { seconds: 1790000001, nanoseconds: 0 }
const clear = (kind: HistoryClearRequest['kind'] = 'chat-clear', targetId = 'room1'): HistoryClearRequest => ({ id: randomUUID(), kind, targetId, seen: kind === 'inquiry-clear' ? null : seen, upTo: null })
const lost = () => { throw new MorseCallableFailure('unknown', 'UNAVAILABLE') }
const neverSent = () => { throw new MorseCallableFailure('not-sent', '') }
const rows = (db: Database.Database): number => (db.prepare('SELECT COUNT(*) AS n FROM history_clears').get() as { n: number }).n

test('the wait before sending a clear again is 2 s doubling to a minute', () => {
  assert.deepEqual([1, 2, 3, 5, 6, 9].map(historyClearRetryDelay), [2000, 4000, 8000, 32000, 60000, 60000])
  assert.equal(millisDown({ seconds: 1790000000, nanoseconds: 123_987_654 }), 1790000000123, 'rounded down, never up')
})

test('the first send carries the last message the person saw, and a clear that is answered is over', async () => {
  const db = database(), s = server(), q = queue(db, s)
  await q.clears.load()
  assert.equal(await q.clears.enqueue(clear()), 'done')
  assert.deepEqual(s.calls, [{ name: 'clearMorseChatHistory', data: { chatId: 'room1', upTo: { messageId: 'm9', createdAtMillis: 1790000000123 } } }])
  assert.equal(rows(db), 0)
  assert.deepEqual(q.settled.map(item => [item.cutoff, item.done]), [[5000, true]])
})

test('a room with nothing left up to what the person saw is not sent at all', async () => {
  const db = database(), s = server(null), q = queue(db, s)
  await q.clears.load()
  assert.equal(await q.clears.enqueue(clear('direct-delete')), 'done')
  assert.deepEqual(s.calls, [])
})

test('an answer lost is held until the server is known to take a boundary, then goes again with the same one', async () => {
  const db = database(), s = server(), q = queue(db, s)
  await q.clears.load()
  s.next.push(lost)
  assert.equal(await q.clears.enqueue(clear()), 'unconfirmed')
  q.clears.retryNow(); await wait(30)
  assert.equal(s.calls.length, 1, 'held: not sent again while the server may still use its own clock')
  // Another room's clear is answered with `applied`: the server takes a fixed boundary.
  assert.equal(await q.clears.enqueue(clear('chat-clear', 'room2')), 'done')
  q.clears.retryNow(); await wait(30)
  assert.equal(s.calls.length, 3)
  assert.deepEqual(s.calls[2]!.data, s.calls[0]!.data, 'the same boundary as the first send')
  assert.equal(rows(db), 0)
})

test('on a server known to take the boundary, a lost answer goes again at once when the network is back', async () => {
  const db = database(), s = server(), q = queue(db, s)
  db.prepare("INSERT INTO history_clear_meta(key,value) VALUES('server-applies','1')").run()
  await q.clears.load()
  s.next.push(lost)
  assert.equal(await q.clears.enqueue(clear()), 'unconfirmed')
  q.clears.retryNow(); await wait(30)
  assert.equal(s.calls.length, 2)
  assert.deepEqual(s.calls[1]!.data, s.calls[0]!.data)
})

test('a request that never left goes again even before the server is known; one without a boundary is never sent again after a lost answer', async () => {
  const db = database(), s = server(), q = queue(db, s)
  await q.clears.load()
  s.next.push(neverSent)
  assert.equal(await q.clears.enqueue(clear()), 'unconfirmed')
  q.clears.retryNow(); await wait(30)
  assert.equal(s.calls.length, 2)
  // An inquiry room that had no message: no boundary, so the server would use its own clock — never twice, even on a
  // server known to take a boundary (the answer above already told this one).
  db.prepare("INSERT OR IGNORE INTO history_clear_meta(key,value) VALUES('server-applies','1')").run()
  const q2 = queue(db, s)
  await q2.clears.load()
  s.next.push(lost)
  assert.equal(await q2.clears.enqueue({ ...clear('inquiry-clear', 'ch1_user1'), upTo: null }), 'unconfirmed')
  q2.clears.retryNow(); await wait(30)
  assert.equal(s.calls.filter(call => call.name === 'clearMorseInquiryHistory').length, 1)
})

test('the server refusing a clear ends it as failed', async () => {
  const db = database(), s = server(), q = queue(db, s)
  await q.clears.load()
  s.next.push(() => { throw new MorseCallableFailure('answered', 'PERMISSION_DENIED') })
  await assert.rejects(q.clears.enqueue(clear()), /삭제하지 못했습니다/)
  assert.equal(rows(db), 0)
})

test('a clear still waiting when the app closes goes on after it opens, with the boundary it had', async () => {
  const db = database(), s = server()
  db.prepare("INSERT INTO history_clear_meta(key,value) VALUES('server-applies','1')").run()
  const first = queue(db, s)
  await first.clears.load()
  s.next.push(lost)
  assert.equal(await first.clears.enqueue(clear()), 'unconfirmed')
  await first.clears.close()
  s.newest = { id: 'later', seconds: 1790000009, nanoseconds: 0 }
  const second = queue(db, s)
  await second.clears.load(); await wait(30)
  assert.equal(s.calls.length, 2)
  assert.deepEqual(s.calls[1]!.data, s.calls[0]!.data, 'not a later message: the boundary was fixed at the first send')
})
