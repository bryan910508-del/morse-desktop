import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ChannelDeletionApi, type ChannelDeletionPort } from '../../src/main/api/channel-deletion'
import { MorseCallableFailure } from '../../src/main/network/morse-callable'
import type { FirestoreDocument } from '../../src/main/network/firestore-values'

// B105 (inbox, user rule «텔레그램 구조»): Desktop had no «채널 삭제». tdesktop ends the owner's edit box with it, a
// confirm box and one channels.deleteChannel (edit_peer_info_box.cpp:1834-1841, 3066-3101). Morse's one call is the
// server's deleteMorseChannel (owner check, delete, then the server's cleanup — B110: a client deleting only the document
// left subscription indexes behind). An unknown outcome is read, never sent again.

const channelDoc = { name: 'projects/p/databases/(default)/documents/channels/ch1', fields: {} } as unknown as FirestoreDocument

function fake(remove: () => Promise<void>, reads: (FirestoreDocument | null | Error)[] = []) {
  const calls: string[] = []
  let read = 0, closed = 0
  const port: ChannelDeletionPort = {
    remove: async () => { calls.push('call'); await remove() },
    channel: async () => { calls.push('read'); const next = reads[read++]; if (next instanceof Error) throw next; return next ?? null }
  }
  const api = new ChannelDeletionApi(() => {}, () => ({ port, close: () => { closed++ } }))
  return { api, calls, closed: () => closed }
}

test('B105: one deleteMorseChannel call deletes the channel', async () => {
  const { api, calls, closed } = fake(async () => {})
  assert.equal(await api.delete('ch1'), 'done')
  assert.deepEqual(calls, ['call'])
  assert.equal(closed(), 1)
})

test('B105: the server refusing a non-owner is said as such; a channel already gone is done', async () => {
  const denied = fake(async () => { throw new MorseCallableFailure('answered', 'PERMISSION_DENIED') })
  await assert.rejects(denied.api.delete('ch1'), /채널 소유자만/)
  assert.deepEqual(denied.calls, ['call'])
  const gone = fake(async () => { throw new MorseCallableFailure('answered', 'NOT_FOUND') })
  assert.equal(await gone.api.delete('ch1'), 'done')
  const other = fake(async () => { throw new MorseCallableFailure('answered', 'FAILED_PRECONDITION') })
  await assert.rejects(other.api.delete('ch1'), /채널을 삭제하지 못했습니다/)
})

test('B105: a call that never left is an error to try again, without a read', async () => {
  const { api, calls } = fake(async () => { throw new MorseCallableFailure('not-sent', 'UNAVAILABLE') })
  await assert.rejects(api.delete('ch1'), /연결을 확인해 주세요/)
  assert.deepEqual(calls, ['call'])
})

test('B105: an unknown outcome is read, never called again — gone is done, still there is an error, unreadable is unconfirmed', async () => {
  const unknown = () => { throw new MorseCallableFailure('unknown', 'UNKNOWN') }
  const gone = fake(async () => unknown(), [null])
  assert.equal(await gone.api.delete('ch1'), 'done')
  assert.deepEqual(gone.calls, ['call', 'read'])
  const there = fake(async () => unknown(), [channelDoc])
  await assert.rejects(there.api.delete('ch1'), /채널을 삭제하지 못했습니다/)
  assert.deepEqual(there.calls, ['call', 'read'])
  const unreadable = fake(async () => unknown(), [new Error('offline')])
  assert.equal(await unreadable.api.delete('ch1'), 'unconfirmed')
})
