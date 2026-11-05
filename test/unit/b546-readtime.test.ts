import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { HistoryReader } from '../../src/main/accounts/history-reader'
import { FirestoreReader, type ReadCredentials, type WatchEvents, type WatchReadTime, type WatchResume } from '../../src/main/network/firestore-rpc'
import { documents, pageSize, type FirestoreDocument, type ReadDialog } from '../../src/main/network/firestore-values'

// B546 ② (reports/desktop/2026-11-04-b546-plan.md §3 stage 2, §6 test 10): a page query hands back the time the server
// read it at; the group watch over that page listens from that time (addTarget.readTime) with the page's documents as
// its first snapshot, so the server sends only what changed after it. A server that will not start from that time is
// listened to again from nothing, without failing the history.
const chatId = 'chat1', me = 'me', peer = 'peer'
const dialog = {
  summary: { id: chatId, version: '1:0', kind: 'direct', title: 'peer', participantUids: [me, peer], preview: '', unreadCount: 0, markedUnread: false,
    readPositions: {}, readSync: { status: 'ready' }, pinned: false, pinVersion: '', muted: false, archived: false, top: null },
  cutoff: null, participantNames: { [me]: '나', [peer]: '상대' }, accountUid: me
} as unknown as ReadDialog
const message = (n: number, text = `m${n}`): FirestoreDocument => ({
  name: `${documents}/chats/${chatId}/messages/m${String(n).padStart(4, '0')}`, updateTime: { seconds: String(n), nanos: 0 },
  fields: { createdAt: { timestampValue: { seconds: String(n), nanos: 0 } }, senderId: { stringValue: peer }, type: { stringValue: 'text' }, text: { stringValue: text } }
} as unknown as FirestoreDocument)
const seconds = (doc: FirestoreDocument) => Number((doc.fields.createdAt as { timestampValue: { seconds: string } }).timestampValue.seconds)
const tick = () => new Promise(resolve => setImmediate(resolve))
const time = (s: number): WatchReadTime => ({ seconds: String(s), nanos: 0 })

// ---- the reader's side: runQuery's readTime, addTarget.readTime, and the way back to reading from nothing.
class FakeStream extends EventEmitter {
  written: { addTarget?: { resumeToken?: unknown; readTime?: unknown } }[] = []
  write(value: { addTarget?: { resumeToken?: unknown; readTime?: unknown } }): boolean { this.written.push(value); return true }
  cancel(): void {}
}
const credentials: ReadCredentials = { signal: new AbortController().signal, authorize: async () => ({ idToken: 'id', appCheckToken: 'check', expiresAt: Date.now() + 3600000 }) }
function rpcReader() {
  const reader = new FirestoreReader(credentials), listens: FakeStream[] = [], queries: FakeStream[] = []
  ;(reader as unknown as { client: unknown }).client = {
    listen: () => { const stream = new FakeStream(); listens.push(stream); return stream },
    runQuery: () => { const stream = new FakeStream(); queries.push(stream); return stream },
    close: () => {}, getChannel: () => ({ getConnectivityState: () => 2 })
  }
  return { reader, listens, queries }
}
const docTarget = (names: string[]) => ({ documents: { documents: names } })
const seed = (docs: FirestoreDocument[], at: WatchReadTime): WatchResume => ({ readTime: at, documents: new Map(docs.map(doc => [doc.name, doc])) })

test('B546 ⑩ query: the read time of the result reaches a reader that asks for it, and no other', async () => {
  const { reader, queries } = rpcReader()
  let heard: WatchReadTime | undefined
  const asked = reader.query(`${documents}/chats/${chatId}`, {}, new AbortController().signal, at => { heard = at })
  const plain = reader.query(`${documents}/chats/${chatId}`, {}, new AbortController().signal)
  await tick(); await tick()
  for (const stream of queries) {
    stream.emit('data', { document: message(1), readTime: time(100) })
    stream.emit('data', { readTime: time(101) })
    stream.emit('end')
  }
  assert.equal((await asked).length, 1)
  assert.deepEqual(heard, time(101), 'the last read time the server sent')
  assert.equal((await plain).length, 1, 'a reader that does not ask reads as before')
})

test('B546 ⑩ watch: a listen from a read time sends readTime, not a token, and starts from the page it was given', async () => {
  const { reader, listens } = rpcReader()
  const page = [message(1), message(2), message(3)], snapshots: Map<string, FirestoreDocument>[] = [], states: string[] = []
  const stop = reader.watch(docTarget(page.map(doc => doc.name)), new AbortController().signal, {
    snapshot: docs => snapshots.push(docs), state: state => states.push(state), reconnecting: () => states.push('reconnecting')
  }, 3, undefined, seed(page, time(100)))
  await tick()
  const added = listens[0]!.written[0]!.addTarget!
  assert.deepEqual(added.readTime, time(100))
  assert.equal(added.resumeToken, undefined)
  assert.ok(!states.includes('loading'), 'the rows stay while it starts')
  listens[0]!.emit('data', { targetChange: { targetChangeType: 'CURRENT', targetIds: [1] } })
  listens[0]!.emit('data', { targetChange: { targetChangeType: 'NO_CHANGE', targetIds: [], readTime: time(110) } })
  assert.deepEqual([...snapshots.at(-1)!.keys()], page.map(doc => doc.name), 'the page is the first snapshot, nothing read again')
  const edited = message(2, '고친 글')
  listens[0]!.emit('data', { documentChange: { document: edited, targetIds: [1] } })
  listens[0]!.emit('data', { targetChange: { targetChangeType: 'NO_CHANGE', targetIds: [], readTime: time(120) } })
  const last = snapshots.at(-1)!
  assert.equal((last.get(edited.name)!.fields.text as { stringValue: string }).stringValue, '고친 글', 'only what changed comes')
  assert.equal(last.get(page[0]!.name), page[0], 'the others are the very documents it started from')
  stop()
})

test('B546 ⑩ fallback: a read time the server refuses before it is current reads everything again, without failing', async () => {
  const { reader, listens } = rpcReader()
  const page = [message(1), message(2)], snapshots: Map<string, FirestoreDocument>[] = [], states: string[] = [], refused: string[] = []
  const stop = reader.watch(docTarget(page.map(doc => doc.name)), new AbortController().signal, {
    snapshot: docs => snapshots.push(docs), state: state => states.push(state), reconnecting: () => states.push('reconnecting'),
    readTimeRefused: reason => refused.push(reason.code)
  }, 2, undefined, seed(page, time(1)))
  await tick()
  // Too old: the server removes the target with FAILED_PRECONDITION, which would otherwise end the reader ('index').
  listens[0]!.emit('data', { targetChange: { targetChangeType: 'REMOVE', targetIds: [1], cause: { code: 9, message: 'too old' } } })
  await tick(); await tick()
  assert.deepEqual(refused, ['index'])
  assert.ok(!states.includes('error'), 'not a failure of the history')
  assert.equal(listens.length, 2, 'listened again at once')
  assert.equal(listens[1]!.written[0]!.addTarget!.readTime, undefined, 'from nothing')
  listens[1]!.emit('data', { documentChange: { document: page[0], targetIds: [1] } })
  listens[1]!.emit('data', { targetChange: { targetChangeType: 'CURRENT', targetIds: [1] } })
  listens[1]!.emit('data', { targetChange: { targetChangeType: 'NO_CHANGE', targetIds: [], readTime: time(200) } })
  assert.deepEqual([...snapshots.at(-1)!.keys()], [page[0]!.name], 'the full read decides: the second document is gone')
  // Once a listen is current, a refusal is what it always was.
  listens[1]!.emit('data', { targetChange: { targetChangeType: 'REMOVE', targetIds: [1], cause: { code: 9 } } })
  assert.equal(states.at(-1), 'error')
  assert.deepEqual(refused, ['index'], 'told only once')
  stop()
})

// ---- the history's side: which read time each group listens from.
interface Watch { names: string[]; events: WatchEvents; stopped: boolean; resume?: WatchResume }
function store(count: number, stamped = true) {
  const docs = new Map(Array.from({ length: count }, (_, n) => message(n + 1)).map(doc => [doc.name, doc]))
  const newest = () => [...docs.values()].sort((a, b) => seconds(b) - seconds(a))
  const watches: Watch[] = [], tails: WatchEvents[] = []
  let clock = 1000
  const reader = {
    async query(_parent: string, query: { orderBy: { direction: string }[]; startAt?: { before: boolean; values: [{ timestampValue: { seconds: string } }] }; limit: { value: number } },
      _signal: AbortSignal, readAt?: (at: WatchReadTime) => void) {
      const ascending = query.orderBy[0]!.direction === 'ASCENDING'
      let rows = newest()
      if (ascending) rows.reverse()
      if (query.startAt) {
        const at = Number(query.startAt.values[0].timestampValue.seconds), before = query.startAt.before
        rows = rows.filter(doc => { const c = seconds(doc) - at; return ascending ? (before ? c >= 0 : c > 0) : (before ? c <= 0 : c < 0) })
      }
      if (stamped) readAt?.(time(++clock))
      return rows.slice(0, query.limit.value)
    },
    watch(target: { query?: unknown; documents?: { documents: string[] } }, _signal: AbortSignal, events: WatchEvents, _max?: number, _bytes?: number, resume?: WatchResume) {
      if (target.query) {
        if (!resume) events.state('loading')
        tails.push(events)
        setImmediate(() => events.snapshot(new Map(newest().slice(0, pageSize + 1).map(doc => [doc.name, doc])), stamped ? time(++clock) : undefined))
        return () => {}
      }
      const watch: Watch = { names: [...target.documents!.documents], events, stopped: false, resume }
      watches.push(watch)
      return () => { watch.stopped = true }
    }
  } as unknown as FirestoreReader
  return { docs, newest, watches, tails, reader, now: () => clock, next: () => time(++clock) }
}
async function opened(stamped = true) {
  const world = store(700, stamped)
  let revision = 0
  const history = new HistoryReader(dialog, world.reader, () => {}, () => ++revision)
  history.start(); await tick(); await tick()
  const older = async () => { await history.older(history.snapshot.before!); await tick(); await tick() }
  return { ...world, history, older }
}
const text = (history: HistoryReader, n: number) => history.snapshot.messages.find(item => item.id === `m${String(n).padStart(4, '0')}`)?.text

test('B546 ⑩ history: a page\'s group listens from the page query\'s read time, with the page as its first snapshot', async () => {
  const { history, watches, older, now } = await opened()
  await older()
  const group = watches[0]!
  assert.deepEqual(group.resume?.readTime, time(now()), 'the time the page was read at')
  assert.deepEqual([...group.resume!.documents.keys()].sort(), [...group.names].sort(), 'every row of the group, as the page had it')
  // The server then sends one changed document: that row changes, the rest stay as they are.
  const [first, second] = group.names.slice(0, 2)
  const firstN = Number(first!.slice(-4)), secondN = Number(second!.slice(-4))
  const rows = new Map(group.resume!.documents)
  rows.set(first!, message(firstN, '고친 글'))
  group.events.snapshot(rows, time(now() + 5))
  assert.equal(text(history, firstN), '고친 글')
  assert.equal(text(history, secondN), `m${secondN}`)
  history.close()
})

test('B546 ⑩ history: rows that left the live page listen from the oldest time any of them was known at', async () => {
  const { history, watches, tails, docs, newest, older, next } = await opened()
  await older()
  const tailAt = next()
  const arrived = message(701); docs.set(arrived.name, arrived)
  tails.at(-1)!.snapshot(new Map(newest().slice(0, pageSize + 1).map(doc => [doc.name, doc])), tailAt)
  await tick()
  const overflow = watches.at(-1)!
  assert.equal(overflow.names.length, 1)
  assert.deepEqual(overflow.resume?.readTime, tailAt, 'the live snapshot it was last in')
  // The open group answers at a later time; the next row joins it, and the group listens again from the older of the two.
  const groupAt = next()
  overflow.events.snapshot(new Map(overflow.resume!.documents), groupAt)
  const laterAt = next()
  const again = message(702); docs.set(again.name, again)
  tails.at(-1)!.snapshot(new Map(newest().slice(0, pageSize + 1).map(doc => [doc.name, doc])), laterAt)
  await tick()
  const joined = watches.at(-1)!
  assert.equal(joined.names.length, 2)
  assert.deepEqual(joined.resume?.readTime, groupAt, 'the oldest of the times its rows were known at')
  history.close()
})

test('B546 ⑩ history: rows read without a read time are read again in full, as in stage one', async () => {
  const { history, watches, older } = await opened(false)
  await older()
  assert.equal(watches[0]!.resume, undefined)
  history.close()
})

test('B546 ⑩ history: a newer copy of a row starts with no read time of its own, so its group reads in full', async () => {
  const { history, watches, tails, docs, newest, older, next } = await opened()
  await older()
  const arrived = message(701); docs.set(arrived.name, arrived)
  tails.at(-1)!.snapshot(new Map(newest().slice(0, pageSize + 1).map(doc => [doc.name, doc])), next())
  await tick()
  const overflow = watches.at(-1)!, name = overflow.names[0]!
  // The group's copy of its row comes without a boundary time: nothing says when that copy was current.
  overflow.events.snapshot(new Map([[name, message(Number(name.slice(-4)), '고친 글')]]))
  const again = message(702); docs.set(again.name, again)
  tails.at(-1)!.snapshot(new Map(newest().slice(0, pageSize + 1).map(doc => [doc.name, doc])), next())
  await tick()
  const joined = watches.at(-1)!
  assert.equal(joined.names.length, 2)
  assert.equal(joined.resume, undefined, 'read again from nothing')
  assert.equal(watches.slice(0, -2).every(watch => !watch.stopped), true, 'the page group goes on')
  history.close()
})
