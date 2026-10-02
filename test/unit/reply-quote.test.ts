import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HistoryReader } from '../../src/main/accounts/history-reader'
import { ReplyContext } from '../../src/main/accounts/reply-context'
import type { FirestoreReader, WatchEvents } from '../../src/main/network/firestore-rpc'
import { documents, type FirestoreDocument, type ReadDialog } from '../../src/main/network/firestore-values'

// B46 (Telegram R-58): a reply's quote, once found, stays — through a target added beside it, a target dropped from
// its read, a reconnect — and a message still on its way quotes the same original the same way as its sent copy.
const chatId = 'chat1', me = 'me', peer = 'peer'
const dialog = {
  summary: { id: chatId, version: '1:0', kind: 'direct', title: 'peer', participantUids: [me, peer], preview: '', unreadCount: 0, markedUnread: false,
    readPositions: {}, readSync: { status: 'ready' }, pinned: false, pinVersion: '', muted: false, archived: false, top: null },
  cutoff: null, participantNames: { [me]: '나', [peer]: '상대' }, accountUid: me
} as unknown as ReadDialog
const message = (id: string, seconds: number, text: string, extra: Record<string, unknown> = {}): FirestoreDocument => ({
  name: `${documents}/chats/${chatId}/messages/${id}`, updateTime: { seconds: String(seconds), nanos: 0 },
  fields: { createdAt: { timestampValue: { seconds: String(seconds), nanos: 0 } }, senderId: { stringValue: peer }, type: { stringValue: 'text' }, text: { stringValue: text }, ...extra }
} as unknown as FirestoreDocument)
const rows = (...docs: FirestoreDocument[]): Map<string, FirestoreDocument> => new Map(docs.map(doc => [doc.name, doc]))
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

function documentsReader() {
  const watches: { ids: string[]; events: WatchEvents; stopped: boolean }[] = []
  const reader = {
    watch: (target: { documents: { documents: string[] } }, _signal: AbortSignal, events: WatchEvents) => {
      const entry = { ids: target.documents.documents.map(name => name.split('/').at(-1)!), events, stopped: false }
      watches.push(entry)
      return () => { entry.stopped = true }
    }
  } as unknown as FirestoreReader
  return { reader, watches, live: () => watches.filter(item => !item.stopped) }
}

test('a quote found once stays through a new target beside it, a dropped neighbour and a reconnect', () => {
  const { reader, watches, live } = documentsReader()
  const replies = new ReplyContext(dialog, reader, new AbortController().signal, () => {})
  replies.setTargets(['a', 'b'])
  watches[0]!.events.snapshot(rows(message('a', 10, '원문 A'), message('b', 11, '원문 B')))
  const a = replies.preview('a')
  assert.deepEqual(a, { state: 'ready', senderName: '상대', kind: 'text', text: '원문 A' })

  replies.setTargets(['a', 'b', 'c'])
  assert.deepEqual(live().map(item => item.ids), [['a', 'b'], ['c']], 'only the new target starts a read')
  assert.deepEqual(replies.preview('a'), a, 'the others keep their quote')
  assert.deepEqual(replies.preview('c'), { state: 'loading' })

  replies.setTargets(['a', 'c'])
  assert.equal(watches[0]!.stopped, true)
  assert.deepEqual(live().map(item => item.ids).sort(), [['a'], ['c']])
  assert.deepEqual(replies.preview('a'), a, 'read again on its own, it still shows what was found')

  const again = live().find(item => item.ids[0] === 'a')!
  again.events.reconnecting!()
  again.events.state('loading', { code: 'network' } as never)
  assert.deepEqual(replies.preview('a'), a, 'a reconnect does not empty it')
  again.events.snapshot(rows())
  assert.deepEqual(replies.preview('a'), { state: 'unavailable' }, 'only the read that answers can change it: deleted')
  replies.clear()
})

function historyReader(tail: FirestoreDocument[]) {
  const groups: { ids: string[]; events: WatchEvents }[] = []
  const reader = {
    watch: (target: { query?: unknown; documents?: { documents: string[] } }, _signal: AbortSignal, events: WatchEvents) => {
      if (target.documents) groups.push({ ids: target.documents.documents.map(name => name.split('/').at(-1)!), events })
      else queueMicrotask(() => { events.snapshot(rows(...tail)); events.state('ready') })
      return () => {}
    },
    query: async () => tail
  } as unknown as FirestoreReader
  return { reader, groups }
}

test('a message on its way quotes its original exactly as its sent copy does', async () => {
  const original = message('orig', 100, '안녕하세요'), sent = message('r1', 101, '네', { senderId: { stringValue: me }, replyToId: { stringValue: 'orig' } })
  // Before the server has the reply: only the original, and the device's message on its way that answers it.
  const before = historyReader([original])
  let local = ['orig']
  const waiting = new HistoryReader(dialog, before.reader, () => {}, () => 1, () => false, () => true, () => local)
  waiting.start(); await tick()
  const quoted = waiting.snapshot.replyQuotes?.orig
  assert.deepEqual(quoted, { state: 'ready', senderName: '상대', kind: 'text', text: '안녕하세요' })
  // After: the server's copy of the reply.
  const after = historyReader([original, sent])
  const shown = new HistoryReader(dialog, after.reader, () => {}, () => 1)
  shown.start(); await tick()
  assert.deepEqual(shown.snapshot.messages.find(item => item.id === 'r1')?.reply, quoted, 'the same quote, not «답장» turning into a quote')
  // An original off the loaded page is read once, for both.
  local = ['far']
  waiting.localRepliesChanged()
  assert.deepEqual(before.groups.map(group => group.ids), [['far']])
  before.groups[0]!.events.snapshot(rows(message('far', 5, '오래된 원문')))
  assert.equal(waiting.snapshot.replyQuotes?.far?.state, 'ready')
  waiting.close(); shown.close()
})
