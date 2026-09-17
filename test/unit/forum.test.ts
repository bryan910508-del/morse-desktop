import assert from 'node:assert/strict'
import { test } from 'node:test'
import Database from 'better-sqlite3-multiple-ciphers'
import { decodeDialog, type FirestoreDocument } from '../../src/main/network/firestore-values'
import { ChatFlags } from '../../src/main/accounts/chat-flags'
import { executeChatFlag, type ChatFlagCommand } from '../../src/main/storage/chat-flag-table'
import { inCategory, outgoingCategory } from '../../src/shared/forum'

const group = (fields: Record<string, unknown>): FirestoreDocument => ({
  name: 'projects/talky-a38c3/databases/(default)/documents/chats/g1', updateTime: { seconds: '1', nanos: 0 }, createTime: { seconds: '1', nanos: 0 },
  fields: { type: { stringValue: 'group' }, participantUids: { arrayValue: { values: [{ stringValue: 'me' }, { stringValue: 'peer' }] } }, ...fields }
} as unknown as FirestoreDocument)
const category = (id: string, name: string, order: number, general = false) => ({ mapValue: { fields: { id: { stringValue: id }, name: { stringValue: name },
  sortOrder: { integerValue: String(order) }, ...(general ? { isGeneral: { booleanValue: true } } : {}) } } })

// iOS MorseChatForumFirestore + MorseGroupCategorySelection.
test('a group with topics lists them in order, and sends into the chosen topic or the general one', async () => {
  const summary = decodeDialog(group({ isForumEnabled: { booleanValue: true }, generalForumCategoryId: { stringValue: 'general' },
    forumCategories: { arrayValue: { values: [category('B', '공지', 1), category('general', '일반', 0, true)] } } }), 'me').summary
  assert.deepEqual(summary.forum?.categories.map(item => item.id), ['general', 'B'])
  assert.equal(decodeDialog(group({ isForumEnabled: { booleanValue: false } }), 'me').summary.forum, undefined)
  const db = new Database(':memory:')
  db.exec('CREATE TABLE chat_flags (chat_id TEXT PRIMARY KEY, muted INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0, category TEXT)')
  const flags = new ChatFlags((async (command: ChatFlagCommand) => executeChatFlag(db, command)) as never, () => {})
  flags.apply(summary)
  assert.equal(outgoingCategory(summary), 'general', '«모두» sends into the general topic')
  await flags.set('g1', { category: 'B' })
  flags.apply(summary)
  assert.equal(summary.forumSelected, 'B')
  assert.equal(outgoingCategory(summary), 'B')
  assert.equal(inCategory({ categoryId: undefined }, summary.forum!, 'B'), false)
  assert.equal(inCategory({ categoryId: undefined }, summary.forum!, 'general'), true, 'a message without a topic is general')
  assert.equal(inCategory({ categoryId: 'B' }, summary.forum!, null), true)
  await flags.set('g1', { category: 'gone' })
  flags.apply(summary)
  assert.equal(summary.forumSelected, null, 'a removed topic falls back to «모두»')
})
