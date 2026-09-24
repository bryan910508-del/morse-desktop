import assert from 'node:assert/strict'
import { test } from 'node:test'
import Database from 'better-sqlite3-multiple-ciphers'
import { MessageActions, reactionRetryDelay, reactionRetryLimit } from '../../src/main/messaging/message-actions'
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

test('the wait before sending a reaction again grows and then holds', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map(reactionRetryDelay), [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000])
  assert.equal(reactionRetryLimit, 8)
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
