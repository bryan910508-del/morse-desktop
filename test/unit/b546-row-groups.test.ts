import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HistoryReader } from '../../src/main/accounts/history-reader'
import type { FirestoreReader, WatchEvents } from '../../src/main/network/firestore-rpc'
import { documents, pageSize, type FirestoreDocument, type ReadDialog } from '../../src/main/network/firestore-values'
import type { MessagePosition } from '../../src/shared/model'

// B546 (reports/desktop/2026-11-04-b546-plan.md §6): the older rows' document watches change only by what changed — a
// page read starts one watch over its own rows, a group no row is left to ends, a message arriving below costs one small
// group — and every held row still hears of its edit or deletion. Before, every change ended all of them and read every
// older row again (up to 320 documents a page, Phase1 11-03 20:01: 4–5.6 thousand a minute).
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
const idOf = (doc: FirestoreDocument) => doc.name.split('/').at(-1)!
const tick = () => new Promise(resolve => setImmediate(resolve))
interface Watch { names: string[]; events: WatchEvents; stopped: boolean }

function store(count: number) {
  const docs = new Map(Array.from({ length: count }, (_, n) => message(n + 1)).map(doc => [doc.name, doc]))
  const newest = () => [...docs.values()].sort((a, b) => seconds(b) - seconds(a))
  const watches: Watch[] = [], tails: WatchEvents[] = []
  const reader = {
    // As b184-jump-window.test.ts: the ordered cursor queries the reader sends (one message a second, so the time decides).
    async query(_parent: string, query: { orderBy: { direction: string }[]; startAt?: { before: boolean; values: [{ timestampValue: { seconds: string } }] }; limit: { value: number } }) {
      const ascending = query.orderBy[0]!.direction === 'ASCENDING'
      let rows = newest()
      if (ascending) rows.reverse()
      if (query.startAt) {
        const at = Number(query.startAt.values[0].timestampValue.seconds), before = query.startAt.before
        rows = rows.filter(doc => { const c = seconds(doc) - at; return ascending ? (before ? c >= 0 : c > 0) : (before ? c <= 0 : c < 0) })
      }
      return rows.slice(0, query.limit.value)
    },
    watch(target: { query?: unknown; documents?: { documents: string[] } }, _signal: AbortSignal, events: WatchEvents, _max?: number, _bytes?: number, resume?: unknown) {
      if (target.query) {
        if (!resume) events.state('loading')
        tails.push(events)
        setImmediate(() => events.snapshot(new Map(newest().slice(0, pageSize + 1).map(doc => [doc.name, doc]))))
        return () => {}
      }
      const watch: Watch = { names: [...target.documents!.documents], events, stopped: false }
      watches.push(watch)
      setImmediate(() => { if (!watch.stopped) events.snapshot(new Map(watch.names.flatMap(name => docs.has(name) ? [[name, docs.get(name)!]] : []))) })
      return () => { watch.stopped = true }
    }
  } as unknown as FirestoreReader
  return { docs, newest, watches, tails, reader }
}
async function opened(count = 700) {
  const world = store(count)
  let revision = 0
  const history = new HistoryReader(dialog, world.reader, () => {}, () => ++revision)
  history.start(); await tick(); await tick()
  const older = async () => { await history.older(history.snapshot.before!); await tick(); await tick() }
  return { ...world, history, older }
}
const live = (watches: Watch[]) => watches.filter(watch => !watch.stopped)
const text = (history: HistoryReader, n: number) => history.snapshot.messages.find(item => item.id === `m${String(n).padStart(4, '0')}`)?.text

test('B546 ①: a page read starts one watch over that page; the watches before it go on', async () => {
  const { history, watches, older } = await opened()
  await older()
  assert.equal(watches.length, 1)
  assert.equal(watches[0]!.names.length, pageSize, 'the older page, not the live page')
  await older()
  assert.equal(watches.length, 2)
  assert.equal(watches[0]!.stopped, false, 'the first page\'s watch is not read again')
  assert.equal(new Set([...watches[0]!.names, ...watches[1]!.names]).size, 2 * pageSize, 'no row in two watches')
  history.close()
})

test('B546 ②: past the window\'s limit only a group no row is left to ends, and only the new page is watched', async () => {
  const { history, watches, older } = await opened()
  for (let n = 0; n < 4; n++) await older()
  // 80 live + 4 × 80 older = 400 > 320: the live page leaves, the four older pages stay as they are.
  assert.deepEqual([watches.length, live(watches).length], [4, 4])
  await older()
  assert.equal(watches.length, 5, 'one new watch: the fifth page')
  assert.equal(watches[0]!.stopped, true, 'the newest older page left the window')
  assert.deepEqual(watches.slice(1).map(watch => watch.stopped), [false, false, false, false])
  history.close()
})

test('B546 ③: an ended group\'s late answer does not bring back a row the window let go', async () => {
  const { history, watches, older, docs } = await opened()
  for (let n = 0; n < 5; n++) await older()
  const gone = watches[0]!
  assert.equal(gone.stopped, true)
  const before = history.snapshot.messages.length
  gone.events.snapshot(new Map(gone.names.map(name => [name, docs.get(name)!])))
  assert.equal(history.snapshot.messages.length, before)
  assert.equal(text(history, 700 - pageSize - 1), undefined, 'still out of the window')
  history.close()
})

test('B546 ④: a message arriving below while older pages are held reads one small group, not every older row', async () => {
  const { history, watches, tails, docs, newest, older } = await opened()
  await older(); await older()
  assert.deepEqual([watches.length, live(watches).length], [2, 2])
  const next = message(701); docs.set(next.name, next)
  tails.at(-1)!.snapshot(new Map(newest().slice(0, pageSize + 1).map(doc => [doc.name, doc])))
  await tick()
  assert.deepEqual(watches.slice(0, 2).map(watch => watch.stopped), [false, false], 'the page groups go on')
  assert.equal(watches.length, 3)
  assert.equal(watches[2]!.names.length, 1, 'the one row that left the live page')
  const again = message(702); docs.set(again.name, again)
  tails.at(-1)!.snapshot(new Map(newest().slice(0, pageSize + 1).map(doc => [doc.name, doc])))
  await tick()
  assert.equal(watches[2]!.stopped, true, 'the open group takes the next one in')
  assert.equal(watches[3]!.names.length, 2)
  assert.deepEqual(watches.slice(0, 2).map(watch => watch.stopped), [false, false])
  history.close()
})

test('B546 ⑤ ⑥: an older row out of sight hears of its edit and its deletion; the rest of its group stays', async () => {
  const { history, watches, docs, older } = await opened()
  await older()
  const group = watches[0]!, [first, second] = group.names.slice(0, 2).map(name => Number(name.slice(-4)))
  const answer = (change: (rows: Map<string, FirestoreDocument>) => void) => {
    const rows = new Map(group.names.map(name => [name, docs.get(name)!])); change(rows); group.events.snapshot(rows)
  }
  answer(rows => rows.set(docs.get(group.names[0]!)!.name, message(first!, '고친 글')))
  assert.equal(text(history, first!), '고친 글')
  answer(rows => rows.delete(group.names[0]!))
  assert.equal(text(history, first!), undefined, 'gone at CURRENT: deleted')
  assert.equal(text(history, second!), `m${second}`, 'the others of the group stay')
  history.close()
})

test('B546 ⑦: one group listening again leaves the others alone', async () => {
  const { history, watches, older } = await opened()
  await older(); await older()
  watches[0]!.events.reconnecting?.()
  assert.deepEqual([watches.length, watches.map(watch => watch.stopped)], [2, [false, false]])
  history.close()
})

test('B546 ⑧: a jump and closing end every group, as before', async () => {
  const { history, watches, older } = await opened()
  await older(); await older()
  await history.jump({ seconds: 300, nanoseconds: 0, id: 'm0300' } as MessagePosition); await tick()
  assert.deepEqual(watches.slice(0, 2).map(watch => watch.stopped), [true, true])
  history.close()
  assert.equal(live(watches).length, 0)
})

test('B546 ⑨: a reaction from the socket still shows on an older row while the groups change', async () => {
  const { history, watches, older } = await opened()
  await older()
  const id = idOf({ name: watches[0]!.names[5]! } as FirestoreDocument)
  history.reactionUpdated(id, { '👍': [peer] }, 1)
  await older()
  assert.equal(history.snapshot.messages.find(item => item.id === id)?.reactions.length, 1)
  history.close()
})
