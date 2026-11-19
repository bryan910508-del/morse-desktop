import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { KeptHistories, keptHistoryLimit } from '../../src/main/accounts/kept-histories'
import { leftPlaceOf, placeOnScreen, placeToOpen, type PlaceRow } from '../../src/shared/left-place'

// B184d (review 11-06 08:1x, iOS B184d · B184e · B184g): a room opens again at the message it was left at, at the same
// distance from the composer — after a notice's message and the first unread, only when that message is in the page,
// in memory only.
const rows: PlaceRow[] = [
  { messageId: 'm1', start: 0, end: 100 }, { messageId: null, start: 100, end: 130 }, { messageId: 'm2', start: 130, end: 300 },
  { messageId: 'm3', start: 300, end: 420 }, { messageId: null, start: 420, end: 460 }
]

test('B184d: the place on screen is the lowest message row in view and how far its bottom is above the list\'s bottom', () => {
  assert.equal(placeOnScreen(rows, 200, 300, true), null, 'at the bottom: no place')
  assert.deepEqual(placeOnScreen(rows, 0, 350, false), { messageId: 'm3', distance: -70 }, 'a row cut by the bottom edge counts, below the edge')
  assert.deepEqual(placeOnScreen(rows, 0, 280, false), { messageId: 'm2', distance: -20 })
  assert.deepEqual(placeOnScreen(rows, 0, 300, false), { messageId: 'm2', distance: 0 }, 'm3 starts at the edge: not on screen')
  assert.deepEqual(placeOnScreen(rows, 100, 340, false), { messageId: 'm3', distance: 20 }, 'a date or a sending item below it is passed over')
  assert.equal(placeOnScreen([{ messageId: null, start: 0, end: 50 }], 0, 40, false), null)
})

test('B184d (c): the place opens only when its message is in the page; outside it, or deleted since, the room opens at the bottom', () => {
  const place = { messageId: 'm2', distance: 12 }
  assert.deepEqual(placeToOpen(place, ['m1', 'm2', 'm3']), place)
  assert.equal(placeToOpen(place, ['m1', 'm3']), null)
  assert.equal(placeToOpen(null, ['m2']), null)
})

test('B184d: what the window hands over is a message id and a finite distance, or nothing', () => {
  assert.deepEqual(leftPlaceOf({ messageId: 'm1', distance: 12.5 }), { messageId: 'm1', distance: 12.5 })
  assert.deepEqual(leftPlaceOf({ messageId: 'm1', distance: 1e9 }), { messageId: 'm1', distance: 100_000 })
  for (const bad of [null, undefined, 'm1', { messageId: '', distance: 0 }, { messageId: 'm1', distance: Number.NaN }, { messageId: 'm1' }, { messageId: 7, distance: 0 }, { messageId: 'x'.repeat(257), distance: 0 }])
    assert.equal(leftPlaceOf(bad), null, JSON.stringify(bad) ?? String(bad))
})

test('B184d (b): the place is kept beside the kept history in memory — a bottom leave clears it; the lock, another account and a chat leaving the list forget it', () => {
  const kept = new KeptHistories()
  kept.leave('a', { messageId: 'm1', distance: 4 })
  assert.deepEqual(kept.place('a'), { messageId: 'm1', distance: 4 })
  assert.equal(kept.take('a', 'q'), null)
  assert.deepEqual(kept.place('a'), { messageId: 'm1', distance: 4 }, 'opening the messages does not use the place up')
  kept.leave('a', null)
  assert.equal(kept.place('a'), null, 'left at the bottom: no place')
  kept.leave('a', { messageId: 'm1', distance: 4 }); kept.leave('b', { messageId: 'm2', distance: 0 })
  kept.prune(chatId => chatId === 'b')
  assert.deepEqual([kept.place('a'), kept.place('b')?.messageId], [null, 'm2'])
  kept.clear()
  assert.equal(kept.place('b'), null)
  for (let n = 0; n <= keptHistoryLimit; n++) kept.leave(`c${n}`, { messageId: 'm', distance: 0 })
  assert.equal(kept.place('c0'), null, 'bounded like the kept histories')
  const source = readFileSync('src/main/accounts/kept-histories.ts', 'utf8')
  assert.doesNotMatch(source, /from 'node:fs'|from 'fs'|writeFile|electron-store/, 'never on disk')
  const session = readFileSync('src/main/accounts/session.ts', 'utf8')
  assert.match(session, /private leavePlace\(chatId: string, place: LeftPlace \| null\): void \{ if \(!this\.closed && !this\.locked && this\.index\.has\(chatId\)\) this\.keptHistories\.leave\(chatId, place\) \}/)
  assert.match(session, /leftPlace\(chatId: string\): LeftPlace \| null \{ return this\.closed \|\| this\.locked \? null : this\.keptHistories\.place\(chatId\) \}/)
  assert.match(session, /forgetKeptHistories\(\): void \{ this\.keptHistories\.clear\(\) \}/)
})

test('B184d (a): the order — a notice\'s message, the first unread, the left place, the bottom; the room hands over its place as it goes', () => {
  const widget = readFileSync('src/renderer/src/history/history-widget.tsx', 'utf8')
  const apply = widget.slice(widget.indexOf('  const applyHistory = '), widget.indexOf('  const openAt = '))
  assert.ok(apply.indexOf("ui().entryMessage?.chatId === chatId") < apply.indexOf('placeToOpen('), 'a notice\'s message first')
  assert.match(apply, /const place = entry\.kind === 'message' \? null : placeToOpen\(leftPlace\.current, next\.messages\.map\(message => message\.id\)\)\n {6}if \(place\) openAtPlace\(place\); else openAt\(entry\.kind === 'message' \? entry\.id : null\)/, 'unread before the place, then the bottom')
  assert.ok(apply.indexOf("entry.kind === 'around'") < apply.indexOf('placeToOpen('), 'an unread boundary outside the page is read around first')
  const open = widget.slice(widget.indexOf('    leftPlace.current = null; holdPlace.current = null; placeNow.current = null'))
  assert.ok(open.indexOf('window.morse.leftPlace(') < open.indexOf('window.morse.history(accountUid, chatId)'), 'the place is known before the first page')
  assert.match(widget, /window\.morse\.closeHistory\(accountUid, chatId, bottom\.current \? null : placeNow\.current\)/, 'left at the bottom: no place')
  assert.match(widget, /placeNow\.current = placeOnScreen\(/, 'counted on every scroll, as tdesktop countScrollState')
  assert.match(widget, /const release = \(\): void => \{ holdStart\.current = null; holdPlace\.current = null \}/, 'held until the person scrolls')
  assert.match(widget, /if \(held && !entries\.some\(entry => entry\.key === held\.messageId\)\) \{ holdPlace\.current = null; placeNow\.current = null; bottom\.current = true; pendingScroll\.current = 'bottom' \}/, 'its message deleted: the bottom')
})
