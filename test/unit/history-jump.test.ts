import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HistoryReader } from '../../src/main/accounts/history-reader'
import type { FirestoreReader, WatchEvents } from '../../src/main/network/firestore-rpc'
import { documents, type FirestoreDocument, type ReadDialog } from '../../src/main/network/firestore-values'
import type { HistorySnapshot } from '../../src/shared/model'

const chatId = 'chat1', me = 'me', peer = 'peer'
const dialog = {
  summary: { id: chatId, version: '1:0', kind: 'direct', title: 'peer', participantUids: [me, peer], preview: '', unreadCount: 0, markedUnread: false,
    readPositions: {}, readSync: { status: 'ready' }, pinned: false, pinVersion: '', muted: false, archived: false, top: null },
  cutoff: null, participantNames: { [me]: 'me', [peer]: 'peer' }, accountUid: me
} as unknown as ReadDialog

// A Firestore reader that answers the tail watch with an empty page and a jump query with `rows`.
function fakeReader(rows: FirestoreDocument[]) {
  const watches: WatchEvents[] = []
  const reader = {
    watch: (_target: unknown, _signal: AbortSignal, events: WatchEvents) => { watches.push(events); queueMicrotask(() => { events.snapshot(new Map()); events.state('ready') }); return () => {} },
    query: async () => rows
  } as unknown as FirestoreReader
  return { reader, watches }
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

test('a jump that cannot find its message returns to the latest page instead of an error', async () => {
  const { reader, watches } = fakeReader([])
  const published: HistorySnapshot[] = []
  let revision = 0
  const history = new HistoryReader(dialog, reader, snapshot => published.push(snapshot), () => ++revision)
  history.start(); await tick()
  assert.equal(history.snapshot.status, 'ready')
  const target = { seconds: 1_750_000_000, nanoseconds: 0, id: 'missing' }
  await assert.rejects(history.jump(target), /메시지로 이동하지 못했습니다/)
  await tick()
  assert.notEqual(history.snapshot.status, 'error', 'history must not be wiped to an error')
  assert.equal(watches.length, 2, 'the latest page is watched again')
  assert.equal(history.snapshot.status, 'ready')
})

test('a loaded-row watch re-listen keeps the chat', async () => {
  const doc = (index: number): FirestoreDocument => ({
    name: `${documents}/chats/${chatId}/messages/m${index}`, updateTime: { seconds: '1', nanos: 0 },
    fields: { createdAt: { timestampValue: { seconds: String(1_750_000_000 + index), nanos: 0 } }, senderId: { stringValue: peer }, text: { stringValue: `m${index}` }, type: { stringValue: 'text' }, status: { stringValue: 'sent' } }
  } as unknown as FirestoreDocument)
  const rows = [doc(3), doc(2), doc(1)]
  const { reader, watches } = fakeReader(rows)
  let revision = 0
  const history = new HistoryReader(dialog, reader, () => {}, () => ++revision)
  history.start(); await tick()
  await history.jump({ seconds: 1_750_000_003, nanoseconds: 0, id: 'm3' }).catch(() => {})
  await tick()
  const groups = watches.slice(1)
  // FirestoreReader.watch re-listen: `reconnecting` when the watcher offers it, otherwise state('loading', reason).
  for (const events of groups) {
    events.snapshot(new Map(rows.map(row => [row.name, row])))
    const reconnecting = (events as WatchEvents & { reconnecting?: (error?: unknown) => void }).reconnecting
    if (reconnecting) reconnecting({ code: 'network' })
    else events.state('loading', { code: 'network', message: 'network' } as never)
  }
  await tick()
  assert.notEqual(history.snapshot.status, 'error')
})

// Telegram resolveJumpToDate: the first message at or after the chosen day; a message hidden for me is passed over.
test('a date opens at the first message from that day that can be shown', async () => {
  const doc = (index: number): FirestoreDocument => ({
    name: `${documents}/chats/${chatId}/messages/d${index}`, updateTime: { seconds: '1', nanos: 0 },
    fields: { createdAt: { timestampValue: { seconds: String(1_750_000_000 + index * 60), nanos: 0 } }, senderId: { stringValue: peer }, text: { stringValue: `d${index}` }, type: { stringValue: 'text' }, status: { stringValue: 'sent' } }
  } as unknown as FirestoreDocument)
  let asked: unknown = null
  const reader = {
    watch: (_target: unknown, _signal: AbortSignal, events: WatchEvents) => { queueMicrotask(() => { events.snapshot(new Map()); events.state('ready') }); return () => {} },
    query: async (_parent: string, query: unknown) => { asked = query; return [doc(2), doc(3)] }
  } as unknown as FirestoreReader
  let revision = 0
  const history = new HistoryReader(dialog, reader, () => {}, () => ++revision, id => id === 'd2')
  history.start(); await tick()
  const target = await history.dateTarget(1_750_000_000_000)
  assert.equal(target?.id, 'd3')
  const order = (asked as { orderBy: { direction: string }[] }).orderBy
  assert.equal(order[0]!.direction, 'ASCENDING')
  const none = new HistoryReader(dialog, { ...reader, query: async () => [] } as unknown as FirestoreReader, () => {}, () => ++revision)
  none.start(); await tick()
  assert.equal(await none.dateTarget(1_750_000_000_000), null)
})
