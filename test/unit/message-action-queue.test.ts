import assert from 'node:assert/strict'
import { test } from 'node:test'
import Database from 'better-sqlite3-multiple-ciphers'
import { executeMessageAction } from '../../src/main/storage/message-action-table'
import type { MessageActionCommand, StoredMessageAction } from '../../src/main/storage/message-action-protocol'

function store(): (command: MessageActionCommand) => unknown {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE message_actions (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL,
    chat_id TEXT NOT NULL, message_id TEXT NOT NULL, digest TEXT NOT NULL, payload TEXT, state TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '');
    CREATE UNIQUE INDEX action_pending ON message_actions(chat_id,message_id) WHERE state IN ('queued','uncertain');`)
  return command => executeMessageAction(db, command)
}
const reaction = (id: string, reactions: string[]): StoredMessageAction =>
  ({ id, chatId: 'c1', messageId: 'm1', version: '1:1', kind: 'reaction', reactions, preview: 'hi', state: 'queued', reason: '' })
const edit = (id: string): StoredMessageAction =>
  ({ id, chatId: 'c1', messageId: 'm1', version: '1:1', kind: 'edit', text: 'next', preview: 'hi', state: 'queued', reason: '' })
const list = (run: (command: MessageActionCommand) => unknown): StoredMessageAction[] =>
  run({ kind: 'action-list' }) as StoredMessageAction[]

// iOS MorsePendingReactionSync.enqueue drops that message's intents before adding its own: the newest selection is
// the one that counts. Refusing instead froze the message whenever the older attempt could not be resolved.
test('a newer reaction replaces the one still waiting on the same message', () => {
  const run = store()
  run({ kind: 'action-enqueue', action: reaction('a1', ['👍']) })
  run({ kind: 'action-enqueue', action: reaction('a2', ['❤️']) })
  const rows = list(run)
  assert.deepEqual(rows.map(row => row.id), ['a2'], 'only the newest selection is left waiting')
  assert.deepEqual(rows[0].reactions, ['❤️'])
})

test('a reaction whose outcome is unknown no longer blocks the next one', () => {
  const run = store()
  run({ kind: 'action-enqueue', action: reaction('a1', ['👍']) })
  run({ kind: 'action-claim', id: 'a1' })
  run({ kind: 'action-state', id: 'a1', state: 'uncertain', reason: '결과를 확인하지 못했습니다.' })
  run({ kind: 'action-enqueue', action: reaction('a2', ['❤️']) })
  assert.deepEqual(list(run).map(row => row.id), ['a2'])
})

// An edit and a delete are conditional writes on one version, so they still keep the message to themselves.
test('an edit and a reaction still refuse to overtake each other', () => {
  const run = store()
  run({ kind: 'action-enqueue', action: edit('e1') })
  assert.throws(() => run({ kind: 'action-enqueue', action: reaction('a1', ['👍']) }), /Action pending/)
  const other = store()
  other({ kind: 'action-enqueue', action: reaction('a1', ['👍']) })
  assert.throws(() => other({ kind: 'action-enqueue', action: edit('e1') }), /Action pending/)
})

test('the same request sent twice stays one row, and a different one under that id is a conflict', () => {
  const run = store()
  run({ kind: 'action-enqueue', action: reaction('a1', ['👍']) })
  run({ kind: 'action-enqueue', action: reaction('a1', ['👍']) })
  assert.equal(list(run).length, 1)
  assert.throws(() => run({ kind: 'action-enqueue', action: reaction('a1', ['❤️']) }), /Action conflict/)
})
