import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HistoryReader } from '../../src/main/accounts/history-reader'
import type { FirestoreReader, WatchEvents } from '../../src/main/network/firestore-rpc'
import { documents, type FirestoreDocument, type ReadDialog } from '../../src/main/network/firestore-values'

// B104 (a, user rule «텔레그램 구조»): the server still counting a chat unread is a fact about the chat. A chat shown at
// its bottom is read once to its newest message, whoever sent it — tdesktop reads till the last server message
// (Histories::readInbox, data_histories.cpp:175-203) and, on activation, till the lowest message shown, its own or not
// (history_inner_widget.cpp:4426-4460). Before, only a visible message from the other person could send a read, so a
// chat ending with this account's own messages kept a count no read ever corrected. The server takes any message of
// the room since talky d725541; a failed send it refuses, so it is passed over.

const chatId = 'chat1', me = 'me', peer = 'peer'
const dialog = {
  summary: { id: chatId, version: '1:0', kind: 'direct', title: 'peer', participantUids: [me, peer], preview: '', unreadCount: 4, markedUnread: false,
    readPositions: {}, readSync: { status: 'ready' }, pinned: false, pinVersion: '', muted: false, archived: false, top: null },
  cutoff: null, participantNames: { [me]: 'me', [peer]: 'peer' }, accountUid: me
} as unknown as ReadDialog

const doc = (index: number, senderId: string, status = 'sent'): FirestoreDocument => ({
  name: `${documents}/chats/${chatId}/messages/m${index}`, updateTime: { seconds: '1', nanos: 0 },
  fields: { createdAt: { timestampValue: { seconds: String(1_750_000_000 + index), nanos: 0 } }, senderId: { stringValue: senderId },
    text: { stringValue: `m${index}` }, type: { stringValue: 'text' }, status: { stringValue: status } }
} as unknown as FirestoreDocument)

async function opened(rows: FirestoreDocument[]): Promise<HistoryReader> {
  const reader = {
    watch: (_target: unknown, _signal: AbortSignal, events: WatchEvents) => {
      queueMicrotask(() => { events.snapshot(new Map(rows.map(row => [row.name, row]))); events.state('ready') }); return () => {}
    },
    query: async () => []
  } as unknown as FirestoreReader
  let revision = 0
  const history = new HistoryReader(dialog, reader, () => {}, () => ++revision)
  history.start()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(history.snapshot.status, 'ready')
  return history
}

test('B104 (a): at the bottom the read goes to the newest message, this account\'s own included', async () => {
  const history = await opened([doc(1, peer), doc(2, peer), doc(3, me)])
  assert.equal(history.bottomReadTarget(history.snapshot.revision)?.id, 'm3')
})

test('B104 (a): a failed send at the bottom is passed over for the newest message the server holds', async () => {
  const history = await opened([doc(1, peer), doc(2, me), doc(3, me, 'failed')])
  assert.equal(history.bottomReadTarget(history.snapshot.revision)?.id, 'm2')
})

test('B104 (a): a history that moved on since the window looked asks nothing', async () => {
  const history = await opened([doc(1, peer)])
  assert.equal(history.bottomReadTarget(history.snapshot.revision + 1), null)
})
