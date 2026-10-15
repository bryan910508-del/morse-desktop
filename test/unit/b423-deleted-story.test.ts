import assert from 'node:assert/strict'
import { mock, test } from 'node:test'
import { MediaGone, readGrantedStorageObject } from '../../src/main/network/granted-storage-read'
import { storageBucket } from '../../src/main/media/media-document'
import type { ReadCredentials, WatchEvents } from '../../src/main/network/firestore-rpc'
import { StoryBarApi } from '../../src/main/api/story-bar'
import { PeerStories, type PeerStoryFeed } from '../../src/main/accounts/peer-stories'
import { StoryPreloader, maxPreloadBytes, type PreloadCandidate } from '../../src/main/accounts/story-preloader'
import { ChannelStories, type ChannelStoryFeed } from '../../src/main/accounts/channel-stories'
import { documents, type FirestoreDocument, type WireObject } from '../../src/main/network/firestore-values'
import type { FeedStory } from '../../src/main/network/story-feed-document'

// B423 (server f3c05f67: authorizeMorseMediaRead answers not-found for a file that is not there): a story whose media
// the server says is gone is a deleted story — tdesktop Stories::applyDeleted (data_stories.cpp:899). It leaves the row,
// the ring, the stories fetched ahead and the open lists at once, and is not asked for again while its copy stays.
const auth = { signal: new AbortController().signal, authorize: async () => ({ idToken: 'id', appCheckToken: 'check', expiresAt: Date.now() + 60000 }) } as unknown as ReadCredentials
const path = 'stories/user/ann/s1.jpg'
const check = { label: 'Story photo', custom: { storyId: 's1', ownerUid: 'ann' }, contentTypes: ['image/jpeg'], maxBytes: 1024, resend: false }
function server(answer: (url: string) => Response) {
  const original = globalThis.fetch, log: string[] = []
  globalThis.fetch = (async (input: string | URL) => {
    const url = String(input)
    log.push(url.includes('authorizeMorseMediaRead') ? 'grant' : url.endsWith('?alt=media') ? 'media' : 'meta')
    return answer(url)
  }) as typeof fetch
  return { log, restore: () => { globalThis.fetch = original } }
}
const granted = () => new Response(JSON.stringify({ result: { ok: true, resourceURL: `gs://${storageBucket}/${path}` } }), { status: 200 })
const read = (weighFirst = false) => readGrantedStorageObject(auth, path, { ...check, weighFirst }, new AbortController().signal, () => {}, () => {})

test('the grant\'s not-found, and Storage\'s 404, say the media is gone; other refusals do not', async () => {
  let net = server(() => new Response(JSON.stringify({ error: { status: 'NOT_FOUND', message: 'Media no longer exists.' } }), { status: 404 }))
  try { await assert.rejects(read(), MediaGone); assert.deepEqual(net.log, ['grant'], 'nothing more is asked') } finally { net.restore() }
  net = server(url => url.includes('authorizeMorseMediaRead') ? granted() : new Response('gone', { status: 404 }))
  try { await assert.rejects(read(), MediaGone) } finally { net.restore() }
  net = server(url => url.includes('authorizeMorseMediaRead') ? granted() : new Response('gone', { status: 404 }))
  try { await assert.rejects(read(true), MediaGone); assert.deepEqual(net.log, ['grant', 'meta'], 'weighed first: the metadata says so') } finally { net.restore() }
  net = server(() => new Response(JSON.stringify({ error: { status: 'PERMISSION_DENIED', message: 'no' } }), { status: 403 }))
  try { await assert.rejects(read(), error => !(error instanceof MediaGone)) } finally { net.restore() }
  net = server(url => url.includes('authorizeMorseMediaRead') ? granted() : new Response('no', { status: 403 }))
  try { await assert.rejects(read(), error => !(error instanceof MediaGone)) } finally { net.restore() }
})

const me = 'me'
const iso = (ms: number) => ({ seconds: String(Math.floor(ms / 1000)), nanos: (ms % 1000) * 1e6 })
const copy = (owner: string, id: string, created: number, expires: number): FirestoreDocument => ({
  name: `${documents}/users/${me}/storyFeed/${owner}_${id}`, updateTime: { seconds: '1', nanos: 0 },
  fields: { ownerType: { stringValue: 'user' }, ownerId: { stringValue: owner }, storyId: { stringValue: id }, collection: { stringValue: 'publicStories' },
    storyPath: { stringValue: `users/${owner}/publicStories/${id}` }, source: { stringValue: 'audience' }, authorId: { stringValue: owner },
    mediaURL: { stringValue: `gs://${storageBucket}/stories/user/${owner}/${id}.jpg` }, mediaType: { stringValue: 'image' },
    createdAt: { timestampValue: iso(created) }, expiresAt: { timestampValue: iso(expires) } }
} as unknown as FirestoreDocument)
const docs = (...items: FirestoreDocument[]) => new Map(items.map(item => [item.name, item]))
function bar() {
  const clock = 1_800_000_000_000
  const live = new Map<string, WatchEvents>()
  const listen = {
    add: (wire: WireObject, events: WatchEvents) => {
      const query = wire.query as { parent: string; structuredQuery: { from: { collectionId: string }[] } }
      const key = query.structuredQuery.from[0]!.collectionId
      live.set(key, events); return () => { if (live.get(key) === events) live.delete(key) }
    },
    close: () => live.clear(), tally: { fresh: 0, resumed: 0, documents: 0, refused: 0 }, get size() { return live.size }
  }
  let notified = 0
  const api = new StoryBarApi(me, auth, () => {}, () => { notified++ }, () => ({ listenTargets: () => listen, close: () => {} }) as never, () => clock)
  return { api, live, now: () => clock, notified: () => notified }
}
const storyPath = (owner: string, id: string) => `${documents}/users/${owner}/publicStories/${id}`

test('a deleted story leaves the row, the ring, the candidates and the feed lists until its copy goes', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const { api, live, now, notified } = bar()
    await api.list(['ann', 'bob'], false)
    const t = now(), later = t + 3600000
    live.get('storyFeed')!.snapshot(docs(copy('ann', 'a1', t - 3000, later), copy('ann', 'a2', t - 2000, later), copy('bob', 'b1', t - 1000, later)))
    mock.timers.tick(100)
    assert.equal(api.peerEntry('ann')?.count, 2)
    const before = notified()
    api.applyDeleted(storyPath('ann', 'a1'))
    mock.timers.tick(100)
    assert.ok(notified() > before, 'the row is told')
    assert.ok(api.gone(storyPath('ann', 'a1')))
    assert.equal(api.peerEntry('ann')?.count, 1, 'the ring counts one')
    assert.deepEqual(api.feedStories('user', 'ann').map(story => story.storyId), ['a2'], 'an opened list does not hold it')
    assert.equal(api.inFeed(storyPath('ann', 'a1')), false)
    assert.deepEqual(api.preloadCandidates().map(item => item.storyId).sort(), ['a2', 'b1'], 'not fetched ahead')
    api.applyDeleted(storyPath('bob', 'b1'))
    assert.equal(api.peerEntry('bob'), null, 'a person with no story left leaves the row (applyRemovedFromActive)')
    // The feed answers again with the copy still there: still deleted. Then without it: forgotten.
    live.get('storyFeed')!.snapshot(docs(copy('ann', 'a1', t - 3000, later), copy('ann', 'a2', t - 2000, later)))
    assert.ok(api.gone(storyPath('ann', 'a1')))
    assert.equal(api.gone(storyPath('bob', 'b1')), false, 'its copy went, so it is forgotten')
    live.get('storyFeed')!.snapshot(docs(copy('ann', 'a2', t - 2000, later)))
    assert.equal(api.gone(storyPath('ann', 'a1')), false)
    api.close()
  } finally { mock.timers.reset() }
})

const now = 1_800_000_000_000
const feedStory = (id: string, created: number): FeedStory => ({
  ownerType: 'user', ownerId: 'ann', storyId: id, authorId: 'ann', collection: 'publicStories', privacy: 'everyone',
  storyPath: storyPath('ann', id), source: 'audience', createdAt: created, expiresAt: created + 86400000,
  caption: '', mediaType: 'image', hasThumbnail: false, audio: 'none', mediaURL: `gs://${storageBucket}/stories/user/ann/${id}.jpg`, thumbnailURL: null, audioURL: null, version: '1:0'
})

test('the open list loses a deleted story and says which; a story already known deleted is not opened', async () => {
  const gone = new Set<string>()
  const stories = [feedStory('s1', now - 3000), feedStory('s2', now - 2000)]
  const feed: PeerStoryFeed = { feedStories: () => stories, mark: () => undefined, noteRead: () => false, inFeed: () => true, gone: value => gone.has(value) }
  const peer = new PeerStories('me', auth, feed, () => {}, () => false, async () => ({ stories: [] }), () => now)
  await peer.open({ id: 'r1', ownerId: 'ann' })
  assert.equal(peer.deleted, null)
  assert.equal(peer.applyDeleted(storyPath('ann', 'other')), false)
  assert.equal(peer.applyDeleted(storyPath('ann', 's1')), true)
  assert.deepEqual(peer.deleted, { requestId: 'r1', storyIds: ['s1'] })
  assert.throws(() => peer.detail({ requestId: 'r1', storyId: 's1', version: '1:0' }), 'its media is not fetched')
  assert.equal(peer.detail({ requestId: 'r1', storyId: 's2', version: '1:0' }).storyPath, storyPath('ann', 's2'))
  gone.add(storyPath('ann', 's2'))
  const opened = await peer.open({ id: 'r2', ownerId: 'ann' })
  assert.deepEqual(opened.rows.map(row => row.id), ['s1', 's2'].filter(id => !gone.has(storyPath('ann', id))))
  assert.equal(peer.deleted, null, 'a new list starts with none')
  peer.dispose()
})

const candidate = (n: number): PreloadCandidate => ({ path: `stories/user/u${n}/s${n}.jpg`, ownerId: `u${n}`, storyId: `s${n}`, storyPath: `users/u${n}/publicStories/s${n}` })
const settle = () => new Promise(resolve => setTimeout(resolve, 5))

test('a row story found gone is dropped through the one place and not fetched again; the next one is', async () => {
  const told: string[] = [], log: string[] = [], calls: string[] = []
  const owner = new AbortController()
  const preloader = new StoryPreloader({
    candidates: () => [candidate(0), candidate(1)], idle: () => 'go', limit: () => maxPreloadBytes, cached: async () => false,
    fetch: async item => { calls.push(item.path); if (item.storyId === 's0') throw new MediaGone('Story photo'); return Buffer.from('jpg') },
    keep: () => {}, gone: value => told.push(value), record: (step, detail) => log.push(`${step} ${detail.split(' ')[0]}`)
  }, owner.signal)
  preloader.poke()
  for (let i = 0; i < 100 && calls.length < 2; i++) await settle()
  await settle()
  assert.deepEqual(told, ['users/u0/publicStories/s0'])
  assert.equal(log[0], 'story-preload-failed gone')
  assert.match(log[1]!, /^story-preloaded /, 'the next one is fetched')
  preloader.poke(); await settle()
  assert.deepEqual(calls, ['stories/user/u0/s0.jpg', 'stories/user/u1/s1.jpg'], 'not asked again')
  preloader.close()
})

test('a channel story found gone leaves the channel\'s ring; its media answer tells the one place', async () => {
  const channelStory: FeedStory = { ...feedStory('c1', now - 1000), ownerType: 'channel', ownerId: 'ch1', authorId: 'owner1', collection: 'channel', privacy: 'channel',
    storyPath: `${documents}/channels/ch1/stories/c1`, mediaURL: `gs://${storageBucket}/stories/channel/ch1/c1.jpg` }
  const told: string[] = []
  const feed: ChannelStoryFeed = { feedStories: () => [channelStory], mark: () => undefined, noteRead: () => false, inFeed: () => true, storyDeleted: value => told.push(value) }
  let changes = 0
  const stories = new ChannelStories('me', auth, () => true, () => { changes++ }, feed)
  stories.setVisible(['ch1'])
  for (let i = 0; i < 50 && !stories.snapshot()?.ch1; i++) await settle()
  assert.deepEqual(stories.snapshot()?.ch1?.stories.map(story => story.id), ['c1'])
  const net = server(() => new Response(JSON.stringify({ error: { status: 'NOT_FOUND', message: 'Media no longer exists.' } }), { status: 404 }))
  try { await assert.rejects(stories.media('ch1', 'c1'), MediaGone) } finally { net.restore() }
  assert.deepEqual(told, [channelStory.storyPath])
  const before = changes
  stories.applyDeleted(channelStory.storyPath)
  assert.equal(stories.snapshot()?.ch1, undefined, 'no ring, and a viewer showing it closes (channel-stories.tsx)')
  assert.ok(changes > before)
  stories.close()
})
