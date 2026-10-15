import assert from 'node:assert/strict'
import { mock, test } from 'node:test'
import { StoryBarApi, storyBarRearm } from '../../src/main/api/story-bar'
import { feedStoryFromDocument, laterMark, storyRead, storyReadMarkFromDocument } from '../../src/main/network/story-feed-document'
import { documents, ReadFailure, type FirestoreDocument, type WireObject } from '../../src/main/network/firestore-values'
import type { WatchEvents } from '../../src/main/network/firestore-rpc'
import type { StoryBarResult } from '../../src/shared/story-bar'

// B408 S2 (contracts/B408-stories-access.md §14): the row reads others' stories only from this account's storyFeed — the
// copies the server put there (morse-story-audience.js feedCopy) — and what is read of them from storyReadMarks; its own
// stories from its own three lists. Nobody's lists are asked for by person (tdesktop: stories.getAllStories, data_stories.cpp:720-728).
const me = 'me'
const iso = (ms: number) => ({ seconds: String(Math.floor(ms / 1000)), nanos: (ms % 1000) * 1e6 })
const copy = (owner: string, id: string, created: number, expires: number, extra: Record<string, unknown> = {}, ownerType = 'user', collection = 'publicStories'): FirestoreDocument => ({
  name: `${documents}/users/${me}/storyFeed/${owner}_${id}`, updateTime: { seconds: '1', nanos: 0 },
  fields: { ownerType: { stringValue: ownerType }, ownerId: { stringValue: owner }, storyId: { stringValue: id }, collection: { stringValue: collection },
    storyPath: { stringValue: ownerType === 'channel' ? `channels/${owner}/stories/${id}` : `users/${owner}/${collection}/${id}` }, source: { stringValue: 'audience' },
    authorId: { stringValue: owner }, mediaURL: { stringValue: 'gs://b/x.jpg' }, mediaType: { stringValue: 'image' },
    createdAt: { timestampValue: iso(created) }, expiresAt: { timestampValue: iso(expires) }, ...extra }
} as unknown as FirestoreDocument)
const mark = (owner: string, created: number, storyId: string): FirestoreDocument => ({
  name: `${documents}/users/${me}/storyReadMarks/user_${owner}`, updateTime: { seconds: '1', nanos: 0 },
  fields: { ownerType: { stringValue: 'user' }, ownerId: { stringValue: owner }, maxReadCreatedAt: { timestampValue: iso(created) }, maxReadStoryId: { stringValue: storyId } }
} as unknown as FirestoreDocument)
const own = (collection: string, id: string, expires: number): FirestoreDocument => ({
  name: `${documents}/users/${me}/${collection}/${id}`, updateTime: { seconds: '1', nanos: 0 },
  fields: { authorId: { stringValue: me }, createdAt: { timestampValue: iso(expires - 86400000) }, expiresAt: { timestampValue: iso(expires) } }
} as unknown as FirestoreDocument)
const docs = (...items: FirestoreDocument[]) => new Map(items.map(item => [item.name, item]))

function bar() {
  let clock = 1_800_000_000_000
  const log: string[] = []
  const live = new Map<string, { events: WatchEvents; query: Record<string, unknown> }>()
  const listen = {
    add: (wire: WireObject, events: WatchEvents) => {
      const query = wire.query as { parent: string; structuredQuery: { from: { collectionId: string }[] } }
      const key = `${query.parent.split('/users/')[1]}/${query.structuredQuery.from[0]!.collectionId}`
      const entry = { events, query: query.structuredQuery as unknown as Record<string, unknown> }
      log.push(`add ${key}`); live.set(key, entry)
      return () => { log.push(`remove ${key}`); if (live.get(key) === entry) live.delete(key) }
    },
    close: () => { log.push('close'); live.clear() },
    tally: { fresh: 0, resumed: 0, documents: 0, refused: 0 },
    get size() { return live.size }
  }
  const reader = { listenTargets: () => listen, close: () => {} }
  const results: StoryBarResult[] = []
  const auth = { signal: new AbortController().signal, authorize: async () => ({ idToken: 'id', appCheckToken: 'check', expiresAt: Date.now() + 60000 }) }
  const api = new StoryBarApi(me, auth, () => {}, result => results.push(result), () => reader as never, () => clock)
  return { api, log, live, results, advance: (ms: number) => { clock += ms; mock.timers.tick(ms) }, now: () => clock }
}

test('B408 S2: the row listens to this account\'s feed, its read marks and its own three lists — no one else\'s lists', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const { api, live } = bar()
    await api.list(['a', 'b', 'c'], false)
    assert.deepEqual([...live.keys()].sort(), ['me/closeFriendStories', 'me/publicStories', 'me/stories', 'me/storyFeed', 'me/storyReadMarks'])
    assert.equal(live.get('me/storyFeed')!.query.where, undefined, 'the feed is read whole (copies are not removed at their end; the row leaves them out)')
    api.close()
  } finally { mock.timers.reset() }
})

test('B408 S2: the row counts each person\'s live copies; read marks decide what is new; only people of the row, only users', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const { api, live, results, advance, now } = bar()
    await api.list(['a', 'b'], false)
    const t = now(), soon = t + 30 * 60000, later = t + 20 * 3600000
    live.get('me/storyFeed')!.events.snapshot(docs(
      copy('a', 's1', t - 3000, soon), copy('a', 's2', t - 2000, later), copy('a', 's3', t - 1000, later),
      copy('b', 'old', t - 90000000, t - 1000),
      copy('z', 'x', t - 1000, later),
      copy('ch1', 'c1', t - 1000, later, {}, 'channel', 'channel')))
    live.get('me/storyReadMarks')!.events.snapshot(docs(mark('a', t - 2000, 's2')))
    advance(60)
    assert.deepEqual(results.at(-1)!.entries.map(entry => [entry.uid, entry.count, entry.unseen, entry.expiresAt]), [['a', 3, 1, soon]],
      'b\'s copy has ended, z is not in the row, a channel is not a person; s1 and s2 are read')
    assert.equal(api.noteRead({ ownerType: 'user', ownerId: 'a', createdAt: t - 1000, storyId: 's3' }), true)
    assert.equal(api.noteRead({ ownerType: 'user', ownerId: 'a', createdAt: t - 3000, storyId: 's1' }), false, 'a mark never moves back')
    advance(60)
    assert.equal(results.at(-1)!.entries[0]!.unseen, 0, 'read on this device: no longer new before the server\'s copy of the mark')
    advance(30 * 60000 + 200); advance(100)
    assert.deepEqual(results.at(-1)!.entries.map(entry => [entry.uid, entry.count]), [['a', 2]], 'the copy that ended leaves by itself')
    assert.deepEqual(api.feedStories('user', 'a').map(story => story.storyId), ['s2', 's3'])
    assert.deepEqual(api.feedStories('channel', 'ch1').map(story => story.storyId), ['c1'])
    assert.equal(api.inFeed(`${documents}/users/a/publicStories/s2`), true); assert.equal(api.inFeed(`${documents}/users/a/publicStories/zz`), false)
    api.close()
  } finally { mock.timers.reset() }
})

test('B408 S2: this account\'s own stories are counted from its own lists, and only those lists are made again each hour', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const { api, log, live, results, advance, now } = bar()
    await api.list(['a'], false)
    live.get('me/publicStories')!.events.snapshot(docs(own('publicStories', 'm1', now() + 20 * 3600000)))
    advance(60)
    assert.deepEqual(results.at(-1)!.entries.map(entry => [entry.uid, entry.count, entry.unseen]), [['me', 1, 0]])
    log.length = 0
    advance(storyBarRearm)
    assert.deepEqual(log.filter(line => line.startsWith('add')).sort(), ['add me/closeFriendStories', 'add me/publicStories', 'add me/stories'])
    api.close()
  } finally { mock.timers.reset() }
})

test('B408 S2: a refused feed drops its copies; asking again with force listens again; a locked app holds nothing', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const { api, log, live, results, advance, now } = bar()
    await api.list(['a'], false)
    live.get('me/storyFeed')!.events.snapshot(docs(copy('a', 's1', now() - 1000, now() + 3600000)))
    live.get('me/storyFeed')!.events.state('error', new ReadFailure('permission'))
    advance(60)
    assert.deepEqual(results.at(-1)!.entries, [])
    log.length = 0
    await api.list(['a'], true)
    assert.deepEqual(log.filter(line => line.startsWith('add')), ['add me/storyFeed'])
    api.setLocked(true)
    assert.ok(log.includes('close')); assert.equal(live.size, 0)
    api.setLocked(false)
    assert.ok(live.has('me/storyFeed') && live.has('me/storyReadMarks'))
    api.close()
  } finally { mock.timers.reset() }
})

test('B408 S2: a feed copy must live where it says and name its own story; read marks the same; the read order is created then id', () => {
  const t = 1_800_000_000_000
  const story = feedStoryFromDocument(copy('a', 's1', t, t + 1000), me)
  assert.deepEqual([story.ownerType, story.ownerId, story.privacy, story.storyPath, story.mediaType], ['user', 'a', 'everyone', `${documents}/users/a/publicStories/s1`, 'image'])
  assert.throws(() => feedStoryFromDocument({ ...copy('a', 's1', t, t + 1000), name: `${documents}/users/other/storyFeed/a_s1` }, me))
  assert.throws(() => feedStoryFromDocument(copy('a', 's1', t, t + 1000, { storyPath: { stringValue: 'users/a/publicStories/s2' } }), me))
  assert.throws(() => feedStoryFromDocument(copy('a', 's1', t, t + 1000, { collection: { stringValue: 'channel' } }), me), 'a person\'s story in the channel collection')
  assert.equal(feedStoryFromDocument(copy('ch', 'c', t, t + 1000, {}, 'channel', 'channel'), me).storyPath, `${documents}/channels/ch/stories/c`)
  assert.equal(storyReadMarkFromDocument(mark('a', t, 's1'), me).maxReadStoryId, 's1')
  assert.throws(() => storyReadMarkFromDocument({ ...mark('a', t, 's1'), name: `${documents}/users/${me}/storyReadMarks/channel_a` }, me))
  const m = { maxReadCreatedAt: t, maxReadStoryId: 'm' }
  assert.deepEqual([storyRead({ createdAt: t - 1, storyId: 'z' }, m), storyRead({ createdAt: t, storyId: 'a' }, m), storyRead({ createdAt: t, storyId: 'z' }, m), storyRead({ createdAt: t, storyId: 'z' }, undefined)], [true, true, false, false])
  assert.equal(laterMark(m, { createdAt: t + 1, storyId: 'a' }), true)
})

// B408 S2 ③: the owner's viewers are the story's views, newest first by their latest mark; the counts the server's storyStats.
test('B408 S2: the viewer list is the views subcollection and the counts are storyStats, or the list\'s own until the server has counted', async () => {
  const { storyViewRecords } = await import('../../src/main/network/story-view-records')
  const parent = `${documents}/users/${me}/publicStories/s1/views`, t = 1_800_000_000_000
  const view = (uid: string, fields: Record<string, unknown>) => ({ name: `${parent}/${uid}`, fields } as unknown as FirestoreDocument)
  const views = [view('a', { viewedAt: { timestampValue: iso(t) } }), view('b', { viewedAt: { timestampValue: iso(t + 5000) }, reaction: { stringValue: '❤️' } }), view('c', { reaction: { stringValue: '👍' } }), view('d', { forwardedAt: { timestampValue: iso(t + 9000) } })]
  const listed = storyViewRecords(views, parent, null)
  assert.deepEqual(listed.rows.map(row => [row.uid, row.viewed, row.reaction, row.forwarded]), [['d', false, null, true], ['b', true, '❤️', false], ['a', true, null, false], ['c', false, '👍', false]])
  assert.deepEqual(listed.counts, { viewers: 2, reactions: 2, reposts: 0, forwards: 1 })
  const stats = { name: `${documents}/users/${me}/storyStats/s1`, fields: { viewCount: { integerValue: '7' }, reactionCount: { integerValue: '3' }, forwardCount: { integerValue: '1' }, repostCount: { integerValue: '2' } } } as unknown as FirestoreDocument
  assert.deepEqual(storyViewRecords(views, parent, stats).counts, { viewers: 7, reactions: 3, reposts: 2, forwards: 1 })
  assert.throws(() => storyViewRecords([view('x', { reaction: { stringValue: 'x'.repeat(17) } })], parent, null))
  assert.throws(() => storyViewRecords([{ name: `${documents}/users/${me}/publicStories/s2/views/a`, fields: {} } as unknown as FirestoreDocument], parent, null))
})

test('B408 S2: one person\'s ring outside the row (the chat header) is counted from the same feed and read marks', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const { api, live, now } = bar()
    assert.equal(api.peerEntry('z'), null, 'asking listens to the feed; nothing has come yet')
    assert.ok(live.has('me/storyFeed'))
    const t = now()
    live.get('me/storyFeed')!.events.snapshot(docs(copy('z', 'x1', t - 2000, t + 3600000), copy('z', 'x2', t - 1000, t + 3600000)))
    live.get('me/storyReadMarks')!.events.snapshot(docs(mark('z', t - 2000, 'x1')))
    assert.deepEqual(api.peerEntry('z'), { uid: 'z', count: 2, unseen: 1, latestAt: t - 1000, expiresAt: t + 3600000 }, 'z is not in the row and still has a ring')
    assert.equal(api.peerEntry(me), null, 'this account\'s own stories are not a peer\'s')
    api.close()
  } finally { mock.timers.reset() }
})
