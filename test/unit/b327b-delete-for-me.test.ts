import assert from 'node:assert/strict'
import { test } from 'node:test'
import Database from 'better-sqlite3-multiple-ciphers'
import { decodeHiddenMessages, HiddenMessages } from '../../src/main/accounts/hidden-messages'
import { HiddenMessageUploads, hideRefusal, hideRetryDelay, type HideRoute } from '../../src/main/accounts/hidden-message-uploads'
import { HiddenRowLines } from '../../src/main/accounts/hidden-row-lines'
import { MessageSearch } from '../../src/main/accounts/message-search'
import { executeHiddenMessage, type HiddenMessageCommand } from '../../src/main/storage/hidden-message-table'
import { MorseCallableFailure } from '../../src/main/network/morse-callable'
import { documents, type FirestoreDocument, type ReadDialog } from '../../src/main/network/firestore-values'
import type { FirestoreReader, WatchEvents } from '../../src/main/network/firestore-rpc'
import { canDelete, deletionChoices } from '../../src/shared/message-deletion'
import { selectionActions } from '../../src/shared/message-selection'
import type { ChatMessage, DialogSummary, SearchSnapshot } from '../../src/shared/model'

// B327b (contracts/B327b-delete-for-me-account.md §2-1, §2-2, §2-5, §3; tdesktop data_histories.cpp:813-836,
// history_item.cpp:3488-3541 — v7.3.1 6fed91ff): «나에게만 삭제» of a message reaches the account's other devices.
function table() {
  const db = new Database(':memory:')
  db.exec('CREATE TABLE hidden_messages (chat_id TEXT NOT NULL, message_id TEXT NOT NULL, hidden_at REAL NOT NULL, uploaded INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(chat_id, message_id))')
  return { db, store: (async (command: HiddenMessageCommand) => executeHiddenMessage(db, command)) as never }
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
const serverDoc = (uid: string, key: string, kind: string, roomId: string, ids: string[]): FirestoreDocument => ({
  name: `${documents}/users/${uid}/hiddenMessages/${key}`, updateTime: { seconds: '1', nanos: 0 },
  fields: { kind: { stringValue: kind }, roomId: { stringValue: roomId }, ids: { mapValue: { fields: Object.fromEntries(ids.map((id, i) => [id, { integerValue: String(1000 + i) }])) } }, count: { integerValue: String(ids.length) } }
} as unknown as FirestoreDocument)

test('the server\'s list is read under this device\'s keys: a chat by its id, an inquiry room as its messages are kept', () => {
  const rows = [serverDoc('me', 'chat_c1', 'chat', 'c1', ['m1', 'm2']), serverDoc('me', 'inquiry_q1', 'inquiry', 'q1', ['i1']),
    serverDoc('other', 'chat_c2', 'chat', 'c2', ['x']), serverDoc('me', 'odd', 'channel', 'z', ['y']), serverDoc('me', 'chat_c3', 'chat', 'c3', ['bad/id', 'ok'])]
  const decoded = decodeHiddenMessages(rows, 'me')
  assert.deepEqual([...decoded].map(([key, ids]) => [key, [...ids]]), [['c1', ['m1', 'm2']], ['sub_inq_q1', ['i1']], ['c3', ['ok']]])
})

test('what another device hid is hidden here and kept; one this device was still to send is not sent again', async () => {
  const { db, store } = table()
  let arrived = 0
  const hidden = new HiddenMessages(store, () => { arrived++ })
  await hidden.hide('c1', ['mine'])
  assert.deepEqual(hidden.pending(), [{ chatId: 'c1', messageIds: ['mine'] }])
  assert.equal(hidden.setServer(new Map([['c1', new Set(['mine', 'theirs'])]])), true)
  assert.equal(hidden.has('c1', 'theirs'), true)
  assert.equal(arrived, 2, 'shown as gone at once')
  assert.deepEqual(hidden.pending(), [], 'the server has both')
  assert.equal(hidden.setServer(new Map([['c1', new Set(['mine', 'theirs'])]])), false, 'the same list again changes nothing')
  await tick()
  assert.deepEqual(db.prepare('SELECT message_id, uploaded FROM hidden_messages ORDER BY message_id').all(), [{ message_id: 'mine', uploaded: 1 }, { message_id: 'theirs', uploaded: 1 }])
  const next = new HiddenMessages(store, () => {})
  next.load(); await tick()
  assert.deepEqual([next.has('c1', 'theirs'), next.pending()], [true, []], 'the next run has them, and nothing to send')
})

test('hides from before the server kept a list go once, a room\'s 100 at a time', async () => {
  const { db, store } = table()
  const insert = db.prepare('INSERT INTO hidden_messages(chat_id,message_id,hidden_at) VALUES(?,?,1)')
  for (let i = 0; i < 250; i++) insert.run('c1', `old${i}`)
  insert.run('sub_inq_q1', 'i1'); insert.run('secret1', 's1'); insert.run('memo_me', 'n1')
  const hidden = new HiddenMessages(store, () => {})
  const calls: Record<string, unknown>[] = []
  const route = (chatId: string): HideRoute => chatId === 'secret1' || chatId === 'memo_me' ? 'local' : chatId.startsWith('sub_inq_') ? { kind: 'inquiry', roomId: chatId.slice(8) } : { kind: 'chat', roomId: chatId }
  const uploads = new HiddenMessageUploads(hidden, route, () => ({ call: async (name, data) => { assert.equal(name, 'hideMorseMessagesForMe'); calls.push(data); return { ok: true } } }), 'me')
  hidden.load(); await tick()
  uploads.resume(); await tick(); await tick()
  assert.deepEqual(calls.map(call => [call.kind, call.roomId, (call.messageIds as string[]).length, call.expectedUid]),
    [['chat', 'c1', 100, 'me'], ['chat', 'c1', 100, 'me'], ['chat', 'c1', 50, 'me'], ['inquiry', 'q1', 1, 'me']], 'a secret chat and saved messages never go')
  assert.deepEqual(hidden.pending(), [])
  assert.deepEqual(db.prepare('SELECT uploaded, count(*) AS n FROM hidden_messages GROUP BY uploaded').all(), [{ uploaded: 1, n: 251 }, { uploaded: 2, n: 2 }])
  await uploads.close()
})

test('a refusal ends the request, a full list is told once, anything else is sent again later', async () => {
  const { store } = table()
  const hidden = new HiddenMessages(store, () => {})
  const answers: unknown[] = []
  let next: () => unknown = () => ({ ok: true })
  const uploads = new HiddenMessageUploads(hidden, chatId => ({ kind: 'chat', roomId: chatId }), () => ({ call: async () => { const answer = next(); if (answer instanceof Error) throw answer; return answer } }), 'me')
  uploads.resume()
  next = () => new MorseCallableFailure('answered', 'FAILED_PRECONDITION', 'TOO_MANY_HIDDEN')
  await hidden.hide('c1', ['a'])
  answers.push(await uploads.answer('c1', ['a']))
  next = () => new MorseCallableFailure('answered', 'PERMISSION_DENIED', 'NOT_PARTICIPANT')
  await hidden.hide('c2', ['b'])
  answers.push(await uploads.answer('c2', ['b']))
  next = () => new MorseCallableFailure('not-sent', 'UNAVAILABLE')
  await hidden.hide('c3', ['c'])
  answers.push(await uploads.answer('c3', ['c']))
  assert.deepEqual(answers, ['too-many', 'done', 'unconfirmed'])
  assert.deepEqual(hidden.pending(), [{ chatId: 'c3', messageIds: ['c'] }], 'kept to send again; refused ones stay hidden here only')
  assert.deepEqual([hidden.has('c1', 'a'), hidden.has('c2', 'b')], [true, true])
  next = () => ({ ok: true })
  uploads.retryNow(); await tick(); await tick()
  assert.deepEqual(hidden.pending(), [], 'the network back: sent at once')
  await uploads.close()
  assert.deepEqual([hideRefusal(new MorseCallableFailure('answered', 'RESOURCE_EXHAUSTED', 'RATE_LIMITED')), hideRefusal(new MorseCallableFailure('answered', 'NOT_FOUND')),
    hideRefusal(new MorseCallableFailure('answered', 'FAILED_PRECONDITION', 'SECRET_CHAT')), hideRefusal(new MorseCallableFailure('answered', 'FAILED_PRECONDITION', 'ACCOUNT_CHANGED'))],
  [null, null, 'refused', 'account'], 'the hourly limit and a server without the callable are waited out')
  assert.deepEqual([hideRetryDelay(1), hideRetryDelay(3), hideRetryDelay(20), hideRetryDelay(1, 90), hideRetryDelay(1, 99999)], [2000, 8000, 300000, 90000, 3600000])
})

test('the list\'s line never shows a message deleted for me: the newest one left, or none while it is read', async () => {
  const hidden = { ids: new Set(['top']), has: (_c: string, id: string) => hidden.ids.has(id), count: () => hidden.ids.size }
  const position = (seconds: number) => ({ seconds, nanoseconds: 0, id: 'x' })
  let release!: () => void, changed = 0
  const read = () => new Promise<{ preview: string; position: ReturnType<typeof position>; fromMe: boolean; messageId: string }[]>(done => {
    release = () => done([{ preview: 'top', position: position(3), fromMe: false, messageId: 'top' }, { preview: 'left', position: position(2), fromMe: true, messageId: 'left' }])
  })
  const lines = new HiddenRowLines(hidden, read, () => { changed++ })
  const row = () => ({ id: 'c1', preview: 'top', top: { seconds: 3, nanoseconds: 0, id: 'c1' }, topMessageId: 'top' } as unknown as DialogSummary)
  const first = row()
  assert.equal(lines.apply(first, null), true)
  assert.deepEqual([first.preview, first.topMessageId], ['', undefined], 'no line until the read answers')
  release(); await tick()
  assert.equal(changed, 1)
  const second = row()
  lines.apply(second, null)
  assert.deepEqual([second.preview, second.topMessageId, second.topFromMe, second.top?.seconds, second.top?.id], ['left', 'left', true, 2, 'c1'])
  const open = row()
  lines.apply(open, { ready: true, newerAvailable: false, hasMore: true, count: 1, line: () => ({ preview: 'open', position: position(1), fromMe: false, messageId: 'o' }) })
  assert.equal(open.preview, 'open', 'the open history knows the newest left at once')
  const other = { id: 'c2', preview: 'fine', topMessageId: 'shown' } as unknown as DialogSummary
  assert.equal(lines.apply(other, null), false)
  assert.equal(other.preview, 'fine')
})

test('search and shared media pass over a message deleted for me, and drop it when another device hides it', async () => {
  const chatId = 'chat1'
  const dialog = { summary: { id: chatId, version: '1:0', kind: 'direct', title: 'peer', participantUids: ['me', 'peer'], preview: '', unreadCount: 0, markedUnread: false,
    readPositions: {}, readSync: { status: 'ready' }, pinned: false, pinVersion: '', muted: false, archived: false, top: null }, cutoff: null, participantNames: { me: 'me', peer: 'peer' }, accountUid: 'me' } as unknown as ReadDialog
  const doc = (id: string, index: number): FirestoreDocument => ({ name: `${documents}/chats/${chatId}/messages/${id}`, updateTime: { seconds: '1', nanos: 0 },
    fields: { createdAt: { timestampValue: { seconds: String(1_750_000_000 + index), nanos: 0 } }, senderId: { stringValue: 'peer' }, text: { stringValue: `hello ${id}` }, type: { stringValue: 'text' }, status: { stringValue: 'sent' } } } as unknown as FirestoreDocument)
  const rows = [doc('a', 1), doc('b', 2), doc('c', 3)]
  const reader = { watch: (_t: unknown, _s: AbortSignal, events: WatchEvents) => { queueMicrotask(() => { events.snapshot(new Map(rows.map(row => [row.name, row]))); events.state('ready') }); return () => {} },
    query: async () => rows } as unknown as FirestoreReader
  const gone = new Set(['b'])
  const snapshots: SearchSnapshot[] = []
  let revision = 0
  const search = new MessageSearch('s1', dialog, 'hello', reader, snapshot => snapshots.push(snapshot), () => ++revision, null, id => gone.has(id))
  const result = await search.more()
  assert.deepEqual(result.hits.map(hit => hit.id), ['c', 'a'])
  gone.add('c'); search.hiddenChanged()
  assert.deepEqual(snapshots.at(-1)!.hits.map(hit => hit.id), ['a'])
})

test('the delete menu follows Telegram: none for me in a discussion room or a secret chat, only one\'s own there for everyone', () => {
  const room = (kind: 'direct' | 'group' | 'secret', extra: { discussion?: boolean; moderates?: boolean; saved?: boolean } = {}) => ({ kind, discussion: extra.discussion ?? false, moderates: extra.moderates ?? false, saved: extra.saved ?? false })
  const rows: [ReturnType<typeof room>, boolean, boolean, { everyone: boolean; me: boolean }][] = [
    [room('direct'), false, true, { everyone: true, me: true }],
    [room('group'), false, false, { everyone: false, me: true }],
    [room('group', { discussion: true }), true, true, { everyone: true, me: false }],
    [room('group', { discussion: true }), false, true, { everyone: false, me: false }],
    [room('group', { discussion: true, moderates: true }), false, true, { everyone: true, me: false }],
    [room('secret'), true, false, { everyone: false, me: false }],
    [room('direct', { saved: true }), true, true, { everyone: true, me: false }]
  ]
  for (const [where, own, mutable, expected] of rows) assert.deepEqual(deletionChoices(where, own, mutable), expected, JSON.stringify([where, own, mutable]))
  assert.equal(canDelete({ everyone: false, me: false }), false, 'someone else\'s message in a discussion room has no «삭제»')
  const message = (id: string) => ({ id, version: '1', kind: 'text', text: 'x', senderId: 'peer', position: { seconds: 1, nanoseconds: 0, id }, sentAt: 1, attachments: [], reactions: [] } as unknown as ChatMessage)
  assert.equal(selectionActions([message('a'), message('b')], m => m.id !== 'b').delete, false, 'the selection deletes only when every chosen one can be')
  assert.equal(selectionActions([message('a')]).delete, true)
})

// Contract §6 (review 10-13 21:56): every old hide goes, the most recently hidden first; a full room stops there.
test('old hides go newest first, and a room the server calls full is not asked again', async () => {
  const { db, store } = table()
  const insert = db.prepare('INSERT INTO hidden_messages(chat_id,message_id,hidden_at) VALUES(?,?,?)')
  for (let i = 0; i < 250; i++) insert.run('full', `f${i}`, 1000 + i)
  insert.run('other', 'o1', 5)
  const hidden = new HiddenMessages(store, () => {})
  const calls: { roomId: string; first: string; size: number }[] = []
  const uploads = new HiddenMessageUploads(hidden, chatId => ({ kind: 'chat', roomId: chatId }), () => ({ call: async (_name, data) => {
    const ids = data.messageIds as string[]
    calls.push({ roomId: data.roomId as string, first: ids[0]!, size: ids.length })
    if (data.roomId === 'full') throw new MorseCallableFailure('answered', 'FAILED_PRECONDITION', 'TOO_MANY_HIDDEN')
    return { ok: true }
  } }), 'me')
  hidden.load(); await tick()
  uploads.resume(); await tick(); await tick()
  assert.deepEqual([...calls].sort((a, b) => a.roomId.localeCompare(b.roomId)), [{ roomId: 'full', first: 'f249', size: 100 }, { roomId: 'other', first: 'o1', size: 1 }], 'the newest of the room first; the rest of a full room never goes (rooms in any order)')
  assert.deepEqual(hidden.pending(), [])
  assert.deepEqual(db.prepare("SELECT uploaded, count(*) AS n FROM hidden_messages WHERE chat_id = 'full' GROUP BY uploaded").all(), [{ uploaded: 2, n: 250 }])
  assert.equal(hidden.has('full', 'f0'), true, 'still hidden here')
  await uploads.close()
})
