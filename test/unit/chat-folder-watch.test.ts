import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ChatFolderWatch, chatFolderList } from '../../src/main/accounts/chat-folder-watch'
import { documents, type FirestoreDocument } from '../../src/main/network/firestore-values'
import type { ReadCredentials } from '../../src/main/network/firestore-rpc'

// A folder changed on another device shows here at once. The list read from the watch is the same
// list a one-off read gives: decoded, ordered, bounded, and silent about a document it cannot read.
const uid = 'me1'
const folder = (id: string, order: number, fields: Record<string, unknown> = {}): FirestoreDocument => ({
  name: `${documents}/users/${uid}/folders/${id}`,
  fields: { name: { stringValue: `폴더 ${id}` }, order: { integerValue: String(order) }, chatIds: { arrayValue: { values: [{ stringValue: 'chat1' }] } }, ...fields }
} as unknown as FirestoreDocument)

test('folders come out in their order, then by id', () => {
  const list = chatFolderList(uid, [folder('b', 2), folder('a', 1), folder('c', 1)])
  assert.deepEqual(list.map(item => item.id), ['a', 'c', 'b'])
  assert.equal(list[0]!.name, '폴더 a')
  assert.deepEqual(list[0]!.chatIds, ['chat1'])
  assert.equal(list[0]!.excludeArchived, true, 'iOS treats a missing excludeArchived as on')
})

test('a document from another account or with an unreadable field is left out', () => {
  const foreign = { ...folder('x', 0), name: `${documents}/users/other/folders/x` } as FirestoreDocument
  const broken = folder('y', 0, { name: { stringValue: 'n'.repeat(600) } })
  assert.deepEqual(chatFolderList(uid, [foreign, broken, folder('ok', 0)]).map(item => item.id), ['ok'])
})

test('no more folders than the list keeps', () => {
  assert.equal(chatFolderList(uid, Array.from({ length: 250 }, (_, index) => folder(`f${index}`, index))).length, 200)
})

test('before anything is heard the watch says nothing, and reading it changes nothing', () => {
  let changes = 0
  const credentials = { signal: new AbortController().signal } as unknown as ReadCredentials
  const watch = new ChatFolderWatch(uid, credentials, () => { throw new Error('not connected') }, () => { changes++ })
  watch.resume()
  assert.equal(watch.snapshot(), null)
  assert.equal(changes, 0)
  watch.setLocked(true)
  assert.equal(watch.snapshot(), null)
  watch.close()
  assert.equal(watch.snapshot(), null)
})
