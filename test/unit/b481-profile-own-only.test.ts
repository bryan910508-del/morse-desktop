import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { Metadata } from '@grpc/grpc-js'
import { writeProfileDisplay } from '../../src/main/network/profile-display-write'
import { documents, type WireObject } from '../../src/main/network/firestore-values'

// B481 ③ (after B478): a name or photo change writes this account's own profile and nothing else. The copies other
// accounts read are the server's to keep in step (B48 / B481 ②), as Telegram's client sends only its own
// account.updateProfile. So no room, channel or inquiry is looked up — the notices chat, a room past 449 or a room
// changed meanwhile can no longer stop the edit.
const uid = 'me'
const at = { seconds: '1790000000', nanos: 0 }
const doc = (path: string, fields: Record<string, WireObject>) => ({ name: `${documents}/${path}`, fields, createTime: at, updateTime: at })

function stream(items: WireObject[]): EventEmitter & { cancel(): void } {
  const emitter = Object.assign(new EventEmitter(), { cancel() {} })
  setImmediate(() => { for (const item of items) emitter.emit('data', item); emitter.emit('end'); emitter.emit('close') })
  return emitter
}
function client(photo = '') {
  const committed: WireObject[][] = [], read: WireObject[] = []
  return {
    committed, read,
    batchGetDocuments: (request: WireObject) => {
      read.push(request)
      return stream([{ found: doc(`users/${uid}`, { displayName: { stringValue: '옛 이름' }, userId: { stringValue: 'me_id' }, ...(photo ? { photoURL: { stringValue: photo } } : {}) }), readTime: at }])
    },
    runQuery: () => { throw new Error('no room, channel or inquiry is looked up') },
    commit: (request: WireObject, _m: Metadata, _o: unknown, callback: (error: null, response: WireObject) => void) => {
      const writes = (request as { writes: WireObject[] }).writes
      committed.push(writes)
      setImmediate(() => callback(null, { commitTime: at, writeResults: writes.map(() => ({ updateTime: at })) }))
      return {} as never
    }
  }
}
const version = '1790000000:0'
const written = (writes: WireObject[]) => writes.map(write => {
  const w = write as { update: { name: string; fields: Record<string, { stringValue: string }> }; updateMask: { fieldPaths: string[] }; currentDocument: { updateTime: unknown } }
  return { doc: w.update.name.slice(documents.length + 1), mask: w.updateMask.fieldPaths, value: Object.values(w.update.fields)[0]?.stringValue, guarded: Boolean(w.currentDocument.updateTime) }
})

test('a name change writes only this account\'s profile, guarded by the version it read', async () => {
  const fake = client()
  await writeProfileDisplay(fake as never, new Metadata(), uid, { kind: 'name', edit: { version, displayName: '새 이름' } } as never, new AbortController().signal, () => {})
  assert.equal(fake.committed.length, 1)
  assert.deepEqual(written(fake.committed[0]), [{ doc: `users/${uid}`, mask: ['displayName'], value: '새 이름', guarded: true }])
  assert.deepEqual(fake.read.length, 1, 'the profile alone is read')
})

test('removing the photo writes only the profile too, and refuses when there is no photo', async () => {
  const fake = client('https://firebasestorage.googleapis.com/v0/b/x/o/p?alt=media')
  await writeProfileDisplay(fake as never, new Metadata(), uid, { kind: 'clear-photo', edit: { version } } as never, new AbortController().signal, () => {})
  assert.deepEqual(written(fake.committed[0]), [{ doc: `users/${uid}`, mask: ['photoURL'], value: '', guarded: true }])
  await assert.rejects(writeProfileDisplay(client() as never, new Metadata(), uid, { kind: 'clear-photo', edit: { version } } as never, new AbortController().signal, () => {}))
})
