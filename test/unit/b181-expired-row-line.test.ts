import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ExpiredRowLines, type HiddenRowLine } from '../../src/main/accounts/hidden-row-lines'
import { expiredTop } from '../../src/main/accounts/chat-list-tops'
import type { DialogSummary, MessagePosition } from '../../src/shared/model'

// B181 ③: a row whose message passed its deleteAt, with no open history to give the next one, asks the room for its
// newest message left — tdesktop History::requestChatListMessage (history.cpp:227-235; data_histories.cpp:1019-1030)
// after checkTTLs. Before, the row showed no line until the server wrote the room again.
const at = (seconds: number, id = 'c1'): MessagePosition => ({ seconds, nanoseconds: 0, id })
const row = (): DialogSummary => ({ id: 'c1', preview: '사라질 글', top: at(100), topMessageId: 'm9' } as unknown as DialogSummary)
const line = (id: string, seconds: number, expiresAt: number | null = null): HiddenRowLine => ({ preview: `글 ${id}`, position: at(seconds, id), fromMe: false, messageId: id, expiresAt })
const tick = () => new Promise(resolve => setImmediate(resolve))
function setup(lines: HiddenRowLine[] | Error, hidden: string[] = []) {
  let now = 2_000_000, reads = 0, changed = 0
  const rows = new ExpiredRowLines({ has: (_c, id) => hidden.includes(id), count: () => hidden.length },
    async () => { reads++; if (lines instanceof Error) throw lines; return lines }, () => { changed++ }, () => now)
  return { rows, reads: () => reads, changed: () => changed, advance: (ms: number) => { now += ms } }
}
// The list's rebuild: expiredTop first (no open history → no line), then the room is asked.
function rebuild(rows: ExpiredRowLines): { summary: DialogSummary; next: number | null } {
  const summary = row(), expiring = summary.topMessageId!
  assert.equal(expiredTop(summary, 1, 2, null), true)
  assert.equal(summary.topMessageId, undefined, 'no line from an open history')
  return { summary, next: rows.apply(summary, expiring) }
}

test('B181 ③: the room is read once, and the row then shows its newest message left', async () => {
  const world = setup([line('m8', 90), line('m7', 80)])
  assert.equal(rebuild(world.rows).summary.preview, '', 'until the read answers: no line, as before')
  rebuild(world.rows)
  await tick()
  assert.equal(world.reads(), 1, 'one read, not one per look')
  assert.equal(world.changed(), 1)
  const { summary } = rebuild(world.rows)
  assert.equal(summary.preview, '글 m8')
  assert.equal(summary.topMessageId, 'm8')
  assert.deepEqual(summary.top, at(90, 'c1'), 'the row goes to that message\'s time, under its own id')
})

test('B181 ③: a message deleted for me or already expired is passed over; a line that expires in turn is read again', async () => {
  const world = setup([line('m8', 90), line('m7', 80, 2_000_500), line('m6', 70)], ['m8'])
  rebuild(world.rows); await tick()
  const first = rebuild(world.rows)
  assert.equal(first.summary.preview, '글 m7')
  assert.equal(first.next, 2_000_500, 'its own deleteAt, for the list to look again then')
  world.advance(1_000)
  rebuild(world.rows); await tick()
  assert.equal(world.reads(), 2)
  assert.equal(rebuild(world.rows).summary.preview, '글 m6')
})

test('B181 ③: nothing left shows no line; a read that fails is not asked again for 30 s', async () => {
  const empty = setup([])
  rebuild(empty.rows); await tick()
  assert.equal(rebuild(empty.rows).summary.preview, '')
  const failing = setup(new Error('offline'))
  rebuild(failing.rows); await tick()
  rebuild(failing.rows); await tick()
  assert.equal(failing.reads(), 1)
  failing.advance(31_000)
  rebuild(failing.rows); await tick()
  assert.equal(failing.reads(), 2)
})
