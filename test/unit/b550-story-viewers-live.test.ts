import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { StoryViewRecords } from '../../src/main/accounts/story-view-records'
import type { FirestoreReader, ReadCredentials, WatchEvents } from '../../src/main/network/firestore-rpc'
import { documents, type FirestoreDocument } from '../../src/main/network/firestore-values'
import type { StoryViewRecordsResult } from '../../src/shared/story-view-records'

// B550 (contracts/B550-story-viewers-live.md §3 · §7): the own story's counts are listened to while it is shown, and its
// view records only while the viewer list is open, so a new viewer or reaction joins the open list; closing ends it.
const me = 'Ab3dEf6hIj9kLm2nOp5qRs8tUv1w'
const story = `${documents}/users/${me}/publicStories/s1`, statsPath = `${documents}/users/${me}/storyStats/s1`
const iso = (ms: number) => ({ seconds: String(Math.floor(ms / 1000)), nanos: (ms % 1000) * 1_000_000 })
const storyDoc = { name: story, updateTime: { seconds: '1793926800', nanos: 5 }, fields: { authorId: { stringValue: me }, createdAt: { timestampValue: iso(Date.now() - 60_000) }, expiresAt: { timestampValue: iso(Date.now() + 3_600_000) }, mediaType: { stringValue: 'image' } } } as unknown as FirestoreDocument
const version = '1793926800:5'
const stats = (viewers: number) => ({ name: statsPath, fields: { viewCount: { integerValue: String(viewers) }, reactionCount: { integerValue: '0' }, forwardCount: { integerValue: '0' }, repostCount: { integerValue: '0' } } } as unknown as FirestoreDocument)
const view = (uid: string, at: number, reaction?: string) => ({ name: `${story}/views/${uid}`, fields: { viewedAt: { timestampValue: iso(at) }, ...(reaction ? { reaction: { stringValue: reaction } } : {}) } } as unknown as FirestoreDocument)
const tick = () => new Promise(resolve => setImmediate(resolve))
const request = { id: '3f1c2b4a-5d6e-4f70-8a9b-0c1d2e3f4a5b', requestId: 'req1', storyId: 's1', privacy: 'everyone' as const, version }

function setup() {
  const watches: { target: Record<string, unknown>; events: WatchEvents; max: number; signal: AbortSignal; stopped: boolean }[] = []
  const reader = {
    getDocument: async (path: string) => path === story ? storyDoc : null,
    watch: (target: Record<string, unknown>, signal: AbortSignal, events: WatchEvents, max: number) => {
      const entry = { target, events, max, signal, stopped: false }; watches.push(entry); return () => { entry.stopped = true }
    },
    close: () => {}
  } as unknown as FirestoreReader
  const auth = { signal: new AbortController().signal, authorize: async () => ({}) } as unknown as ReadCredentials
  const changes: StoryViewRecordsResult[] = [], logs: string[] = []
  const records = new StoryViewRecords(me, auth, () => {}, result => { changes.push(result) }, () => reader, (step, detail) => { logs.push(`${step} ${detail}`) })
  return { records, watches, changes, logs }
}

test('§7 (a): the counts are listened to while the story is shown; the list is not read until it opens', async () => {
  const { records, watches, changes } = setup()
  const reading = records.read(request)
  await tick(); await tick()
  assert.equal(watches.length, 1)
  assert.deepEqual(watches[0]!.target, { documents: { documents: [statsPath] } })
  watches[0]!.events.snapshot(new Map([[statsPath, stats(2)]]))
  const first = await reading
  assert.deepEqual([first.outcome, first.list, first.current?.counts.viewers, first.current?.rows.length], ['ready', 'closed', 2, 0])
  watches[0]!.events.snapshot(new Map([[statsPath, stats(3)]]))
  assert.equal(changes.at(-1)?.current?.counts.viewers, 3, 'a new count shows while the story is shown')
})

test('§3 · §7 (b): the open list listens to views by name, 1000 + 1, and a new viewer or reaction joins it; closing ends the listen', async () => {
  const { records, watches, changes } = setup()
  const reading = records.read(request); await tick(); await tick()
  watches[0]!.events.snapshot(new Map([[statsPath, stats(1)]])); await reading
  records.viewers(request.id, true)
  assert.equal(changes.at(-1)?.list, 'loading')
  const list = watches[1]!
  assert.deepEqual(list.target, { query: { parent: story, structuredQuery: { from: [{ collectionId: 'views' }], orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }], limit: { value: 1001 } } } })
  assert.equal(list.max, 1001)
  const t = Date.now() - 50_000
  list.events.snapshot(new Map([[`${story}/views/a`, view('a', t)]]))
  assert.deepEqual(changes.at(-1)?.current?.rows.map(row => row.uid), ['a'])
  list.events.snapshot(new Map([[`${story}/views/a`, view('a', t)], [`${story}/views/b`, view('b', t + 10_000)]]))
  assert.deepEqual(changes.at(-1)?.current?.rows.map(row => row.uid), ['b', 'a'], 'the newest first, on the device')
  list.events.snapshot(new Map([[`${story}/views/a`, view('a', t, '❤️')], [`${story}/views/b`, view('b', t + 10_000)]]))
  assert.equal(changes.at(-1)?.current?.rows.find(row => row.uid === 'a')?.reaction, '❤️', 'a reaction changes its row')
  records.viewers(request.id, true)
  assert.equal(watches.length, 2, 'one listen per open list')
  const before = changes.length
  records.viewers(request.id, false)
  assert.equal(list.stopped, true, 'closing the list ends its listen')
  list.events.snapshot(new Map([[`${story}/views/c`, view('c', t)]]))
  assert.equal(changes.length, before, 'nothing after it closed')
  assert.equal(watches[0]!.stopped, false, 'the counts go on while the story is shown')
})

test('§7 (b) · §3-3: over 1000 the list says so (its own words) instead of showing a part; leaving the story ends both listens', async () => {
  const { records, watches, changes } = setup()
  const reading = records.read(request); await tick(); await tick()
  watches[0]!.events.snapshot(new Map()); const first = await reading
  assert.equal(first.current?.counts.viewers, 0, 'no counts yet: none')
  records.viewers(request.id, true)
  const many = new Map(Array.from({ length: 1001 }, (_, n) => [`${story}/views/u${n}`, view(`u${n}`, Date.now() - n)] as const))
  watches[1]!.events.snapshot(many)
  assert.deepEqual([changes.at(-1)?.list, changes.at(-1)?.current?.rows.length, changes.at(-1)?.message], ['over', 0, '1,000명이 넘어 다 보여 주지 못해요'])
  assert.equal(changes.at(-1)?.current?.counts.viewers, 0, 'the counts are storyStats\'s (none here)')
  records.dismiss(request.id)
  assert.equal(watches[0]!.signal.aborted && watches[1]!.signal.aborted, true, 'another story or the viewer closed: both listens end')
  records.viewers(request.id, true)
  assert.equal(watches.length, 2, 'a list for a story no longer shown is not opened')
})

test('B550: counts that cannot be read at first are not shown as none', async () => {
  const { records, watches } = setup()
  const reading = records.read(request); await tick(); await tick()
  watches[0]!.events.state('error')
  const first = await reading
  assert.deepEqual([first.outcome, first.current], ['unavailable', null])
  assert.equal(watches[0]!.signal.aborted, true)
})

test('B550: a socket that goes down does not stop the listens (Firestore reconnects them); the app lock does; the box opens and closes its list', () => {
  const session = readFileSync('src/main/accounts/session.ts', 'utf8')
  const connection = session.split('\n').find(line => line.startsWith("    if (state !== 'ready') { this.groupPhotoUpload.pause();"))!
  assert.doesNotMatch(connection, /storyViewRecords\.pause\(\)/)
  assert.match(session, /if \(locked\) \{ this\.discussionJoin\.pause\(\);[^\n]*this\.storyViewRecords\.pause\(\)/)
  assert.match(session, /result => \{ if \(!this\.closed && !this\.locked\) this\.events\.storyViewRecords\?\.\(result\) \}/)
  const viewer = readFileSync('src/renderer/src/stories/own-story-viewer.tsx', 'utf8')
  assert.match(viewer, /void window\.morse\.storyViewers\(accountUid, id, true\)/)
  assert.match(viewer, /return \(\) => \{ stop\(\); void window\.morse\.storyViewers\(accountUid, id, false\)/)
  assert.doesNotMatch(viewer, /<ViewersBox result=\{views\}/, 'the box follows the list, not the result it was opened with')
})

test('§3-3: the over-1,000 words are the same in all three tables; a read failure keeps its own words', async () => {
  const en = (await import('../../src/shared/i18n/en.json')).default as Record<string, string>
  const ru = (await import('../../src/shared/i18n/ru.json')).default as Record<string, string>
  assert.equal(en['1,000명이 넘어 다 보여 주지 못해요'], "More than 1,000 viewers — they can't all be shown")
  assert.equal(ru['1,000명이 넘어 다 보여 주지 못해요'], 'Больше 1 000 зрителей — показать всех нельзя')
  const source = readFileSync('src/main/accounts/story-view-records.ts', 'utf8')
  assert.match(source, /message: list === 'unavailable' \? unreadable : list === 'over' \? over : ''/)
  const viewer = readFileSync('src/renderer/src/stories/own-story-viewer.tsx', 'utf8')
  assert.match(viewer, /result\.list === 'unavailable' \|\| result\.list === 'over' \? <div className="empty-state">/)
})

test('B550 log: each listen\'s start and end go to story-check.log by kind and number only, so a paired check sees the list stop', async () => {
  const { records, watches, logs } = setup()
  const reading = records.read(request); await tick(); await tick()
  watches[0]!.events.snapshot(new Map([[statsPath, stats(1)]])); await reading
  records.viewers(request.id, true)
  watches[1]!.events.snapshot(new Map([[`${story}/views/a`, view('a', Date.now() - 1000)]]))
  records.viewers(request.id, false)
  records.viewers(request.id, true)
  records.dismiss(request.id)
  assert.deepEqual(logs, ['viewer-listen stats start #1', 'viewer-listen views start #2', 'viewer-listen views end #3 docs=1', 'viewer-listen views start #4', 'viewer-listen views end #5 docs=0', 'viewer-listen stats end #6'])
  assert.ok(logs.every(line => !line.includes(me) && !line.includes('s1')), 'no uid, no story id')
})
