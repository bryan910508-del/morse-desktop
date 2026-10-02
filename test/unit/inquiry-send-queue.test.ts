import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, test } from 'node:test'
import Database from 'better-sqlite3-multiple-ciphers'
import { InquirySends, inquiryRetryDelay } from '../../src/main/accounts/inquiry-sends'
import { executeInquirySend, type InquirySendCommand } from '../../src/main/storage/inquiry-send-table'
import { MorseCallableFailure } from '../../src/main/network/morse-callable'

// A message sent into an inquiry room is the device queue's once it is handed over (user decision 2026-09-29): kept
// through a restart, and sent again under its client message id — which sendMorseInquiryMessage accepts once — until
// the server has it. The panel no longer marks a message it could not confirm as sent and drops it a minute later.
const uid = 'sub1', room = 'ch1_sub1'
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
function queue(db: Database.Database, send: (payload: Sent, call: number) => Promise<unknown>, stored: () => Promise<string> = async () => 'https://storage/x?alt=media&token=t') {
  const sent: Sent[] = [], uploads: string[] = []
  const auth = { signal: new AbortController().signal, authorize: async () => ({ idToken: 'id', appCheckToken: 'check', expiresAt: Date.now() + 60000 }) }
  const sends = new InquirySends(uid, auth, () => {}, async <T>(command: InquirySendCommand) => executeInquirySend(db, command) as T, () => {}, {
    send: async payload => { sent.push(payload); return send(payload, sent.length) },
    upload: async request => { uploads.push(request.messageId); return stored() }
  })
  opened.push(sends)
  return { sends, sent, uploads }
}
const text = (messageId: string, words: string) => ({ id: messageId, inquiryId: room, message: { senderType: 'subscriber', type: 'text', text: words }, preview: { kind: 'text' as const, text: words } })
const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds))

test('the wait before sending an inquiry message again grows to a minute', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 9].map(inquiryRetryDelay), [1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000])
})

test('a message that could not go is kept, and a restart sends it under the same id', async () => {
  const db = database(), messageId = id()
  const first = queue(db, async () => { throw new MorseCallableFailure('not-sent', 'UNAVAILABLE') })
  await first.sends.load()
  await first.sends.enqueue(text(messageId, '안녕하세요'))
  await wait(30)
  assert.equal(first.sent.length, 1)
  assert.deepEqual(first.sends.items().map(item => [item.id, item.state]), [[messageId, 'sending']], 'it is on its way, not sent and not dropped')
  await first.sends.close()
  // The app is quit and opened again.
  const second = queue(db, async () => ({ ok: true }))
  await second.sends.load()
  await wait(30)
  assert.deepEqual(second.sent.map(payload => payload.clientMessageId), [messageId])
  assert.deepEqual(second.sent[0], { senderType: 'subscriber', type: 'text', text: '안녕하세요', inquiryId: room, clientMessageId: messageId, senderId: uid })
  assert.deepEqual(second.sends.items().map(item => item.state), ['sent'], 'shown as sent until the room shows it')
  await second.sends.close()
})

test('a message whose answer was lost goes again under the same id', async () => {
  const db = database(), messageId = id()
  const q = queue(db, async (_payload, call) => { if (call === 1) throw new MorseCallableFailure('unknown', 'UNKNOWN'); return { ok: true } })
  await q.sends.load()
  await q.sends.enqueue(text(messageId, '다시'))
  await wait(inquiryRetryDelay(1) + 300)
  assert.deepEqual(q.sent.map(payload => payload.clientMessageId), [messageId, messageId])
  assert.equal(executeInquirySend(db, { kind: 'inquiry-send-list' }) instanceof Array && (executeInquirySend(db, { kind: 'inquiry-send-list' }) as unknown[]).length, 0)
  await q.sends.close()
})

test('a message the server refused waits, marked, until it is sent again or deleted', async () => {
  const db = database(), messageId = id()
  let refuse = true
  const q = queue(db, async () => { if (refuse) throw new MorseCallableFailure('answered', 'PERMISSION_DENIED'); return { ok: true } })
  await q.sends.load()
  await q.sends.enqueue(text(messageId, '거절'))
  await wait(30)
  const [failed] = q.sends.items()
  assert.equal(failed?.state, 'failed')
  assert.ok(failed?.reason)
  assert.equal(q.sent.length, 1, 'a refusal is not repeated by itself')
  refuse = false
  await q.sends.retry(messageId)
  await wait(30)
  assert.deepEqual(q.sent.map(payload => payload.clientMessageId), [messageId, messageId])
  assert.deepEqual(q.sends.items().map(item => item.state), ['sent'])
  await q.sends.close()
})

// B40: a busy server, a contended write or a proof that had just expired turns the message away for now, not for good —
// it waits with the clock and goes again by itself, as a lost connection does. Only the other answers mark it failed.
test('a message a busy server turned away for now goes again by itself, without the failed mark', async () => {
  for (const status of ['RESOURCE_EXHAUSTED', 'ABORTED', 'UNAUTHENTICATED']) {
    const db = database(), messageId = id()
    const q = queue(db, async (_payload, call) => { if (call === 1) throw new MorseCallableFailure('answered', status); return { ok: true } })
    await q.sends.load()
    await q.sends.enqueue(text(messageId, status))
    await wait(30)
    assert.deepEqual(q.sends.items().map(item => item.state), ['sending'], `${status}: waiting, not failed`)
    await wait(inquiryRetryDelay(1) + 300)
    assert.deepEqual(q.sent.map(payload => payload.clientMessageId), [messageId, messageId], `${status}: sent again under its id`)
    assert.deepEqual(q.sends.items().map(item => item.state), ['sent'])
    await q.sends.close()
  }
})

test('a photo is uploaded once and its address goes with every attempt', async () => {
  const db = database(), messageId = id(), bytes = new Uint8Array([1, 2, 3, 4])
  const q = queue(db, async (_payload, call) => { if (call === 1) throw new MorseCallableFailure('unknown', 'INTERNAL'); return { ok: true } })
  await q.sends.load()
  await q.sends.enqueue({ id: messageId, inquiryId: room, message: { senderType: 'subscriber', type: 'image' }, preview: { kind: 'image', text: '사진' },
    media: { bytes, extension: 'jpg', noun: '사진', urlInText: true } })
  await wait(inquiryRetryDelay(1) + 300)
  assert.deepEqual(q.uploads, [messageId], 'uploaded once, under the message id')
  assert.equal(q.sent.length, 2)
  for (const payload of q.sent) { assert.equal(payload.mediaUrl, 'https://storage/x?alt=media&token=t'); assert.equal(payload.text, payload.mediaUrl) }
  await q.sends.close()
})

test('the messages of one room go in the order they were written', async () => {
  const db = database(), first = id(), second = id()
  const q = queue(db, async (payload, call) => { if (call === 1) throw new MorseCallableFailure('unknown', 'UNKNOWN'); return { ok: true, id: payload.clientMessageId } })
  await q.sends.load()
  await q.sends.enqueue(text(first, '첫째'))
  await q.sends.enqueue(text(second, '둘째'))
  await wait(inquiryRetryDelay(1) + 300)
  assert.deepEqual(q.sent.map(payload => payload.clientMessageId), [first, first, second], 'the second waited for the first')
  await q.sends.close()
})

test('the same message handed over twice stays one, and another under its id is refused', () => {
  const db = database(), messageId = id()
  const payload = { message: { type: 'text', text: 'a' }, preview: { kind: 'text' as const, text: 'a' }, media: null }
  executeInquirySend(db, { kind: 'inquiry-send-enqueue', id: messageId, inquiryId: room, payload, createdAt: 1 })
  executeInquirySend(db, { kind: 'inquiry-send-enqueue', id: messageId, inquiryId: room, payload, createdAt: 2 })
  assert.equal((executeInquirySend(db, { kind: 'inquiry-send-list' }) as unknown[]).length, 1)
  assert.throws(() => executeInquirySend(db, { kind: 'inquiry-send-enqueue', id: messageId, inquiryId: room, payload: { ...payload, message: { type: 'text', text: 'b' } }, createdAt: 3 }), /conflict/)
})

// The network is back (network/reachability.ts): a message waiting out its wait goes at once, under the same id.
test('when the network is back a message waiting out its wait goes at once', async () => {
  const db = database(), messageId = id()
  const q = queue(db, async (_payload, call) => { if (call === 1) throw new MorseCallableFailure('not-sent', 'UNAVAILABLE'); return { ok: true } })
  await q.sends.load()
  await q.sends.enqueue(text(messageId, '지금'))
  await wait(30)
  assert.equal(q.sent.length, 1)
  assert.deepEqual(q.sends.items().map(item => item.state), ['sending'], 'it waits a second before the next try')
  q.sends.retryNow()
  await wait(30)
  assert.deepEqual(q.sent.map(payload => payload.clientMessageId), [messageId, messageId], 'it went again at once, under its id')
  assert.deepEqual(q.sends.items().map(item => item.state), ['sent'])
  await q.sends.close()
})
