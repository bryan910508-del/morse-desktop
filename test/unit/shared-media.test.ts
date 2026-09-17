import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MessageSearch } from '../../src/main/accounts/message-search'
import type { FirestoreReader, WatchEvents } from '../../src/main/network/firestore-rpc'
import { documents, type FirestoreDocument, type ReadDialog } from '../../src/main/network/firestore-values'

const chatId = 'chat1'
const dialog = { summary: { id: chatId, version: '1:0', kind: 'direct', title: 'peer', participantUids: ['me', 'peer'], top: null },
  cutoff: null, participantNames: { me: '나', peer: '상대' }, accountUid: 'me' } as unknown as ReadDialog
const doc = (id: string, at: number, fields: Record<string, unknown>): FirestoreDocument => ({
  name: `${documents}/chats/${chatId}/messages/${id}`, updateTime: { seconds: '5', nanos: 0 },
  fields: { createdAt: { timestampValue: { seconds: String(1_750_000_000 + at), nanos: 0 } }, senderId: { stringValue: 'peer' }, status: { stringValue: 'sent' }, ...fields }
} as unknown as FirestoreDocument)
const rows = [
  doc('t', 5, { type: { stringValue: 'text' }, text: { stringValue: '여기 봐요 example.com/a' } }),
  doc('p', 4, { type: { stringValue: 'image' }, mediaUrl: { stringValue: `https://firebasestorage.googleapis.com/v0/b/talky-a38c3.appspot.com/o/chat_media%2F${chatId}%2Fp.jpg?alt=media` } }),
  doc('f', 3, { type: { stringValue: 'file' }, fileName: { stringValue: '계약서.pdf' }, mediaUrl: { stringValue: `https://firebasestorage.googleapis.com/v0/b/talky-a38c3.appspot.com/o/chat_files%2F${chatId}%2Ff.pdf?alt=media` } }),
  doc('n', 2, { type: { stringValue: 'text' }, text: { stringValue: '링크 없는 글' } })
]
const reader = {
  query: async () => rows,
  watch: (_target: unknown, _signal: AbortSignal, events: WatchEvents) => { queueMicrotask(() => { events.snapshot(new Map()); events.state('ready') }); return () => {} }
} as unknown as FirestoreReader

// Telegram's Shared Media filters over the same bounded scan as a search.
test('the media, files and links tabs each keep only their own messages, whole', async () => {
  let revision = 0
  for (const [filter, ids] of [['media', ['p']], ['files', ['f']], ['links', ['t']]] as const) {
    const search = new MessageSearch('s1', dialog, filter, reader, () => {}, () => ++revision, filter)
    const snapshot = await search.more()
    assert.deepEqual(snapshot.hits.map(hit => hit.id), ids, filter)
    assert.ok(snapshot.hits.every(hit => hit.message?.id === hit.id))
    if (filter === 'links') assert.equal(snapshot.hits[0]!.snippet, 'https://example.com/a')
    search.close()
  }
})
