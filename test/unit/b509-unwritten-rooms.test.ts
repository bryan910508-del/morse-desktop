import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import Database from 'better-sqlite3-multiple-ciphers'
import { decodeDialog, documents, type FirestoreDocument } from '../../src/main/network/firestore-values'
import { unwrittenDirect, type UnwrittenKeep } from '../../src/main/accounts/hidden-chats'
import { executePendingDirect } from '../../src/main/storage/pending-direct-table'
import { emptyRowLine } from '../../src/shared/chat-list-preview'

// B509 (server plan reports/server/2026-10-31-b509-plan.md, checks b509-checks.md): Telegram lists no 1:1 without a
// message (Postbox ChatListIndexTable.includedIndex, tdesktop History::shouldBeInChatList history.cpp:3485-3486), while
// the server makes a 1:1 before a first media message is sent (prepareMorseChatMedia: lastMessage '', lastMessageAt now,
// no lastMessageId). (가′) the app leaves such a room out; the pending chat this device opened goes when left empty;
// (다) a new group's empty line says «대화를 시작하세요» as iOS and Android do.
const time = { timestampValue: { seconds: '1700000000', nanos: 0 } }
function room(id: string, type: string, fields: Record<string, unknown> = {}): FirestoreDocument {
  return { name: `${documents}/chats/${id}`, updateTime: { seconds: '1', nanos: 0 }, createTime: { seconds: '1', nanos: 0 },
    fields: { type: { stringValue: type }, participantUids: { arrayValue: { values: [{ stringValue: 'me' }, { stringValue: 'peer' }] } }, lastMessageAt: time, ...fields } } as unknown as FirestoreDocument
}
const none: UnwrittenKeep = { pinned: false, open: false, sending: false, draft: false }

test('a 1:1 or secret room with no line and no message id is unwritten; one with either is not', () => {
  assert.equal(decodeDialog(room('d1', 'direct', { lastMessage: { stringValue: '' } }), 'me').unwritten, true, 'prepareMorseChatMedia\'s room')
  assert.equal(decodeDialog(room('d2', 'direct', { lastMessage: { stringValue: '' }, lastMessageId: { stringValue: '' } }), 'me').unwritten, true, 'an empty id is none')
  assert.equal(decodeDialog(room('d3', 'direct'), 'me').unwritten, true, 'no line at all')
  assert.equal(decodeDialog(room('s1', 'secret', { lastMessage: { stringValue: '' } }), 'me').unwritten, true, 'secret, as the plan says «1:1·비밀»')
  assert.equal(decodeDialog(room('d4', 'direct', { lastMessage: { stringValue: 'hi' }, lastMessageId: { stringValue: 'm1' } }), 'me').unwritten, undefined)
  assert.equal(decodeDialog(room('d5', 'direct', { lastMessage: { stringValue: '' }, lastMessageId: { stringValue: 'm1' } }), 'me').unwritten, undefined, 'a message id is a message')
  assert.equal(decodeDialog(room('d6', 'direct', { lastMessage: { stringValue: 'hi' } }), 'me').unwritten, undefined, 'a line is a message')
  assert.equal(decodeDialog(room('g1', 'group', { lastMessage: { stringValue: '' }, lastMessageId: { stringValue: '' } }), 'me').unwritten, undefined, 'a group is listed (B509 (나)/(다))')
})

test('an unwritten room is left out unless this device keeps it: pinned, open, sending or drafted', () => {
  const value = decodeDialog(room('d1', 'direct', { lastMessage: { stringValue: '' } }), 'me')
  assert.equal(unwrittenDirect(value, 'memo_me', none), true)
  for (const key of ['pinned', 'open', 'sending', 'draft'] as const) assert.equal(unwrittenDirect(value, 'memo_me', { ...none, [key]: true }), false, key)
  const memo = decodeDialog(room('memo_me', 'direct', { lastMessage: { stringValue: '' } }), 'me')
  assert.equal(unwrittenDirect(memo, 'memo_me', none), false, 'the memo space is never hidden by this rule')
  const written = decodeDialog(room('d4', 'direct', { lastMessage: { stringValue: 'hi' }, lastMessageId: { stringValue: 'm1' } }), 'me')
  assert.equal(unwrittenDirect(written, 'memo_me', none), false)
})

test('the session applies the rule in the list and builds it again when what keeps a room changes', () => {
  const session = readFileSync('src/main/accounts/session.ts', 'utf8')
  assert.match(session, /if \(value\.unwritten\) \{[\s\S]{0,300}unlisted\.add\(value\.summary\.id\)/)
  assert.match(session, /sending: sends\.sending \|\| sends\.failed/, 'any send of this device, failed too')
  assert.match(session, /chatSendState\(chatId, null\)/, 'not after the room\'s own time: the server dated the room before the upload')
  assert.match(session, /closeHistory\(chatId: string\): void \{[^\n]*this\.relistUnwritten\(\) \}/)
  assert.match(session, /this\.followPeople\(\); this\.relistUnwritten\(\); events\.changed\(\)/, 'sends and drafts')
})

function database(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE intents (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, chat_id TEXT NOT NULL, wire TEXT,
      digest TEXT NOT NULL, created_at REAL NOT NULL, state TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', upload TEXT, source BLOB,
      source_digest TEXT, upload_request_digest TEXT, forward_operation_id TEXT);
    CREATE TABLE pending_directs (chat_id TEXT PRIMARY KEY, peer_uid TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL, created_at REAL NOT NULL);
    CREATE TABLE local_drafts (chat_id TEXT PRIMARY KEY, text TEXT NOT NULL);
    CREATE TABLE reply_drafts (chat_id TEXT PRIMARY KEY, selection_id TEXT NOT NULL, message_id TEXT NOT NULL);
    CREATE TABLE voice_drafts (chat_id TEXT PRIMARY KEY,revision TEXT NOT NULL UNIQUE,payload TEXT,source BLOB);`)
  executePendingDirect(db, 'me', { kind: 'direct-open', chatId: 'pending-room', peerUid: 'peer', displayName: 'Peer' })
  return db
}
const discard = (db: Database.Database) => executePendingDirect(db, 'me', { kind: 'direct-discard-empty', chatId: 'pending-room' })
const left = (db: Database.Database) => (db.prepare('SELECT COUNT(*) AS n FROM pending_directs').get() as { n: number }).n

test('a new chat left with nothing written goes, with its empty draft and reply', () => {
  const db = database()
  db.prepare('INSERT INTO local_drafts VALUES(?,?)').run('pending-room', '  ')
  db.prepare('INSERT INTO reply_drafts VALUES(?,?,?)').run('pending-room', 's', 'm')
  assert.equal(discard(db), true)
  assert.equal(left(db), 0)
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM local_drafts').get() as { n: number }).n, 0)
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM reply_drafts').get() as { n: number }).n, 0)
  assert.equal(discard(db), false, 'nothing to remove')
})

test('anything written keeps the new chat: a draft, a recording, a send', () => {
  const drafted = database()
  drafted.prepare('INSERT INTO local_drafts VALUES(?,?)').run('pending-room', 'hello')
  assert.equal(discard(drafted), false); assert.equal(left(drafted), 1)
  const recorded = database()
  recorded.prepare('INSERT INTO voice_drafts(chat_id,revision) VALUES(?,?)').run('pending-room', 'r1')
  assert.equal(discard(recorded), false); assert.equal(left(recorded), 1)
  const sent = database()
  sent.prepare("INSERT INTO intents(id,chat_id,digest,created_at,state) VALUES('i1','pending-room','d',1,'done')").run()
  assert.equal(discard(sent), false); assert.equal(left(sent), 1)
})

test('the window asks for it on leaving a new chat, after the composer saved its last keystrokes', () => {
  const widget = readFileSync('src/renderer/src/history/history-widget.tsx', 'utf8')
  assert.match(widget, /if \(!dialogExists && pendingNow\.current\?\.canDiscard\) void flushDrafts\(\)\.then\(\(\) => window\.morse\.leavePendingDirect\(accountUid, chatId\)\)/)
  const outbox = readFileSync('src/main/messaging/outbox.ts', 'utf8')
  assert.match(outbox, /async discardEmptyDirect\(chatId: string\): Promise<boolean> \{[\s\S]{0,200}this\.context\(\)\.dialogs\.has\(chatId\)\) return false/, 'a room the server holds is not a pending one')
})

test('a room with no message yet says «대화를 시작하세요»; a discussion says what it is; a deleted line stays empty', () => {
  const row = { id: 'g1', topMessageId: undefined, topCleared: undefined, service: undefined, discussion: false }
  assert.equal(emptyRowLine(row), '대화를 시작하세요')
  assert.equal(emptyRowLine({ ...row, discussion: true }), '채널 토론방')
  assert.equal(emptyRowLine({ ...row, topMessageId: 'm1' }), '', 'a deleted message keeps its id')
  assert.equal(emptyRowLine({ ...row, topCleared: true }), '', 'B474: an emptied row')
  assert.equal(emptyRowLine({ ...row, service: true }), '', 'the notice chat')
  assert.equal(emptyRowLine({ ...row, id: 'memo_me' }), '', 'the memo space')
  for (const file of ['src/shared/i18n/en.json', 'src/shared/i18n/ru.json']) {
    const words = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>
    assert.equal(words['대화를 시작하세요'], file.includes('/en.') ? 'Start a conversation' : 'Начните разговор', 'iOS chat.startConvo, Android messaging_empty_room')
  }
})
