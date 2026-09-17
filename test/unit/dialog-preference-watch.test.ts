import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fromJSON } from '@grpc/proto-loader'
import { DialogPreferenceWatch, dialogPreferenceTarget, dialogPreferences } from '../../src/main/accounts/dialog-preference-watch'
import { writeDialogPreference } from '../../src/main/network/dialog-preference-write'
import { documents, type FirestoreDocument } from '../../src/main/network/firestore-values'
import type { ReadCredentials } from '../../src/main/network/firestore-rpc'

// A chat muted or archived on the phone is muted or archived here too: the account document every device
// writes (users/{uid}/settings/dialog_{chatId}) is followed, and this device's own write is not undone by
// a snapshot that predates it.
const uid = 'me1'
const preference = (chatId: string, fields: Record<string, unknown>, seconds = 1, name = `${documents}/users/${uid}/settings/dialog_${chatId}`): FirestoreDocument => ({
  name, updateTime: { seconds: String(seconds), nanos: 0 },
  fields: { kind: { stringValue: 'dialogPreference' }, chatId: { stringValue: chatId }, ...fields }
} as unknown as FirestoreDocument)
const credentials = { signal: new AbortController().signal } as unknown as ReadCredentials

function watch(now = { value: 0 }) {
  const applied: [string, { muted: boolean; archived?: boolean }][] = []
  const value = new DialogPreferenceWatch(uid, credentials, () => { throw new Error('not connected') }, (chatId, patch) => { applied.push([chatId, patch]) }, () => now.value)
  const receive = (rows: FirestoreDocument[]): void => { (value as unknown as { receive(rows: FirestoreDocument[]): void }).receive(rows) }
  return { value, applied, receive, now }
}

test('only this account\'s dialog preference documents are read, and a missing archive stays untouched', () => {
  const rows = dialogPreferences(uid, [
    preference('a', { isMuted: { booleanValue: true }, isArchived: { booleanValue: false } }),
    preference('b', {}),
    preference('c', { isMuted: { booleanValue: true } }, 1, `${documents}/users/other/settings/dialog_c`),
    { ...preference('d', { isMuted: { booleanValue: true } }), fields: { kind: { stringValue: 'pin' }, chatId: { stringValue: 'd' } } } as unknown as FirestoreDocument
  ])
  assert.deepEqual([...rows.keys()], ['a', 'b'])
  assert.deepEqual({ muted: rows.get('a')!.muted, archived: rows.get('a')!.archived }, { muted: true, archived: false })
  assert.deepEqual({ muted: rows.get('b')!.muted, archived: rows.get('b')!.archived }, { muted: false, archived: null })
})

test('a change from another device is applied once per document version', () => {
  const { applied, receive } = watch()
  receive([preference('a', { isMuted: { booleanValue: true } }, 1)])
  receive([preference('a', { isMuted: { booleanValue: true } }, 1)])
  receive([preference('a', { isMuted: { booleanValue: false }, isArchived: { booleanValue: true } }, 2)])
  assert.deepEqual(applied, [['a', { muted: true }], ['a', { muted: false, archived: true }]])
})

test('this device\'s own write is not taken back by a snapshot that does not carry it yet', () => {
  const { value, applied, receive, now } = watch()
  value.wrote('a', 'op-mine')
  receive([preference('a', { isMuted: { booleanValue: false }, operationId: { stringValue: 'op-old' } }, 1)])
  assert.deepEqual(applied, [])
  receive([preference('a', { isMuted: { booleanValue: true }, operationId: { stringValue: 'op-mine' } }, 2)])
  assert.deepEqual(applied, [], 'the list already holds this device\'s choice')
  receive([preference('a', { isMuted: { booleanValue: false }, operationId: { stringValue: 'op-phone' } }, 3)])
  assert.deepEqual(applied, [['a', { muted: false }]])
  value.wrote('b', 'op-lost')
  now.value += 61000
  receive([preference('b', { isMuted: { booleanValue: true }, operationId: { stringValue: 'op-other' } }, 4)])
  assert.deepEqual(applied.at(-1), ['b', { muted: true }], 'a write that never came back stops blocking the account document')
})

test('a failed write stops waiting for its echo', () => {
  const { value, applied, receive } = watch()
  value.wrote('a', 'op-mine')
  value.writeFailed('a', 'op-mine')
  receive([preference('a', { isMuted: { booleanValue: true }, operationId: { stringValue: 'op-phone' } }, 1)])
  assert.deepEqual(applied, [['a', { muted: true }]])
})

test('a locked or closed watch never starts a listener', () => {
  const { value } = watch()
  value.setLocked(true)
  value.resume()
  value.close()
  value.setLocked(false)
})

test('the listen target and the preference write serialize through the Firestore descriptor', async () => {
  const definition = fromJSON(JSON.parse(readFileSync(join(process.cwd(), 'resources/firestore-v1.json'), 'utf8')), { longs: String, enums: String, bytes: Buffer, defaults: false, oneofs: true })
  const service = definition['google.firestore.v1.Firestore'] as unknown as Record<string, { requestSerialize(value: unknown): Buffer; requestDeserialize(value: Buffer): any }>
  const method = (name: string) => service[Object.keys(service).find(key => key.toLowerCase() === name)!]!
  const database = documents.slice(0, -'/documents'.length)
  const listen = method('listen')
  const sent = listen.requestDeserialize(listen.requestSerialize({ database, addTarget: { ...dialogPreferenceTarget(uid), targetId: 1 } }))
  assert.equal(sent.addTarget.query.structuredQuery.where.fieldFilter.value.stringValue, 'dialogPreference')
  let request: unknown = null
  const client = { commit: (value: unknown, _auth: unknown, _options: unknown, callback: (error: null, response: unknown) => void) => { request = value; callback(null, {}); return { cancel() {} } } }
  await writeDialogPreference(client as never, {} as never, uid, { chatId: 'chat1', muted: true, archived: false, operationId: 'op-1' }, new AbortController().signal, () => {})
  const written = method('commit').requestDeserialize(method('commit').requestSerialize(request)).writes[0]
  assert.equal(written.update.fields.operationId.stringValue, 'op-1')
  assert.equal(written.update.fields.isMuted.booleanValue, true)
  assert.equal(written.updateTransforms[0].fieldPath, 'updatedAt')
})
