import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HistoryReader } from '../../src/main/accounts/history-reader'
import type { FirestoreReader, WatchEvents } from '../../src/main/network/firestore-rpc'
import { documents, pageSize, type FirestoreDocument, type ReadDialog } from '../../src/main/network/firestore-values'
import type { MessagePosition } from '../../src/shared/model'

// B184 (tdesktop history_widget.cpp:5083-5085 delayedShowAt — half a page each side; :4990-5001 loadMessagesDown;
// :5203-5208 preload): a jump reads around its message, reading down goes on page by page to the newest, and a window
// that reaches the newest stays live. A fake Firestore answers the ordered cursor queries the reader sends.
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
const idOf = (doc: FirestoreDocument) => doc.name.split('/').at(-1)!
const key = (doc: FirestoreDocument): [number, string] => [Number((doc.fields.createdAt as { timestampValue: { seconds: string } }).timestampValue.seconds), idOf(doc)]
const compare = (a: [number, string], b: [number, string]) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0)
const tick = () => new Promise(resolve => setImmediate(resolve))

// The messages m001…m200, one a second — except m080 and m081, the same moment, on the jump window's edge.
function store(count = 200) {
  const docs = Array.from({ length: count }, (_, n) => message(`m${String(n + 1).padStart(3, '0')}`, n + 1 === 81 ? 80 : n + 1))
  const tails: WatchEvents[] = []
  const reader = {
    async query(_parent: string, query: { orderBy: { direction: string }[]; startAt?: { before: boolean; values: [{ timestampValue: { seconds: string } }, { referenceValue: string }] }; limit: { value: number } }) {
      const ascending = query.orderBy[0]!.direction === 'ASCENDING'
      let rows = [...docs].sort((a, b) => compare(key(a), key(b)))
      if (!ascending) rows.reverse()
      if (query.startAt) {
        const cursor: [number, string] = [Number(query.startAt.values[0].timestampValue.seconds), query.startAt.values[1].referenceValue.split('/').at(-1)!]
        rows = rows.filter(doc => { const c = compare(key(doc), cursor); return ascending ? (query.startAt!.before ? c >= 0 : c > 0) : (query.startAt!.before ? c <= 0 : c < 0) })
      }
      return rows.slice(0, query.limit.value)
    },
    watch(target: { query?: unknown; documents?: { documents: string[] } }, _signal: AbortSignal, events: WatchEvents, _max?: number, _bytes?: number, resume?: unknown) {
      // As FirestoreReader.watch: a listen with nothing to resume says «loading» as it starts (relisten, firestore-rpc.ts).
      if (target.query && !resume) events.state('loading')
      if (target.query) { tails.push(events); setImmediate(() => events.snapshot(new Map([...docs].sort((a, b) => compare(key(b), key(a))).slice(0, pageSize + 1).map(doc => [doc.name, doc])))) }
      else setImmediate(() => events.snapshot(new Map(docs.filter(doc => target.documents!.documents.includes(doc.name)).map(doc => [doc.name, doc]))))
      return () => {}
    }
  } as unknown as FirestoreReader
  return { docs, tails, reader }
}
const at = (n: number, seconds = n): MessagePosition => ({ seconds, nanoseconds: 0, id: `m${String(n).padStart(3, '0')}` })
async function opened(count = 200) {
  const world = store(count)
  let revision = 0
  const history = new HistoryReader(dialog, world.reader, () => {}, () => ++revision)
  history.start(); await tick(); await tick()
  return { ...world, history }
}
const ids = (history: HistoryReader) => history.snapshot.messages.map(item => item.id)

test('B184: a jump reads half a page each side of its message, never more of one side for less of the other', async () => {
  const { history } = await opened()
  await history.jump(at(95)); await tick()
  assert.equal(ids(history).length, pageSize, '40 before (the message among them) and 40 after')
  assert.equal(ids(history)[0], 'm056'); assert.equal(ids(history).at(-1), 'm135')
  assert.equal(history.snapshot.focusMessageId, 'm095')
  assert.equal(history.snapshot.newerAvailable, true)
  // Near the oldest: 3 before, still only 40 after — not topped up from the newer side.
  await history.jump(at(3)); await tick()
  assert.deepEqual([ids(history)[0], ids(history).at(-1), ids(history).length], ['m001', 'm043', 43])
  // Near the newest: 40 before, the 5 after — not topped up from the older side — and the window is live.
  await history.jump(at(195)); await tick(); await tick()
  assert.deepEqual([ids(history)[0], ids(history).at(-1), ids(history).length], ['m156', 'm200', 45])
  assert.equal(history.snapshot.newerAvailable, false, 'nothing more after: it reaches the newest')
  history.close()
})

test('B184: reading down goes page by page to the newest, two messages of one moment on the edge neither repeated nor lost', async () => {
  const { history } = await opened()
  await history.jump(at(40)); await tick()
  assert.equal(ids(history).at(-1), 'm080', 'the window ends on the first of the two same-moment messages')
  for (let page = 0; page < 5 && history.snapshot.newerAvailable; page++) { await history.newer(history.snapshot.after!); await tick(); await tick() }
  const all = ids(history)
  assert.equal(new Set(all).size, all.length, 'none repeated')
  assert.deepEqual(all, Array.from({ length: 200 }, (_, n) => `m${String(n + 1).padStart(3, '0')}`), 'none lost: m001…m200 in order')
  assert.equal(history.snapshot.newerAvailable, false)
  history.close()
})

test('B184: the read mark goes to the end only once the window reaches the newest', async () => {
  const { history } = await opened()
  await history.jump(at(40)); await tick()
  assert.equal(history.bottomReadTarget(history.snapshot.revision), null, 'below the window is not the newest: no read to the end')
  while (history.snapshot.newerAvailable) { await history.newer(history.snapshot.after!); await tick(); await tick() }
  assert.equal(history.bottomReadTarget(history.snapshot.revision)?.id, 'm200', 'reached the newest: read to the end')
  history.close()
})

test('B184: a window read up from the newest stays live — a new message is still added below', async () => {
  const { history, tails, docs } = await opened()
  await history.older(history.snapshot.before!); await tick(); await tick()
  assert.equal(ids(history).length, 2 * pageSize)
  docs.push(message('m201', 201))
  tails.at(-1)!.snapshot(new Map([...docs].sort((a, b) => compare(key(b), key(a))).slice(0, pageSize + 1).map(doc => [doc.name, doc])))
  await tick()
  assert.equal(ids(history).at(-1), 'm201', 'the new message is added below')
  assert.equal(ids(history)[0], `m${String(200 - 2 * pageSize + 1).padStart(3, '0')}`, 'the older rows stay')
  assert.equal(history.snapshot.newerAvailable, false)
  history.close()
})

// Phase1 (10-07): reading down from a jump, the moment the window reached the newest the screen went blank for a frame
// and jumped to the newest 80 rows. The live page it joined is a new listen, which says «loading» as it starts; the
// reader took that for a reconnect and cleared the window. No frame on the way may be empty, loading, or shorter.
test('B184: reaching the newest keeps the window — no frame is empty, loading or shorter on the way', async () => {
  const world = store()
  let revision = 0
  const frames: { status: string; count: number }[] = []
  const history = new HistoryReader(dialog, world.reader, snapshot => { frames.push({ status: snapshot.status, count: snapshot.messages.length }) }, () => ++revision)
  history.start(); await tick(); await tick()
  await history.jump(at(40)); await tick()
  frames.length = 0
  let before = history.snapshot.messages.length
  while (history.snapshot.newerAvailable) { await history.newer(history.snapshot.after!); await tick(); await tick() }
  for (const frame of frames) {
    assert.equal(frame.status, 'ready', `no loading frame: ${JSON.stringify(frames)}`)
    assert.ok(frame.count >= before, `no shorter frame: ${JSON.stringify(frames)}`)
    before = frame.count
  }
  assert.equal(ids(history)[0], 'm001', 'the rows read down from the jump stay above')
  assert.equal(ids(history).at(-1), 'm200')
  history.close()
})
