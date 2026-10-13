import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, test } from 'node:test'
import Database from 'better-sqlite3-multiple-ciphers'
import { HiddenChats, decodeHistoryClears, withLocalDeletion } from '../../src/main/accounts/hidden-chats'
import { HistoryClears, clearForMeRefused, historyClearRetryDelay, type HistoryClearSession } from '../../src/main/accounts/history-clears'
import { buildInquiryRows } from '../../src/main/accounts/inquiry-rows'
import { decodeInquiry } from '../../src/main/accounts/channel-inquiries'
import { executeHistoryClear, type HistoryClearCommand } from '../../src/main/storage/history-clear-table'
import { executeHiddenChat, type HiddenChatCommand } from '../../src/main/storage/hidden-chat-table'
import { MorseCallableFailure } from '../../src/main/network/morse-callable'
import { documents, type FirestoreDocument, type ReadDialog } from '../../src/main/network/firestore-values'
import { historyClearRequest, type HistoryClearRequest } from '../../src/shared/history-clears'
import { positionMilliseconds, type DialogSummary, type MessagePosition } from '../../src/shared/model'

// B327 (contracts/B327-clear-for-me-account.md): «나에게만» — clear history (the row stays) and delete the chat (the row
// goes until a new message) — reaches every device of the account through users/{uid}/historyClears, which only
// clearMorseHistoryForMe writes, as Telegram sends both to the server (messages.deleteHistory, just_clear or not).
const at = (seconds: number, nanoseconds = 0, id = ''): MessagePosition => ({ seconds, nanoseconds, id })
const ts = (seconds: number, nanos = 0) => ({ seconds: String(seconds), nanos })
const clearDoc = (id: string, fields: Record<string, unknown>, uid = 'me'): FirestoreDocument =>
  ({ name: `${documents}/users/${uid}/historyClears/${id}`, fields } as unknown as FirestoreDocument)
const summary = (id: string, top: MessagePosition | null): DialogSummary => ({ id, kind: 'direct', top, preview: 'hi' } as unknown as DialogSummary)

function hiddenDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE hidden_chats (chat_id TEXT PRIMARY KEY, hidden_at REAL NOT NULL);
    CREATE TABLE cleared_chats (chat_id TEXT PRIMARY KEY, cutoff REAL NOT NULL);
    ALTER TABLE hidden_chats ADD COLUMN remove_row INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE hidden_chats ADD COLUMN uploaded INTEGER NOT NULL DEFAULT 0;`)
  return db
}
async function loaded(db: Database.Database, now = () => 1_800_000_000_000): Promise<HiddenChats> {
  let arrived!: () => void
  const ready = new Promise<void>(resolve => { arrived = resolve })
  const hidden = new HiddenChats(async <T,>(command: HiddenChatCommand) => executeHiddenChat(db, command) as T, () => arrived(), now)
  hidden.load()
  await Promise.race([ready, new Promise(resolve => setTimeout(resolve, 50))])
  return hidden
}

test('the server\'s boundaries are read by kind and room, and anything else is left out', () => {
  const read = decodeHistoryClears([
    clearDoc('chat_c1', { kind: { stringValue: 'chat' }, roomId: { stringValue: 'c1' }, cutoff: { timestampValue: ts(1790000000, 5) }, removeRow: { booleanValue: true } }),
    clearDoc('inquiry_q1', { kind: { stringValue: 'inquiry' }, roomId: { stringValue: 'q1' }, cutoff: { timestampValue: ts(1790000100) }, removeRow: { booleanValue: false } }),
    clearDoc('chat_bad', { kind: { stringValue: 'other' }, roomId: { stringValue: 'c2' }, cutoff: { timestampValue: ts(1) } }),
    clearDoc('chat_x', { kind: { stringValue: 'chat' }, roomId: { stringValue: 'c3' } }),
    clearDoc('chat_c4', { kind: { stringValue: 'chat' }, roomId: { stringValue: 'c4' }, cutoff: { timestampValue: ts(2) } }, 'someone-else')
  ], 'me')
  assert.deepEqual([...read.chats.keys()], ['c1'])
  assert.deepEqual(read.chats.get('c1'), { cutoff: at(1790000000, 5), removeRow: true })
  assert.deepEqual([...read.inquiries.keys()], ['q1'])
  assert.equal(read.inquiries.get('q1')!.removeRow, false)
})

test('clear history for me keeps the row with no line; delete for me takes it out until a newer message', async () => {
  const hidden = await loaded(hiddenDb())
  const top = at(1790000000, 250_000_000, 'm9')
  await hidden.hide('c1', top, false)
  assert.equal(hidden.hides(summary('c1', top)), false, 'cleared: the row stays')
  const dialog = { summary: summary('c1', top), cutoff: null } as unknown as ReadDialog
  withLocalDeletion(dialog, hidden.cutoff('c1'))
  assert.equal(dialog.summary.preview, '', 'and shows no line')
  await hidden.hide('c2', top, true)
  assert.equal(hidden.hides(summary('c2', top)), true, 'deleted: the row goes')
  assert.equal(hidden.hides(summary('c2', at(1790000005))), false, 'a newer message brings it back')
  // The boundary is the last message, never this computer's clock (here far later).
  assert.ok(positionMilliseconds(hidden.cutoff('c2')!) <= positionMilliseconds(top) + 2)
})

test('the later of this device\'s boundary and the server\'s holds, and the server\'s alone hides a row on another device', async () => {
  const hidden = await loaded(hiddenDb())
  await hidden.hide('c1', at(1790000000), false)
  assert.equal(hidden.setServer(new Map([['c1', { cutoff: at(1790000500), removeRow: false }], ['c9', { cutoff: at(1790000900), removeRow: true }]])), true)
  assert.deepEqual(hidden.cutoff('c1'), at(1790000500))
  assert.equal(hidden.hides(summary('c9', at(1790000900))), true, 'deleted on another device')
  assert.equal(hidden.hides(summary('c9', at(1790000901))), false)
  assert.equal(hidden.setServer(new Map([['c1', { cutoff: at(1790000500), removeRow: false }], ['c9', { cutoff: at(1790000900), removeRow: true }]])), false, 'the same again changes nothing')
})

test('a boundary kept here before B327 is listed once for the server, as its moment and with its kind', async () => {
  const db = hiddenDb()
  db.prepare('INSERT INTO hidden_chats(chat_id,hidden_at) VALUES(?,?)').run('old1', 1790000000123)
  const hidden = await loaded(db)
  assert.deepEqual(hidden.pendingUploads(), [{ chatId: 'old1', at: 1790000000123, removeRow: true }])
  await hidden.hide('new1', at(1790000001), false)
  assert.deepEqual(hidden.pendingUploads().map(item => item.chatId), ['old1'], 'a new one goes through the queue when pressed')
  await hidden.markUploaded('old1')
  assert.deepEqual(hidden.pendingUploads(), [])
  assert.equal((db.prepare('SELECT uploaded FROM hidden_chats WHERE chat_id=?').get('old1') as { uploaded: number }).uploaded, 1)
})

function clearDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE history_clears (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, target TEXT NOT NULL, payload TEXT NOT NULL, state TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE history_clear_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`)
  return db
}
const queues: HistoryClears[] = []
after(async () => { for (const queue of queues) await queue.close() })
function queue(db: Database.Database, answers: (() => Record<string, unknown>)[]) {
  const calls: { name: string; data: Record<string, unknown> }[] = [], newest: boolean[] = []
  const session = (): HistoryClearSession => ({
    newest: async (_chatId, _seen, _signal, mine) => { newest.push(mine === true); return { id: 'm7', seconds: 1790000000, nanoseconds: 9_000_000 } },
    call: async (name, data) => { calls.push({ name, data }); const answer = answers.shift(); return answer ? answer() : { ok: true, cutoff: 1790000000009, applied: true, removeRow: data.removeRow } }
  })
  const clears = new HistoryClears(() => {}, async <T>(command: HistoryClearCommand) => executeHistoryClear(db, command) as T, session)
  queues.push(clears)
  return { clears, calls, newest }
}
const me = (fields: Partial<HistoryClearRequest>): HistoryClearRequest => ({ id: randomUUID(), kind: 'chat-clear-me', targetId: 'c1', seen: null, upTo: null, removeRow: false, ...fields })
const rows = (db: Database.Database): number => (db.prepare('SELECT COUNT(*) AS n FROM history_clears').get() as { n: number }).n
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

test('a clear for me goes to clearMorseHistoryForMe with the room, its boundary and whether the row goes', async () => {
  const db = clearDb(), { clears, calls } = queue(db, [])
  assert.equal(await clears.enqueue(me({ upTo: { messageId: 'm9', createdAtMillis: 1790000000123 }, removeRow: true })), 'done')
  assert.deepEqual(calls, [{ name: 'clearMorseHistoryForMe', data: { kind: 'chat', roomId: 'c1', removeRow: true, upTo: { messageId: 'm9', createdAtMillis: 1790000000123 } } }])
  assert.equal(rows(db), 0)
})

test('one with no message id yet finds the newest past this account\'s own boundary; an old local one goes as its moment alone', async () => {
  const db = clearDb(), { clears, calls, newest } = queue(db, [])
  await clears.enqueue(me({ seen: { seconds: 1790000001, nanoseconds: 0 } }))
  assert.deepEqual(newest, [true], 'looks past the boundary already drawn here')
  assert.deepEqual(calls[0]!.data.upTo, { messageId: 'm7', createdAtMillis: 1790000000009 })
  await clears.put(me({ targetId: 'old1', upTo: { messageId: null, createdAtMillis: 1790000000123 }, removeRow: true }))
  for (let n = 0; n < 50 && calls.length < 2; n++) await wait(10)
  assert.deepEqual(calls[1], { name: 'clearMorseHistoryForMe', data: { kind: 'chat', roomId: 'old1', removeRow: true, upTo: { createdAtMillis: 1790000000123 } } })
})

test('an account over its hourly count waits and goes again; a lost answer is sent again, never held', async () => {
  const db = clearDb()
  const { clears, calls } = queue(db, [
    () => { throw new MorseCallableFailure('answered', 'RESOURCE_EXHAUSTED', 'RATE_LIMITED') },
    () => { throw new MorseCallableFailure('unknown', 'UNAVAILABLE') }
  ])
  assert.equal(await clears.enqueue(me({ upTo: { messageId: 'm9', createdAtMillis: 1790000000123 } })), 'unconfirmed')
  assert.equal(rows(db), 1, 'kept, not refused')
  clears.retryNow(); for (let n = 0; n < 50 && calls.length < 2; n++) await wait(10)
  assert.equal((db.prepare('SELECT state FROM history_clears').get() as { state: string }).state, 'queued', 'a lost answer is not held')
  clears.retryNow(); for (let n = 0; n < 50 && rows(db) > 0; n++) await wait(10)
  assert.equal(calls.length, 3); assert.equal(rows(db), 0)
})

test('a request read back keeps removeRow for a clear for me only', () => {
  const id = randomUUID()
  assert.deepEqual(historyClearRequest({ id, kind: 'chat-clear-me', targetId: 'c1', seen: null, upTo: { messageId: null, createdAtMillis: 5 }, removeRow: true }),
    { id, kind: 'chat-clear-me', targetId: 'c1', seen: null, upTo: { messageId: null, createdAtMillis: 5 }, removeRow: true })
  assert.throws(() => historyClearRequest({ id, kind: 'chat-clear', targetId: 'c1', seen: null, upTo: null, removeRow: true }))
  assert.throws(() => historyClearRequest({ id, kind: 'chat-clear', targetId: 'c1', seen: null, upTo: { messageId: null, createdAtMillis: 5 } }))
})

const inquiry = (id: string, role: 'subscriber' | 'owner', lastMs: number, revoked: number | null = null): FirestoreDocument => ({
  name: `${documents}/channelInquiries/${id}`,
  fields: { channelId: { stringValue: 'ch1' }, channelName: { stringValue: '채널' }, subscriberId: { stringValue: role === 'subscriber' ? 'me' : 'sub' },
    channelOwnerId: { stringValue: role === 'owner' ? 'me' : 'own' }, lastMessage: { stringValue: '마지막' },
    lastMessageAt: { timestampValue: { seconds: String(Math.floor(lastMs / 1000)), nanos: (lastMs % 1000) * 1e6 } },
    ...(revoked !== null ? { historyRevokedAt: { timestampValue: { seconds: String(Math.floor(revoked / 1000)), nanos: 0 } } } : {}) }
} as unknown as FirestoreDocument)

test('an inquiry room cleared on another device shows no line, one deleted there leaves the list until a newer message', () => {
  const docs = [inquiry('q1', 'subscriber', 1790000000000), inquiry('q2', 'subscriber', 1790000000000), inquiry('q3', 'subscriber', 1790000009000)]
  const mine = (id: string) => id === 'q1' ? { cutoff: 1790000000000, removeRow: false } : id === 'q2' || id === 'q3' ? { cutoff: 1790000000000, removeRow: true } : null
  const { rows: list } = buildInquiryRows('me', docs, [], () => null, mine)
  assert.deepEqual(list.map(row => [row.inquiryId, row.preview]), [['q3', '마지막'], ['q1', '']])
  // The room itself: the later of its own boundary and this account's.
  assert.equal(decodeInquiry(inquiry('q1', 'subscriber', 1790000000000, 1789999000000), 'me', 1790000000000).cutoff, 1790000000000)
  assert.equal(decodeInquiry(inquiry('q1', 'subscriber', 1790000000000, 1790000500000), 'me', 1790000000000).cutoff, 1790000500000)
})

test('a clear for me ends only on the server saying the request is wrong; a missing callable, the network or the count go again', async () => {
  const again = [new MorseCallableFailure('answered', 'NOT_FOUND'), new MorseCallableFailure('not-sent', ''), new MorseCallableFailure('unknown', 'UNAVAILABLE'),
    new MorseCallableFailure('answered', 'RESOURCE_EXHAUSTED', 'RATE_LIMITED'), new MorseCallableFailure('answered', 'INTERNAL')]
  for (const error of again) assert.equal(clearForMeRefused(error), false, `${error.status} ${error.reason}`)
  const ended = [new MorseCallableFailure('answered', 'INVALID_ARGUMENT', 'INVALID_REQUEST'), new MorseCallableFailure('answered', 'PERMISSION_DENIED', 'NOT_PARTICIPANT'),
    new MorseCallableFailure('answered', 'FAILED_PRECONDITION', 'SECRET_CHAT'), new MorseCallableFailure('answered', 'NOT_FOUND', 'CHAT_MISSING')]
  for (const error of ended) assert.equal(clearForMeRefused(error), true, `${error.status} ${error.reason}`)
  assert.deepEqual([1, 2, 5, 8, 9, 20].map(n => historyClearRetryDelay(n, 'chat-clear-me')), [2000, 4000, 32000, 256000, 300000, 300000], '2 s doubling to five minutes')
  assert.equal(historyClearRetryDelay(9, 'chat-clear'), 60000, 'a clear for everyone keeps its minute')
  const db = clearDb()
  const { clears } = queue(db, [() => { throw new MorseCallableFailure('answered', 'NOT_FOUND') }, () => { throw new MorseCallableFailure('answered', 'PERMISSION_DENIED', 'NOT_PARTICIPANT') }])
  assert.equal(await clears.enqueue(me({ upTo: { messageId: 'm9', createdAtMillis: 1 } })), 'unconfirmed')
  assert.equal(rows(db), 1, 'a server without the callable: kept')
  clears.retryNow(); for (let n = 0; n < 50 && rows(db) > 0; n++) await wait(10)
  assert.equal(rows(db), 0, 'not this account\'s room: taken out')
})
