import assert from 'node:assert/strict'
import { test } from 'node:test'
import Database from 'better-sqlite3-multiple-ciphers'
import { directChatId } from '../../src/main/messaging/direct-chat-id'
import { directPairPath, pairCorrection, pairLookup, pairReadFailed, pairRoom } from '../../src/main/messaging/direct-chat-pair'
import { textDigest } from '../../src/main/messaging/text-identity'
import { committedSendAck, ServerRejection } from '../../src/main/network/contracts'
import { documents, ReadFailure, type FirestoreDocument } from '../../src/main/network/firestore-values'
import { executePendingDirect, type DirectMove } from '../../src/main/storage/pending-direct-table'
import type { TextSendWire } from '../../src/shared/model'

// B88 §28 (Telegram keys a private dialog by its peer — Telegram-Android DialogObject.getPeerDialogId :71-82): a
// person's 1:1 is the room the server's pair document names, and a first message refused because the pair already has
// one (DIRECT_CHAT_EXISTS) goes there with the messages behind it. The same rules as Android's DirectChatPair (ec0a4aa).
const pairDoc = (chatId: unknown, members: unknown[]): FirestoreDocument => ({
  name: `${documents}/directChatPairs/${directChatId('alice', 'bob')}`,
  fields: { chatId: typeof chatId === 'string' ? { stringValue: chatId } : { integerValue: '1' },
    participantUids: { arrayValue: { values: members.map(uid => typeof uid === 'string' ? { stringValue: uid } : { integerValue: '1' }) } } }
})
const direct = (id: string, ...participantUids: string[]) => [id, { kind: 'direct' as const, participantUids }] as const

test('the pair document is the server\'s directChatPairs key, the same as Android\'s DirectChatPair.key', () => {
  // talky-server morse-message-authority.js directChatId / directPairKey; Android DirectChatPairTest ("alice", "bob").
  assert.equal(directPairPath('alice', 'bob'), `${documents}/directChatPairs/direct_e75842d0f26f8c45dad6458a6e21aecf`)
  assert.equal(directPairPath('bob', 'alice'), directPairPath('alice', 'bob'))
})

test('the document names the room, or there is none; one not understood leaves it to the device', () => {
  assert.deepEqual(pairLookup(pairDoc('legacy-uuid-room', ['alice', 'bob']), 'bob', 'alice'), { kind: 'named', chatId: 'legacy-uuid-room' })
  assert.deepEqual(pairLookup(null, 'alice', 'bob'), { kind: 'none' }, 'no document: no 1:1 yet')
  assert.deepEqual(pairLookup(pairDoc('room', ['alice', 'carol']), 'alice', 'bob'), { kind: 'unreadable' }, 'someone else\'s pair')
  assert.deepEqual(pairLookup(pairDoc('room', ['alice', 'bob', 'carol']), 'alice', 'bob'), { kind: 'unreadable' }, 'not two people')
  assert.deepEqual(pairLookup(pairDoc('', ['alice', 'bob']), 'alice', 'bob'), { kind: 'unreadable' }, 'no room')
  assert.deepEqual(pairLookup(pairDoc('chats/x', ['alice', 'bob']), 'alice', 'bob'), { kind: 'unreadable' }, 'not an id')
  assert.deepEqual(pairLookup(pairDoc(1, ['alice', 'bob']), 'alice', 'bob'), { kind: 'unreadable' }, 'not text')
  assert.deepEqual(pairLookup(pairDoc('room', ['alice', 2]), 'alice', 'bob'), { kind: 'unreadable' })
})

test('a refused read means no pair; offline, a sign-in to renew or a slow read asks the device', () => {
  // firestore.rules v4.8.23 :1146-1149 lets only the two read a pair, so a missing one answers PERMISSION_DENIED.
  assert.deepEqual(pairReadFailed(new ReadFailure('permission', 'PERMISSION_DENIED')), { kind: 'none' })
  assert.deepEqual(pairReadFailed(new ReadFailure('permission', 'UNAUTHENTICATED')), { kind: 'unreadable' })
  assert.deepEqual(pairReadFailed(new ReadFailure('network', 'UNAVAILABLE/no-connection')), { kind: 'unreadable' })
  assert.deepEqual(pairReadFailed(new ReadFailure('cancelled')), { kind: 'unreadable' }, 'longer than the wait')
  assert.deepEqual(pairReadFailed(new Error('offline')), { kind: 'unreadable' })
})

test('the room that opens: the named one, the direct_ one with no document, the list\'s only when unread', () => {
  const legacy = direct('legacy-uuid-room', 'alice', 'bob'), group = ['g1', { kind: 'group' as const, participantUids: ['alice', 'bob'] }] as const
  const dialogs = new Map([legacy, group])
  assert.equal(pairRoom({ kind: 'named', chatId: 'legacy-uuid-room' }, 'alice', 'bob', dialogs), 'legacy-uuid-room')
  assert.equal(pairRoom({ kind: 'none' }, 'alice', 'bob', dialogs), null, 'no document: a new direct_ room, not the one this device holds')
  assert.equal(pairRoom({ kind: 'none' }, 'alice', 'bob', new Map([direct(directChatId('alice', 'bob'), 'alice', 'bob')])), directChatId('alice', 'bob'))
  assert.equal(pairRoom({ kind: 'unreadable' }, 'alice', 'bob', dialogs), 'legacy-uuid-room', 'offline: the list answers, as before')
  assert.equal(pairRoom({ kind: 'unreadable' }, 'alice', 'carol', dialogs), null)
  assert.equal(pairRoom({ kind: 'named', chatId: 'not-listed' }, 'alice', 'bob', dialogs), 'legacy-uuid-room', 'a named room the list lacks: the list answers')
  assert.equal(pairRoom({ kind: 'named', chatId: 'g1' }, 'alice', 'bob', new Map([group])), null, 'a group is never the pair\'s room')
})

test('B97: a 1:1 the device holds opens at once; the document read afterwards moves the window only to another held 1:1 of the pair', () => {
  const held = direct('held-room', 'alice', 'bob'), named = direct('legacy-uuid-room', 'alice', 'bob'), group = ['g1', { kind: 'group' as const, participantUids: ['alice', 'bob'] }] as const
  const dialogs = new Map([held, named, group])
  assert.equal(pairCorrection('legacy-uuid-room', { kind: 'named', chatId: 'legacy-uuid-room' }, 'alice', 'bob', dialogs), null, 'the same room: nothing moves')
  assert.equal(pairCorrection('held-room', { kind: 'named', chatId: 'legacy-uuid-room' }, 'alice', 'bob', dialogs), 'legacy-uuid-room', 'another room: the window goes there')
  assert.equal(pairCorrection('held-room', { kind: 'named', chatId: 'not-listed' }, 'alice', 'bob', dialogs), null, 'a room the list lacks cannot be shown')
  assert.equal(pairCorrection('held-room', { kind: 'named', chatId: 'g1' }, 'alice', 'bob', dialogs), null, 'never a group')
  assert.equal(pairCorrection('held-room', { kind: 'none' }, 'alice', 'bob', dialogs), null, 'no document: the held room stays (a first message refused there still moves)')
  assert.equal(pairCorrection('held-room', { kind: 'unreadable' }, 'alice', 'bob', dialogs), null, 'not read: stays')
})

const wire = (id: string, chatId: string, extra: Partial<TextSendWire> = {}): TextSendWire =>
  ({ id, chatId, senderId: 'alice', type: 'text', text: id, isSilent: false, isEncrypted: false, protocolVersion: 3, ...extra })

test('the refusal carries the pair\'s room, which is never the room the message was sent to', () => {
  const sent = wire('m1', directChatId('alice', 'bob'), { peerUid: 'bob', chatType: 'direct' })
  const refusal = (body: object): ServerRejection => { try { committedSendAck(body, sent) } catch (error) { return error as ServerRejection } throw new Error('accepted') }
  assert.equal(refusal({ ok: false, error: 'DIRECT_CHAT_EXISTS', existingChatId: 'legacy-uuid-room' }).existingChatId, 'legacy-uuid-room')
  assert.equal(refusal({ ok: false, error: 'DIRECT_CHAT_EXISTS', existingChatId: sent.chatId }).existingChatId, undefined)
  assert.equal(refusal({ ok: false, error: 'DIRECT_CHAT_EXISTS', existingChatId: 'chats/x' }).existingChatId, undefined)
  assert.equal(refusal({ ok: false, error: 'DIRECT_CHAT_EXISTS' }).existingChatId, undefined)
})

function database(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE intents (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, chat_id TEXT NOT NULL, wire TEXT,
      digest TEXT NOT NULL, created_at REAL NOT NULL, state TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', upload TEXT, source BLOB,
      source_digest TEXT, upload_request_digest TEXT, forward_operation_id TEXT);
    CREATE TABLE pending_directs (chat_id TEXT PRIMARY KEY, peer_uid TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL, created_at REAL NOT NULL);
    CREATE TABLE local_drafts (chat_id TEXT PRIMARY KEY, text TEXT NOT NULL);
    CREATE TABLE reply_drafts (chat_id TEXT PRIMARY KEY, selection_id TEXT NOT NULL, message_id TEXT NOT NULL);`)
  return db
}
const room = directChatId('alice', 'bob')
function put(db: Database.Database, sent: TextSendWire, state: string, reason = '', upload: string | null = null): void {
  db.prepare('INSERT INTO intents(id,chat_id,wire,digest,created_at,state,reason,upload) VALUES(?,?,?,?,?,?,?,?)')
    .run(sent.id, sent.chatId, JSON.stringify(sent), textDigest(sent), Date.now(), state, reason, upload)
}
const first = (id: string, extra: Partial<TextSendWire> = {}) => wire(id, room, { peerUid: 'bob', chatType: 'direct', ...extra })
const move = (db: Database.Database, refusedId = 'm1') =>
  executePendingDirect(db, 'alice', { kind: 'direct-move', chatId: room, peerUid: 'bob', dialogId: 'legacy-uuid-room', refusedId }) as DirectMove
const rooms = (db: Database.Database): number => (db.prepare('SELECT COUNT(*) AS n FROM pending_directs').get() as { n: number }).n
const stored = (db: Database.Database, id: string) => db.prepare('SELECT chat_id,wire,digest,state,reason FROM intents WHERE id=?').get(id) as
  { chat_id: string; wire: string; digest: string; state: string; reason: string }

test('a refused first message and those queued behind it go to the pair\'s room with the same ids, and the empty room goes', () => {
  const db = database()
  db.prepare('INSERT INTO pending_directs VALUES(?,?,?,?)').run(room, 'bob', 'Bob', 1)
  db.prepare('INSERT INTO local_drafts VALUES(?,?)').run(room, '쓰던 글')
  put(db, first('m1', { autoDeleteSeconds: 86400, autoDeleteMyOnly: false }), 'uncertain', 'ack-pending')
  put(db, first('m2'), 'queued')
  put(db, first('m3'), 'queued')
  assert.deepEqual(move(db), { moved: ['m1', 'm2', 'm3'], removed: true })
  for (const id of ['m1', 'm2', 'm3']) {
    const row = stored(db, id), sent = JSON.parse(row.wire) as TextSendWire
    assert.equal(row.chat_id, 'legacy-uuid-room'); assert.equal(sent.chatId, 'legacy-uuid-room'); assert.equal(sent.id, id); assert.equal(sent.text, id)
    assert.equal(row.state, 'queued', 'sent again'); assert.equal(row.reason, '')
    for (const key of ['peerUid', 'chatType', 'autoDeleteSeconds', 'autoDeleteMyOnly']) assert.equal(key in sent, false, key)
    assert.equal(row.digest, textDigest(sent))
  }
  assert.equal(rooms(db), 0, 'the room that emptied is gone')
  assert.deepEqual(db.prepare('SELECT chat_id,text FROM local_drafts').all(), [{ chat_id: 'legacy-uuid-room', text: '쓰던 글' }], 'its draft goes with it')
})

test('media, a forward and a message refused for another reason stay, and so does their room', () => {
  const db = database()
  db.prepare('INSERT INTO pending_directs VALUES(?,?,?,?)').run(room, 'bob', 'Bob', 1)
  put(db, first('m1'), 'uncertain', 'ack-pending')
  put(db, first('photo'), 'queued', '', '{"name":"a.jpg"}')
  put(db, first('blocked'), 'failed', 'BLOCKED')
  put(db, first('m2'), 'queued')
  db.prepare("UPDATE intents SET forward_operation_id='op' WHERE id='m2'").run()
  assert.deepEqual(move(db), { moved: ['m1'], removed: false })
  assert.equal(stored(db, 'photo').chat_id, room, 'an upload is named by its room')
  assert.equal(stored(db, 'blocked').chat_id, room)
  assert.equal(stored(db, 'm2').chat_id, room, 'a forward is bound to its batch')
  assert.equal(rooms(db), 1)
})

test('only a room this device opened for that person moves', () => {
  const db = database()
  put(db, first('m1'), 'uncertain', 'ack-pending')
  assert.deepEqual(move(db), { moved: [], removed: false }, 'no pending room')
  db.prepare('INSERT INTO pending_directs VALUES(?,?,?,?)').run(room, 'carol', 'Carol', 1)
  assert.deepEqual(move(db), { moved: [], removed: false }, 'another person\'s room')
  assert.equal(stored(db, 'm1').chat_id, room)
})
