import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HistoryReader } from '../../src/main/accounts/history-reader'
import type { FirestoreReader, WatchEvents } from '../../src/main/network/firestore-rpc'
import { documents, type FirestoreDocument, type ReadDialog } from '../../src/main/network/firestore-values'
import type { ChatMessage } from '../../src/shared/model'
import { unreadEntry } from '../../src/shared/unread-entry'

// F-MB-003: a room with unread messages opens at the first of them only when the page reaches the read boundary;
// otherwise it reads around it (tdesktop firstLoadMessages / loadAroundId), and with nothing to go by it opens at the bottom.
const me = 'me', peer = 'peer', base = 1_750_000_000
const message = (index: number, from = peer, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id: `m${index}`, senderId: from, readEligible: from !== me, system: false,
  position: { seconds: base + index, nanoseconds: 0, id: `m${index}` }, ...extra
} as ChatMessage)
const read = (index: number) => ({ at: (base + index) * 1000, id: `m${index}` })
const page = (from: number, to: number, hasMore: boolean) => ({ messages: Array.from({ length: to - from + 1 }, (_, i) => message(from + i)), hasMore })

test('a page that reaches the read position opens at the first unread message from someone else', () => {
  const messages = [message(1), message(2), message(3, me), message(4, peer, { system: true }), message(5)]
  assert.deepEqual(unreadEntry({ messages, hasMore: true }, 2, read(2), me), { kind: 'message', id: 'm5' })
})

test('a page that does not reach the read position reads around it', () => {
  // 81 unread after m0: the newest 80 (m2…m81) do not hold m0 or m1.
  assert.deepEqual(unreadEntry(page(2, 81, true), 81, read(0), me), { kind: 'around' })
})

test('the whole history loaded is its own boundary', () => {
  assert.deepEqual(unreadEntry(page(2, 81, false), 81, read(0), me), { kind: 'message', id: 'm2' })
})

test('with no read position the count picks the message, but not past a page that goes on', () => {
  assert.deepEqual(unreadEntry(page(1, 10, true), 3, null, me), { kind: 'message', id: 'm8' })
  assert.deepEqual(unreadEntry(page(1, 10, true), 30, null, me), { kind: 'bottom' })
  assert.deepEqual(unreadEntry(page(1, 10, false), 30, null, me), { kind: 'message', id: 'm1' })
})

test('nothing unread, or nothing left after the boundary, opens at the bottom', () => {
  assert.deepEqual(unreadEntry(page(1, 10, true), 0, read(5), me), { kind: 'bottom' })
  assert.deepEqual(unreadEntry(page(1, 10, true), 2, read(10), me), { kind: 'bottom' })
  assert.deepEqual(unreadEntry({ messages: [], hasMore: false }, 2, read(1), me), { kind: 'bottom' })
})

const chatId = 'chat1'
const dialog = {
  summary: { id: chatId, version: '1:0', kind: 'direct', title: 'peer', participantUids: [me, peer], preview: '', unreadCount: 0, markedUnread: false,
    readPositions: {}, readSync: { status: 'ready' }, pinned: false, pinVersion: '', muted: false, archived: false, top: null },
  cutoff: null, participantNames: { [me]: 'me', [peer]: 'peer' }, accountUid: me
} as unknown as ReadDialog
const doc = (index: number, from = peer): FirestoreDocument => ({
  name: `${documents}/chats/${chatId}/messages/m${index}`, updateTime: { seconds: '1', nanos: 0 },
  fields: { createdAt: { timestampValue: { seconds: String(base + index), nanos: 0 } }, senderId: { stringValue: from }, text: { stringValue: `m${index}` }, type: { stringValue: 'text' }, status: { stringValue: 'sent' } }
} as unknown as FirestoreDocument)
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
function reader(answer: (query: Record<string, unknown>) => FirestoreDocument[]) {
  const asked: Record<string, unknown>[] = []
  return { asked, reader: {
    watch: (_target: unknown, _signal: AbortSignal, events: WatchEvents) => { queueMicrotask(() => { events.snapshot(new Map()); events.state('ready') }); return () => {} },
    query: async (_parent: string, query: Record<string, unknown>) => { asked.push(query); return answer(query) }
  } as unknown as FirestoreReader }
}

test('the read position finds the first unread message after it, passing over my own and hidden ones', async () => {
  // Newest first, as the reader sorts them: the boundary m5 itself, my m6, hidden m7, then m8.
  const { reader: fake, asked } = reader(() => [doc(9), doc(8), doc(7), doc(6, me), doc(5)])
  let revision = 0
  const history = new HistoryReader(dialog, fake, () => {}, () => ++revision, id => id === 'm7')
  history.start(); await tick()
  const target = await history.unreadTarget(read(5), me)
  assert.equal(target?.id, 'm8')
  const where = (asked[0] as { where: { fieldFilter: { op: string } } }).where.fieldFilter
  assert.equal(where.op, 'GREATER_THAN_OR_EQUAL')
})

test('nothing unread among the next rows gives no target', async () => {
  const { reader: fake } = reader(() => [doc(6, me), doc(5)])
  let revision = 0
  const history = new HistoryReader(dialog, fake, () => {}, () => ++revision)
  history.start(); await tick()
  assert.equal(await history.unreadTarget(read(5), me), null)
})

test('a notice of my own message finds that message by its id, and not a hidden one', async () => {
  const { reader: fake } = reader(() => [doc(4, me)])
  let revision = 0
  const history = new HistoryReader(dialog, fake, () => {}, () => ++revision)
  history.start(); await tick()
  assert.equal((await history.messageTarget('m4'))?.id, 'm4')
  const hidden = new HistoryReader(dialog, reader(() => [doc(4, me)]).reader, () => {}, () => ++revision, id => id === 'm4')
  hidden.start(); await tick()
  assert.equal(await hidden.messageTarget('m4'), null)
  const other = new HistoryReader(dialog, reader(() => [doc(3, me)]).reader, () => {}, () => ++revision)
  other.start(); await tick()
  assert.equal(await other.messageTarget('m4'), null)
})
