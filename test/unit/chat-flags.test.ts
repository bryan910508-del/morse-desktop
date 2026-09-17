import assert from 'node:assert/strict'
import { test } from 'node:test'
import Database from 'better-sqlite3-multiple-ciphers'
import { ChatFlags } from '../../src/main/accounts/chat-flags'
import { executeChatFlag, type ChatFlagCommand } from '../../src/main/storage/chat-flag-table'
import type { DialogSummary } from '../../src/shared/model'

function store(): (command: ChatFlagCommand) => Promise<unknown> {
  const db = new Database(':memory:')
  db.exec('CREATE TABLE chat_flags (chat_id TEXT PRIMARY KEY, muted INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0, category TEXT)')
  return async command => executeChatFlag(db, command)
}
const summary = (id: string, shared: boolean): DialogSummary => ({ id, muted: shared, archived: shared } as DialogSummary)

// The user's choice: «알림 끄기» and «보관» belong to this device, never to the room document everyone shares.
test('muting and archiving follow this device only and survive the next session', async () => {
  const save = store()
  const flags = new ChatFlags(save as never, () => {})
  const room = summary('c1', true)
  flags.apply(room)
  assert.deepEqual([room.muted, room.archived], [false, false], 'another person muting the room changes nothing here')
  await flags.set('c1', { muted: true })
  await flags.set('c1', { archived: true })
  flags.apply(room)
  assert.deepEqual([room.muted, room.archived], [true, true])
  const next = new ChatFlags(save as never, () => {})
  next.load(); await new Promise(resolve => setImmediate(resolve))
  const again = summary('c1', false)
  next.apply(again)
  assert.deepEqual([again.muted, again.archived], [true, true])
  await next.set('c1', { muted: false, archived: false })
  assert.deepEqual(await save({ kind: 'chat-flags-read' }), [], 'a room back to normal leaves no row')
})

test('a contact\'s favourite and archive stay on this device', async () => {
  const { ContactFlags } = await import('../../src/main/accounts/contact-flags')
  const { executeContactFlag } = await import('../../src/main/storage/contact-flag-table')
  const db = new Database(':memory:')
  db.exec('CREATE TABLE contact_flags (peer_uid TEXT PRIMARY KEY, favorite INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0)')
  const save = async (command: never) => executeContactFlag(db, command)
  const flags = new ContactFlags(save as never, () => {})
  await flags.set('friend', { favorite: true })
  await flags.set('friend', { archived: true })
  const next = new ContactFlags(save as never, () => {})
  next.load(); await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(next.get('friend'), { favorite: true, archived: true })
  assert.deepEqual(next.get('stranger'), { favorite: false, archived: false })
})
