import assert from 'node:assert/strict'
import { test } from 'node:test'
import { status } from '@grpc/grpc-js'
import { RoomPresence } from '../../src/main/accounts/room-presence'
import { DocumentWriteFailure, FirestoreReader } from '../../src/main/network/firestore-rpc'
import { documents } from '../../src/main/network/firestore-values'

// chats/{id}/watchers/{uid}, as iOS publishes it: written when a room is open in front of the person, again every 55 s
// while they stay, deleted when they leave (AppState commitActiveChatPresenceWritesIfNeeded / setActiveChat(nil)).
test('the room is announced while it is open in front, refreshed while it stays, and taken back when left', async () => {
  const calls: string[] = []
  const presence = new RoomPresence(() => ({ enter: async chatId => { calls.push(`enter ${chatId}`) }, leave: async chatId => { calls.push(`leave ${chatId}`) } }), new AbortController().signal, 20)
  presence.set('a')
  await new Promise(resolve => setTimeout(resolve, 50))
  assert.ok(calls.filter(call => call === 'enter a').length >= 2, 'written again while the room stays')
  calls.length = 0
  presence.set('a')
  assert.deepEqual(calls, [], 'the same room is not announced twice at once')
  presence.set('b')
  assert.deepEqual(calls, ['leave a', 'enter b'], 'moving to another room leaves the first')
  presence.set(null)
  await new Promise(resolve => setTimeout(resolve, 50))
  assert.deepEqual(calls, ['leave a', 'enter b', 'leave b'], 'left, and nothing more is written')
  presence.close()
})

// The writes themselves (firestore-rpc.ts), captured from a stubbed client. iOS 886b1f49: «typing» only changes a record
// that is there, so a «not typing» sent as the room closes cannot bring back the record the leave deleted; the server's
// «not found» for it is the expected answer, not a failure.
type WatcherWrite = { update?: { name: string; fields: Record<string, unknown> }; delete?: string; updateMask?: { fieldPaths: string[] }; currentDocument?: { exists?: boolean }; updateTransforms?: { fieldPath: string }[] }
function stubbedReader(answer: { code: number; details: string } | null): { reader: FirestoreReader; sent: WatcherWrite[] } {
  const credentials = { signal: new AbortController().signal, authorize: async () => ({ idToken: 'token', appCheckToken: 'check' }) }
  const reader = new FirestoreReader(credentials as never), sent: WatcherWrite[] = []
  ;(reader as unknown as { client: unknown }).client = {
    commit: (payload: { writes: WatcherWrite[] }, _metadata: unknown, _options: unknown, callback: (error: unknown, response?: unknown) => void) => {
      sent.push(...payload.writes)
      if (answer) callback(answer); else callback(null, { writeResults: payload.writes.map(() => ({})), commitTime: { seconds: '1', nanos: 0 } })
      return { cancel: () => {} }
    },
    close: () => {}
  }
  return { reader, sent }
}
const watcher = `${documents}/chats/chat1/watchers/me`

test('typing changes only a watcher record that is there, and a record already gone is not an error', async () => {
  const { reader, sent } = stubbedReader({ code: status.NOT_FOUND, details: 'No document to update' })
  await reader.setChatWatcherTyping('chat1', 'me', false, new AbortController().signal)
  assert.equal(sent[0]?.update?.name, watcher)
  assert.deepEqual(sent[0]?.currentDocument, { exists: true }, 'never creates the record')
  assert.deepEqual(sent[0]?.updateMask?.fieldPaths, ['uid', 'typing'])
  const refused = stubbedReader({ code: status.PERMISSION_DENIED, details: 'denied' })
  await assert.rejects(refused.reader.setChatWatcherTyping('chat1', 'me', true, new AbortController().signal), (error: unknown) => error instanceof DocumentWriteFailure && error.code === status.PERMISSION_DENIED)
  reader.close(); refused.reader.close()
})

test('entering a room writes its watcher record whether or not it exists, and leaving deletes it', async () => {
  const { reader, sent } = stubbedReader(null)
  await reader.enterChatWatcher('chat1', 'me', new AbortController().signal)
  await reader.leaveChatWatcher('chat1', 'me', new AbortController().signal)
  assert.equal(sent[0]?.update?.name, watcher)
  assert.equal(sent[0]?.currentDocument, undefined, 'set with merge: no precondition')
  assert.deepEqual(sent[0]?.updateMask?.fieldPaths, ['uid'])
  assert.deepEqual(sent[0]?.updateTransforms?.map(transform => transform.fieldPath), ['enteredAt'])
  assert.equal(sent[1]?.delete, watcher)
  reader.close()
})
