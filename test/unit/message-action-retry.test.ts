import assert from 'node:assert/strict'
import { test } from 'node:test'
import Database from 'better-sqlite3-multiple-ciphers'
import { MessageActions, reactionRetryDelay } from '../../src/main/messaging/message-actions'
import { executeMessageAction } from '../../src/main/storage/message-action-table'
import type { MessageActionCommand, StoredMessageAction } from '../../src/main/storage/message-action-protocol'
import { documents } from '../../src/main/network/firestore-values'

const chatId = 'c1', messageId = 'm1', uid = 'u1'
const stamp = { seconds: '1790121600', nanos: 0 }
const document = {
  name: `${documents}/chats/${chatId}/messages/${messageId}`,
  updateTime: stamp,
  fields: { senderId: { stringValue: 'u2' }, text: { stringValue: 'hello' }, createdAt: { timestampValue: stamp } },
}
const version = '1790121600:0'

function harness(react: () => Promise<unknown>) {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE message_actions (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL,
    chat_id TEXT NOT NULL, message_id TEXT NOT NULL, digest TEXT NOT NULL, payload TEXT, state TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '');
    CREATE UNIQUE INDEX action_pending ON message_actions(chat_id,message_id) WHERE state IN ('queued','uncertain');`)
  const store = async <T>(command: MessageActionCommand): Promise<T> => executeMessageAction(db, command) as T
  let sent = 0
  // No callable fallback here: an account that cannot authorize is the disconnected one, which is what
  // setMessageReaction turns into NotEmitted.
  const auth = { signal: new AbortController().signal, authorize: async () => { throw new Error('offline') },
    sender: { ready: true, reactions: true, react: () => { sent += 1; return react() } } }
  const dialog = { accountUid: uid, participantNames: {}, summary: { id: chatId, kind: 'direct' } }
  const reader = { query: async () => [document] }
  const context = () => ({ ready: true, reader, dialogs: new Map([[chatId, dialog]]) })
  const actions = new MessageActions(uid, auth as never, store as never, context as never, () => {})
  const rows = (): StoredMessageAction[] => executeMessageAction(db, { kind: 'action-list' }) as StoredMessageAction[]
  return { actions, rows, sent: () => sent, close: () => actions.close() }
}
const reaction = (id: string) => ({ id, messageId, version, kind: 'reaction' as const, reactions: ['👍'] })
const settle = () => new Promise(resolve => setTimeout(resolve, 20))

// User decision 2026-09-29: an idempotent request goes again under the same id after a wait that grows to a minute,
// for as long as it is unsettled. There is no last attempt after which it is dropped on the account.
test('the wait before sending a reaction or a vote again grows to a minute and then holds', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 30].map(reactionRetryDelay), [1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000])
})

// iOS keeps an unsettled reaction and sends it again (MorsePendingReactionSync); the account is told nothing while
// the app is still trying. The row waits as 'queued', which the room's journal does not show.
test('a reaction the connection swallowed waits to be sent again, silently', async () => {
  const h = harness(() => Promise.reject(new Error('socket closed')))
  await h.actions.enqueue(chatId, reaction('a1') as never, { version, serverConfirmed: true, text: 'hello', kind: 'text', encrypted: false, system: false, reactions: [] } as never)
  await settle()
  const [row] = h.rows()
  assert.equal(h.sent(), 1, 'it was tried once and is not being retried in a tight loop')
  assert.equal(row.state, 'queued', 'it waits for the next try instead of failing on the account')
  assert.equal(row.reason, '', 'nothing is said while the app is still trying')
  await h.close()
})

// A refusal the server means (no longer a member, message gone) is not worth sending again.
test('a definitive refusal still fails at once', async () => {
  // The socket's own refusal, one no other route can change (docs/reaction-socket-contract-2026-09-22.md §2).
  const h = harness(async () => ({ ok: false, reason: 'NOT_MEMBER' }))
  await h.actions.enqueue(chatId, reaction('a1') as never, { version, serverConfirmed: true, text: 'hello', kind: 'text', encrypted: false, system: false, reactions: [] } as never)
  await settle()
  const [row] = h.rows()
  assert.equal(row.state, 'failed')
  assert.equal(h.sent(), 1)
  await h.close()
})

// The whole loop: the first try is swallowed, the wait passes, and the same selection under the same revision goes
// out again — the server applies one revision once, so sending it again is safe (morse-release-authority.js:296).
test('after the wait it is sent again, and a good answer clears it', async () => {
  let attempt = 0
  const h = harness(async () => {
    attempt += 1
    if (attempt === 1) throw new Error('socket closed')
    return { ok: true, chatId, roomId: chatId, messageId, actorUid: uid, clientRevision: 'a1', reactionVersion: 4, reactions: { '👍': [uid] } }
  })
  await h.actions.enqueue(chatId, reaction('a1') as never, { version, serverConfirmed: true, text: 'hello', kind: 'text', encrypted: false, system: false, reactions: [] } as never)
  await settle()
  assert.equal(h.rows()[0]?.state, 'queued', 'waiting for the first retry')
  await new Promise(resolve => setTimeout(resolve, reactionRetryDelay(1) + 300))
  assert.equal(h.sent(), 2, 'the wait ended and it went out again')
  assert.deepEqual(h.rows(), [], 'nothing is left waiting once the server answers')
  await h.close()
})

// Votes go through the setMorseMessagePollVote callable only, and the server applies one clientRevision once
// (morse-release-authority.js:676-679), so a vote whose outcome is unknown goes again under the same revision.
const poll = {
  name: `${documents}/chats/${chatId}/messages/${messageId}`, updateTime: stamp,
  fields: { senderId: { stringValue: 'u2' }, createdAt: { timestampValue: stamp }, type: { stringValue: 'poll' }, pollQuestion: { stringValue: '점심?' },
    pollOptions: { arrayValue: { values: [{ stringValue: '국밥' }, { stringValue: '라면' }] } } },
}
const pollMessage = { version, serverConfirmed: true, text: '', kind: 'poll', poll: { closed: false }, encrypted: false, system: false, reactions: [] }
const vote = (id: string, options = [1]) => ({ id, messageId, version, kind: 'poll-vote' as const, options })
function pollHarness(authorized = true) {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE message_actions (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL,
    chat_id TEXT NOT NULL, message_id TEXT NOT NULL, digest TEXT NOT NULL, payload TEXT, state TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '');
    CREATE UNIQUE INDEX action_pending ON message_actions(chat_id,message_id) WHERE state IN ('queued','uncertain');`)
  const store = async <T>(command: MessageActionCommand): Promise<T> => executeMessageAction(db, command) as T
  const auth = { signal: new AbortController().signal, sender: { ready: true },
    authorize: async () => { if (!authorized) throw new Error('offline'); return { idToken: 'id', appCheckToken: 'check', expiresAt: Date.now() + 60000 } } }
  const dialog = { accountUid: uid, participantNames: {}, summary: { id: chatId, kind: 'group' } }
  let receipts = 0
  // No receipt yet: pollVotes/{uid} is written only once a vote applies.
  const reader = { query: async () => [poll], getDocument: async () => { receipts += 1; return null } }
  const context = () => ({ ready: true, reader, dialogs: new Map([[chatId, dialog]]) })
  const actions = new MessageActions(uid, auth as never, store as never, context as never, () => {})
  const rows = (): StoredMessageAction[] => executeMessageAction(db, { kind: 'action-list' }) as StoredMessageAction[]
  return { actions, rows, receipts: () => receipts, close: () => actions.close() }
}
const original = globalThis.fetch
const answered = (revision: string) => new Response(JSON.stringify({ result: { ok: true, chatId, messageId, actorUid: uid, clientRevision: revision, optionIndexes: [1], pollVoteCounts: [0, 1], pollTotalVoters: 1 } }), { status: 200 })

test('a vote whose outcome the connection swallowed goes again under the same revision', async () => {
  const revisions: string[] = []
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    revisions.push(JSON.parse(init.body).data.clientRevision)
    // Reproduced 2026-09-29: the request arrived and the connection was cut before the answer.
    if (revisions.length === 1) throw new TypeError('fetch failed', { cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }) })
    return answered('v1')
  }) as never
  const h = pollHarness()
  try {
    await h.actions.enqueue(chatId, vote('v1') as never, pollMessage as never)
    await settle()
    const [row] = h.rows()
    assert.equal(row?.state, 'queued', 'it waits to go again, not as a result nobody will ever check')
    assert.equal(row?.reason, '')
    assert.equal(h.receipts(), 1, 'the receipt was read once, in case it had applied after all')
    await new Promise(resolve => setTimeout(resolve, reactionRetryDelay(1) + 300))
    assert.deepEqual(revisions, ['v1', 'v1'], 'the same revision went again')
    assert.deepEqual(h.rows(), [])
  } finally { globalThis.fetch = original; await h.close() }
})

test('a vote that never left waits for the connection and is never failed on the account', async () => {
  let reached = 0
  globalThis.fetch = (async () => { reached += 1; return answered('v1') }) as never
  const h = pollHarness(false)
  try {
    await h.actions.enqueue(chatId, vote('v1') as never, pollMessage as never)
    await settle()
    const [row] = h.rows()
    assert.equal(reached, 0)
    assert.equal(row?.state, 'queued')
    assert.equal(row?.reason, '', 'nothing is said while it waits')
    assert.equal(h.receipts(), 0, 'nothing left, so there is nothing to look for')
  } finally { globalThis.fetch = original; await h.close() }
})

// A vote or a reaction is not marked as possibly sent before it goes: one cut short by the connection going (pause)
// stays 'queued' and goes when the connection is back, instead of waiting for someone to check it.
test('a vote interrupted by the connection going stays waiting, not unsettled', async () => {
  globalThis.fetch = ((_url: string, init: { signal: AbortSignal }) => new Promise((_done, fail) => {
    init.signal.addEventListener('abort', () => fail(init.signal.reason), { once: true })
  })) as never
  const h = pollHarness()
  try {
    await h.actions.enqueue(chatId, vote('v1') as never, pollMessage as never)
    await settle()
    h.actions.pause()
    await settle()
    assert.equal(h.rows()[0]?.state, 'queued')
  } finally { globalThis.fetch = original; await h.close() }
})

// Telegram sends what waited the moment the connection is back (SessionPrivate::restartNow): a reaction waiting out
// its wait goes at once when the network returns, not when the wait ends (network/reachability.ts → retryNow).
test('when the network is back a reaction waiting out its wait goes at once', async () => {
  let attempt = 0
  const h = harness(async () => {
    attempt += 1
    if (attempt === 1) throw new Error('socket closed')
    return { ok: true, chatId, roomId: chatId, messageId, actorUid: uid, clientRevision: 'a1', reactionVersion: 4, reactions: { '👍': [uid] } }
  })
  await h.actions.enqueue(chatId, reaction('a1') as never, { version, serverConfirmed: true, text: 'hello', kind: 'text', encrypted: false, system: false, reactions: [] } as never)
  await settle()
  assert.equal(h.sent(), 1)
  assert.equal(h.rows()[0]?.state, 'queued', 'it waits a second before the next try')
  h.actions.retryNow()
  await settle()
  assert.equal(h.sent(), 2, 'it went again at once, well inside the wait')
  assert.deepEqual(h.rows(), [], 'and the server has it')
  await h.close()
})
