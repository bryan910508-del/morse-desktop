import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, test } from 'node:test'
import Database from 'better-sqlite3-multiple-ciphers'
import { InquirySends } from '../../src/main/accounts/inquiry-sends'
import { executeInquirySend, type InquirySendCommand } from '../../src/main/storage/inquiry-send-table'
import { MorseCallableFailure } from '../../src/main/network/morse-callable'

// B484: an inquiry room deleted on another device or by the other side takes what this device was still sending into
// it, as one function entered three ways — this device deletes it, the server's lists no longer hold it and the server
// says it is gone, or sending into it is answered that it is missing. Another room's messages stay.
const uid = 'sub1', roomA = 'ch1_sub1', roomB = 'ch2_sub1'
const id = (): string => randomUUID().toUpperCase()
function database(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE inquiry_sends (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, inquiry_id TEXT NOT NULL, digest TEXT NOT NULL,
    payload TEXT NOT NULL, media BLOB, media_url TEXT, state TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);`)
  return db
}
type Sent = Record<string, unknown>
const opened: InquirySends[] = []
after(async () => { for (const sends of opened) await sends.close() })
function queue(db: Database.Database, send: (payload: Sent) => Promise<unknown>) {
  const sent: Sent[] = []
  const auth = { signal: new AbortController().signal, authorize: async () => ({ idToken: 'id', appCheckToken: 'check', expiresAt: Date.now() + 60000 }) }
  const sends = new InquirySends(uid, auth, () => {}, async <T>(command: InquirySendCommand) => executeInquirySend(db, command) as T, () => {}, {
    send: async payload => { sent.push(payload); return send(payload) },
    upload: async () => 'https://storage/x?alt=media&token=t'
  })
  opened.push(sends)
  return { sends, sent }
}
const text = (inquiryId: string, words: string) => ({ id: id(), inquiryId, message: { senderType: 'subscriber', type: 'text', text: words }, preview: { kind: 'text' as const, text: words } })
const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds))
const unavailable = async (): Promise<never> => { throw new MorseCallableFailure('not-sent', 'UNAVAILABLE') }
const rooms = (sends: InquirySends) => sends.items().map(item => item.inquiryId).sort()

test('a room the lists no longer hold and the server says is gone takes its queued messages; another room keeps its own', async () => {
  const db = database(), q = queue(db, unavailable)
  await q.sends.load()
  await q.sends.enqueue(text(roomA, '가')); await q.sends.enqueue(text(roomB, '나'))
  await wait(20)
  const asked: string[] = []
  await q.sends.forgetGoneRooms(new Set([roomB]), async inquiryId => { asked.push(inquiryId); return false })
  assert.deepEqual(asked, [roomA], 'only a room the lists do not hold is read')
  assert.deepEqual(rooms(q.sends), [roomB])
  assert.deepEqual((executeInquirySend(db, { kind: 'inquiry-send-list' }) as { inquiryId: string }[]).map(row => row.inquiryId), [roomB])
})

test('a room pushed out of a full list, or one the server did not answer for, keeps its messages', async () => {
  const db = database(), q = queue(db, unavailable)
  await q.sends.load()
  await q.sends.enqueue(text(roomA, '가')); await q.sends.enqueue(text(roomB, '나'))
  await wait(20)
  await q.sends.forgetGoneRooms(new Set(), async inquiryId => inquiryId === roomA)
  assert.deepEqual(rooms(q.sends), [roomA], 'the room still there stays')
  await q.sends.forgetGoneRooms(new Set(), async () => { throw new Error('offline') })
  assert.deepEqual(rooms(q.sends), [roomA], 'an unanswered read forgets nothing')
})

test('sending into a missing room forgets the room instead of leaving failed messages', async () => {
  const db = database()
  const q = queue(db, async payload => { if (payload.inquiryId === roomA) throw new MorseCallableFailure('answered', 'NOT_FOUND'); return { ok: true } })
  await q.sends.load()
  await q.sends.enqueue(text(roomA, '하나')); await q.sends.enqueue(text(roomA, '둘')); await q.sends.enqueue(text(roomB, '셋'))
  await wait(60)
  assert.equal(q.sends.items().filter(item => item.inquiryId === roomA).length, 0, 'no failed rows of the missing room')
  assert.equal((executeInquirySend(db, { kind: 'inquiry-send-list' }) as unknown[]).length, 0)
  assert.deepEqual(q.sent.filter(payload => payload.inquiryId === roomA).length, 1, 'tried once, then the room was let go')
  assert.ok(q.sent.some(payload => payload.inquiryId === roomB), 'the other room still sends')
})

test('another refusal still marks the message failed, and this device deleting the room takes its messages', async () => {
  const db = database()
  const q = queue(db, async () => { throw new MorseCallableFailure('answered', 'PERMISSION_DENIED') })
  await q.sends.load()
  await q.sends.enqueue(text(roomA, '거절'))
  await wait(30)
  assert.deepEqual(q.sends.items().map(item => item.state), ['failed'])
  await q.sends.forgetRoom(roomA)
  assert.deepEqual(q.sends.items(), [])
})
