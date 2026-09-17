import assert from 'node:assert/strict'
import { test } from 'node:test'
import Database from 'better-sqlite3-multiple-ciphers'
import { HiddenMessages } from '../../src/main/accounts/hidden-messages'
import { executeHiddenMessage, type HiddenMessageCommand } from '../../src/main/storage/hidden-message-table'

function store(): (command: HiddenMessageCommand) => Promise<unknown> {
  const db = new Database(':memory:')
  db.exec('CREATE TABLE hidden_messages (chat_id TEXT NOT NULL, message_id TEXT NOT NULL, hidden_at REAL NOT NULL, PRIMARY KEY(chat_id, message_id))')
  return async command => executeHiddenMessage(db, command)
}

// iOS «나에게만 삭제»: the message leaves this device's history for good and nothing goes to the server.
test('a message deleted for me stays hidden after the next session reads the device again', async () => {
  const save = store()
  let arrived = 0
  const first = new HiddenMessages(save as never, () => { arrived++ })
  await first.hide('chat1', ['m1', 'm2'])
  assert.equal(first.has('chat1', 'm1'), true)
  assert.equal(first.has('chat2', 'm1'), false)
  assert.equal(arrived, 1, 'shown as gone at once')
  const next = new HiddenMessages(save as never, () => { arrived++ })
  next.load()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(next.has('chat1', 'm2'), true)
  assert.equal(arrived, 2)
})

test('a hide made while the device is being read is kept', async () => {
  let release!: (rows: unknown) => void
  const pending = new Promise(resolve => { release = resolve })
  const hidden = new HiddenMessages((async (command: HiddenMessageCommand) => command.kind === 'hidden-messages-read' ? pending : null) as never, () => {})
  hidden.load()
  await hidden.hide('chat1', ['new'])
  release([{ chatId: 'chat1', messageId: 'old' }])
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(hidden.has('chat1', 'new'), true)
  assert.equal(hidden.has('chat1', 'old'), true)
})

test('the table refuses an empty or oversized batch', async () => {
  const save = store()
  await assert.rejects(save({ kind: 'hidden-messages-add', chatId: 'c', messageIds: [], at: 1 }))
  await assert.rejects(save({ kind: 'hidden-messages-add', chatId: 'c', messageIds: Array.from({ length: 101 }, (_, i) => `m${i}`), at: 1 }))
})
