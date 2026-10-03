import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HistoryReader } from '../../src/main/accounts/history-reader'
import { KeptHistories, keptHistoryLimit, type KeptHistory } from '../../src/main/accounts/kept-histories'
import type { FirestoreReader, WatchEvents, WatchResume } from '../../src/main/network/firestore-rpc'
import { documents, type FirestoreDocument, type ReadDialog } from '../../src/main/network/firestore-values'

// B87 (Telegram Data::Session keeps a History once its chat is closed — data_session.cpp:1681-1687 — and
// HistoryWidget::showHistory draws it at once when it isReadyFor, history_widget.cpp:3090): a chat opened again shows
// the messages it had straight away, and its listen asks the server only for what changed since.
const chatId = 'chat1', me = 'me', peer = 'peer'
const dialog = {
  summary: { id: chatId, version: '1:0', kind: 'direct', title: 'peer', participantUids: [me, peer], preview: '', unreadCount: 0, markedUnread: false,
    readPositions: {}, readSync: { status: 'ready' }, pinned: false, pinVersion: '', muted: false, archived: false, top: null },
  cutoff: null, participantNames: { [me]: '나', [peer]: '상대' }, accountUid: me
} as unknown as ReadDialog
const message = (id: string, seconds: number): FirestoreDocument => ({
  name: `${documents}/chats/${chatId}/messages/${id}`, updateTime: { seconds: String(seconds), nanos: 0 },
  fields: { createdAt: { timestampValue: { seconds: String(seconds), nanos: 0 } }, senderId: { stringValue: peer }, type: { stringValue: 'text' }, text: { stringValue: id } }
} as unknown as FirestoreDocument)
const tick = () => new Promise(resolve => setImmediate(resolve))
const kept = (query: string, ...docs: FirestoreDocument[]): KeptHistory => ({ query, documents: docs, token: Buffer.from('t1') })

test('the chats opened last are kept, the oldest giving way, and each is handed over once and only to its own query', () => {
  const histories = new KeptHistories()
  for (let n = 0; n <= keptHistoryLimit; n++) histories.keep(`c${n}`, kept('q'))
  assert.equal(histories.size, keptHistoryLimit)
  assert.equal(histories.take('c0', 'q'), null, 'the oldest went')
  histories.keep('c1', kept('q'))
  histories.keep('extra', kept('q'))
  assert.ok(histories.take('c1', 'q'), 'opened again, so kept over c2')
  assert.equal(histories.take('c1', 'q'), null, 'handed over once')
  assert.equal(histories.take('c2', 'q'), null, 'c2 gave way')
  histories.keep('c3', kept('q'))
  assert.equal(histories.take('c3', 'another'), null, 'a cleared chat asks another query: nothing from the old one')
  histories.keep('a', kept('q')); histories.keep('b', kept('q'))
  histories.prune(id => id !== 'a')
  assert.equal(histories.take('a', 'q'), null, 'a chat left or deleted keeps nothing')
  histories.clear()
  assert.equal(histories.size, 0)
})

test('a chat opened again shows what it had at once and listens from its resume token', async () => {
  const watched: { events: WatchEvents; resume?: WatchResume }[] = []
  const reader = {
    watch: (_target: unknown, _signal: AbortSignal, events: WatchEvents, _max: number, _bytes?: number, resume?: WatchResume) => { watched.push({ events, resume }); return () => {} }
  } as unknown as FirestoreReader
  const shown: string[][] = []
  let revision = 0, asked = ''
  const old = [message('m2', 20), message('m1', 10)]
  const history = new HistoryReader(dialog, reader, snapshot => shown.push(snapshot.messages.map(item => item.id)), () => ++revision,
    () => false, () => true, () => [], query => { asked = query; return kept(query, ...old) })
  history.start()
  assert.equal(history.snapshot.status, 'ready', 'no spinner: the kept messages are there before the server answers')
  assert.deepEqual(history.snapshot.messages.map(item => item.id), ['m1', 'm2'])
  assert.ok(asked.includes('"messages"'), 'kept by the history query')
  assert.equal(String(watched[0]!.resume?.token), 't1')
  assert.deepEqual([...watched[0]!.resume!.documents.keys()].map(name => name.split('/').at(-1)), ['m2', 'm1'])
  assert.equal(history.keep(), null, 'nothing to keep until the server confirmed a snapshot with its token')
  watched[0]!.events.snapshot(new Map([...old, message('m3', 30)].map(doc => [doc.name, doc])))
  watched[0]!.events.state('ready')
  watched[0]!.events.resumeToken!(Buffer.from('t2'))
  await tick()
  assert.deepEqual(history.snapshot.messages.map(item => item.id), ['m1', 'm2', 'm3'])
  const next = history.keep()
  assert.equal(String(next?.token), 't2')
  assert.deepEqual(next?.documents.map(doc => doc.name.split('/').at(-1)), ['m3', 'm2', 'm1'])
  history.close()
  assert.equal(history.keep(), null, 'a closed history keeps nothing more')
})

test('a reconnect forgets the token, so a chat closed meanwhile is not kept with a stale one', () => {
  const watched: WatchEvents[] = []
  const reader = { watch: (_t: unknown, _s: AbortSignal, events: WatchEvents) => { watched.push(events); return () => {} } } as unknown as FirestoreReader
  const history = new HistoryReader(dialog, reader, () => {}, () => 1)
  history.start()
  watched[0]!.snapshot(new Map([[message('m1', 10).name, message('m1', 10)]])); watched[0]!.state('ready'); watched[0]!.resumeToken!('t')
  assert.ok(history.keep())
  watched[0]!.state('loading')
  assert.equal(history.keep(), null)
})
