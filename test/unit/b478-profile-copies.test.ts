import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { Metadata } from '@grpc/grpc-js'
import { writeProfileDisplay } from '../../src/main/network/profile-display-write'
import { documents, type WireObject } from '../../src/main/network/firestore-values'

// B478: a name or photo change writes the account's profile and its copy in every room it may write, in one commit.
// The official notices chat (type 'system', chats/system_{uid}, participantUids [uid, 'morse-system']) is refused by the
// rules (chats update: type != 'system'), and it used to stop the whole edit — an account that had any notice could not
// change its name or photo on this device. It is passed over now, as a discussion room is, and so is a kind this build
// does not know.
const uid = 'me'
const at = { seconds: '1790000000', nanos: 0 }
const doc = (path: string, fields: Record<string, WireObject>) => ({ name: `${documents}/${path}`, fields, createTime: at, updateTime: at })
const chat = (id: string, type: string, extra: Record<string, WireObject> = {}) => doc(`chats/${id}`, {
  type: { stringValue: type }, participantUids: { arrayValue: { values: [{ stringValue: uid }, { stringValue: 'other' }] } }, ...extra })

function stream(items: WireObject[]): EventEmitter & { cancel(): void } {
  const emitter = Object.assign(new EventEmitter(), { cancel() {} })
  setImmediate(() => { for (const item of items) emitter.emit('data', item); emitter.emit('end'); emitter.emit('close') })
  return emitter
}
function client(rooms: ReturnType<typeof chat>[]) {
  const committed: WireObject[][] = []
  return {
    committed,
    batchGetDocuments: () => stream([{ found: doc(`users/${uid}`, { displayName: { stringValue: '옛 이름' }, userId: { stringValue: 'me_id' } }), readTime: at }]),
    runQuery: (request: WireObject) => {
      const from = (request as { structuredQuery: { from: { collectionId: string }[] } }).structuredQuery.from[0].collectionId
      return stream([...(from === 'chats' ? rooms.map(room => ({ document: room, readTime: at })) : []), { readTime: at }])
    },
    commit: (request: WireObject, _m: Metadata, _o: unknown, callback: (error: null, response: WireObject) => void) => {
      const writes = (request as { writes: WireObject[] }).writes
      committed.push(writes)
      setImmediate(() => callback(null, { commitTime: at, writeResults: writes.map(() => ({ updateTime: at })) }))
      return {} as never
    }
  }
}
const nameChange = { kind: 'name' as const, edit: { version: '1790000000:0', displayName: '새 이름' } }
const written = (writes: WireObject[]) => writes.map(write => (write as { update: { name: string } }).update.name.slice(documents.length + 1))

test('the official notices chat does not stop a name change; the profile and the other rooms are written', async () => {
  const fake = client([chat('d1', 'direct'), chat(`system_${uid}`, 'system'), chat('g1', 'group')])
  const count = await writeProfileDisplay(fake as never, new Metadata(), uid, nameChange as never, new AbortController().signal, () => {})
  assert.equal(count, 2, 'two room copies besides the profile')
  assert.equal(fake.committed.length, 1, 'still one commit')
  assert.deepEqual(written(fake.committed[0]), [`users/${uid}`, 'chats/d1', 'chats/g1'])
})

test('a room kind this build does not know is passed over like a discussion room', async () => {
  const fake = client([chat('n1', 'newkind'), chat('channel_discuss_c1', 'group'), chat('s1', 'secret'), chat('x1', 'group', { isChannelDiscussion: { booleanValue: true } })])
  const count = await writeProfileDisplay(fake as never, new Metadata(), uid, nameChange as never, new AbortController().signal, () => {})
  assert.equal(count, 1)
  assert.deepEqual(written(fake.committed[0]), [`users/${uid}`, 'chats/s1'])
})
