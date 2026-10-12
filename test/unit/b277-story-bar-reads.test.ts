import assert from 'node:assert/strict'
import { mock, test } from 'node:test'
import { StoryBarApi, storyBarRearm } from '../../src/main/api/story-bar'
import { PeerProfiles, publicProfilePath } from '../../src/main/accounts/peer-profiles'
import { documents, ReadFailure, type FirestoreDocument, type WireObject } from '../../src/main/network/firestore-values'
import type { FirestoreReader, WatchEvents } from '../../src/main/network/firestore-rpc'
import type { StoryBarResult } from '../../src/shared/story-bar'

// B277 ②: the stories row listens to each person's lists over one stream — read once, then only what changes. Whether a
// person lists this viewer is the contacts' own answer; when it turns false the contacts-only list goes first.
const me = 'me'
const iso = (ms: number) => ({ seconds: String(Math.floor(ms / 1000)), nanos: 0 })
const story = (owner: string, collection: string, id: string, expires: number, extra: Record<string, unknown> = {}): FirestoreDocument => ({
  name: `${documents}/users/${owner}/${collection}/${id}`, updateTime: { seconds: '1', nanos: 0 },
  fields: { authorId: { stringValue: owner }, createdAt: { timestampValue: iso(expires - 86400000) }, expiresAt: { timestampValue: iso(expires) }, ...extra }
} as unknown as FirestoreDocument)
const docs = (...items: FirestoreDocument[]) => new Map(items.map(item => [item.name, item]))

function bar(peers: string[], keeps: (uid: string) => boolean | null) {
  let clock = 1_000_000_000_000
  const log: string[] = []
  const live = new Map<string, { events: WatchEvents; cutoff: unknown }>()
  const listen = {
    add: (wire: WireObject, events: WatchEvents) => {
      const query = wire.query as { parent: string; structuredQuery: { from: { collectionId: string }[]; where: { fieldFilter: { value: unknown } } } }
      const key = `${query.parent.split('/users/')[1]}/${query.structuredQuery.from[0]!.collectionId}`
      const entry = { events, cutoff: query.structuredQuery.where.fieldFilter.value }
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
  const api = new StoryBarApi(me, auth, () => {}, uid => peers.includes(uid), keeps, result => results.push(result), () => reader as never, () => clock)
  return { api, log, live, results, advance: (ms: number) => { clock += ms; mock.timers.tick(ms) }, now: () => clock }
}

test('the gate is the contacts\' answer: contacts-only lists only for a person who lists this viewer, no get, no one else\'s close friends', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const answers: Record<string, boolean | null> = { a: true, b: false, c: null }
    const { api, live } = bar(['a', 'b', 'c'], uid => answers[uid] ?? null)
    await api.list(['a', 'b', 'c'], false)
    assert.deepEqual([...live.keys()].sort(), ['a/publicStories', 'a/stories', 'b/publicStories', 'c/publicStories', 'me/closeFriendStories', 'me/publicStories', 'me/stories'])
    // c's answer comes: the contacts changed.
    answers.c = true; api.recheck()
    assert.ok(live.has('c/stories'))
    api.close()
  } finally { mock.timers.reset() }
})

test('a person who stops listing this viewer loses the contacts-only list first, and nothing else is listened again', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const answers: Record<string, boolean | null> = { a: true }
    const { api, log } = bar(['a'], uid => answers[uid] ?? null)
    await api.list(['a'], false)
    log.length = 0
    answers.a = false; api.recheck()
    assert.deepEqual(log, ['remove a/stories'])
    api.close()
  } finally { mock.timers.reset() }
})

test('what a list answers reaches the row at once; a story seen, hidden or expired leaves its count', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const { api, live, results, advance, now } = bar(['a'], () => true)
    await api.list(['a'], false)
    const soon = now() + 30 * 60000, later = now() + 20 * 3600000
    live.get('a/publicStories')!.events.snapshot(docs(story('a', 'publicStories', 's1', soon), story('a', 'publicStories', 's2', later, { viewerIds: { arrayValue: { values: [{ stringValue: me }] } } })))
    live.get('a/stories')!.events.snapshot(docs(story('a', 'stories', 's3', later, { hiddenFrom: { arrayValue: { values: [{ stringValue: me }] } } })))
    advance(60)
    const entry = results.at(-1)!.entries.find(item => item.uid === 'a')!
    assert.deepEqual([entry.count, entry.unseen, entry.expiresAt], [2, 1, soon], 'hidden from me: not counted; seen: not unseen')
    advance(30 * 60000 + 200); advance(100)
    assert.deepEqual(results.at(-1)!.entries.map(item => [item.uid, item.count]), [['a', 1]], 'the expired story leaves by itself, with no read')
    api.close()
  } finally { mock.timers.reset() }
})

test('every hour each list is made again from now, the new one before the old one stops; what it showed stays meanwhile', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const { api, log, live, results, advance, now } = bar(['a'], () => false)
    await api.list(['a'], false)
    live.get('a/publicStories')!.events.snapshot(docs(story('a', 'publicStories', 's1', now() + 20 * 3600000)))
    const cutoff = live.get('a/publicStories')!.cutoff
    advance(60)
    log.length = 0
    advance(storyBarRearm)
    assert.deepEqual(log.filter(line => line.includes('a/')), ['add a/publicStories', 'remove a/publicStories'])
    assert.notDeepEqual(live.get('a/publicStories')!.cutoff, cutoff)
    assert.deepEqual(results.at(-1)!.entries.map(item => item.uid), ['a'])
    api.close()
  } finally { mock.timers.reset() }
})

test('a list the server refuses drops what it had; one that broke otherwise keeps it; asking again listens to them again', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const { api, log, live, results, advance, now } = bar(['a'], () => true)
    await api.list(['a'], false)
    const later = now() + 20 * 3600000
    live.get('a/publicStories')!.events.snapshot(docs(story('a', 'publicStories', 's1', later)))
    live.get('a/stories')!.events.snapshot(docs(story('a', 'stories', 's2', later)))
    live.get('a/stories')!.events.state('error', new ReadFailure('permission'))
    live.get('a/publicStories')!.events.state('error', new ReadFailure('data'))
    advance(60)
    assert.deepEqual(results.at(-1)!.entries.map(item => [item.uid, item.count]), [['a', 1]], 'the refused list is gone, the other kept')
    log.length = 0
    await api.list(['a'], true)
    assert.deepEqual(log.filter(line => line.startsWith('add')).sort(), ['add a/publicStories', 'add a/stories'])
    log.length = 0
    await api.list(['a'], false)
    assert.deepEqual(log, [], 'asked without force: names the people, listens to nothing again')
    api.close()
  } finally { mock.timers.reset() }
})

test('a locked app closes the stream and tells nothing; unlocked, the row listens again', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const { api, log, live, results, advance } = bar(['a'], () => false)
    await api.list(['a'], false)
    api.setLocked(true)
    assert.ok(log.includes('close'))
    assert.equal(live.size, 0)
    const told = results.length
    advance(storyBarRearm * 2)
    assert.equal(results.length, told)
    api.setLocked(false)
    assert.ok(live.has('a/publicStories') && live.has('me/stories'))
    api.close()
  } finally { mock.timers.reset() }
})

test('PeerProfiles answers whether a contact lists this account, and nothing before it has answered', () => {
  const targets: WatchEvents[] = []
  const reader = { watch(_t: unknown, _s: AbortSignal, events: WatchEvents) { targets.push(events); return () => {} } } as unknown as FirestoreReader
  const auth = { signal: new AbortController().signal }
  const profiles = new PeerProfiles(me, auth, auth.signal, () => {}, undefined, 'contacts', () => true)
  profiles.bind(reader, ['x', 'y'])
  assert.deepEqual([profiles.keeps('x'), profiles.keeps('y')], [null, null])
  const doc = (name: string) => ({ name, fields: { displayName: { stringValue: 'n' } } } as unknown as FirestoreDocument)
  targets[0]!.snapshot(new Map([[publicProfilePath('x'), doc(publicProfilePath('x'))], [`${documents}/users/x/contacts/${me}`, doc(`${documents}/users/x/contacts/${me}`)], [publicProfilePath('y'), doc(publicProfilePath('y'))]]))
  assert.deepEqual([profiles.keeps('x'), profiles.keeps('y'), profiles.keeps('z')], [true, false, null])
  const authors = new PeerProfiles(me, auth, auth.signal, () => {}, undefined, 'authors')
  assert.equal(authors.keeps('x'), null, 'an author\'s reader reads no such entry')
})
