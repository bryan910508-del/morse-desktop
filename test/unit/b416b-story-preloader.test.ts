import assert from 'node:assert/strict'
import { test } from 'node:test'
import { StoryPreloader, maxPreloadBytes, type PreloadCandidate, type PreloaderDeps } from '../../src/main/accounts/story-preloader'
import { MorseCallableFailure } from '../../src/main/network/morse-callable'
import { feedStoryPicturePath } from '../../src/main/accounts/story-media-paths'
import { storageBucket } from '../../src/main/media/media-document'

// B416 B (tdesktop data_stories.cpp:2540-2637, dialogs_inner_widget.cpp:587): while the stories row is on screen, the
// story each of its first 10 people would open with is fetched ahead, one at a time, into the account's media cache.
// It only fetches — nothing else is asked of the server — and it waits whenever the person is busy.
const candidate = (n: number): PreloadCandidate => ({ path: `stories/user/u${n}/s${n}.jpg`, ownerId: `u${n}`, storyId: `s${n}`, storyPath: `users/u${n}/stories/s${n}` })
const settle = () => new Promise(resolve => setTimeout(resolve, 5))
function rig(over: Partial<PreloaderDeps> = {}, list = Array.from({ length: 12 }, (_, i) => candidate(i))) {
  const log: string[] = [], kept: string[] = [], calls: { path: string; maxBytes: number; weighFirst: boolean }[] = []
  let inFlight = 0, most = 0
  const deps: PreloaderDeps = {
    candidates: () => list, idle: () => 'go', limit: () => maxPreloadBytes, cached: async () => false,
    fetch: async (item, maxBytes, weighFirst) => { inFlight++; most = Math.max(most, inFlight); calls.push({ path: item.path, maxBytes, weighFirst }); await settle(); inFlight--; return Buffer.from('jpg') },
    keep: path => { kept.push(path) }, record: (step, detail) => log.push(`${step} ${detail.split(' ')[0]}`), ...over
  }
  const owner = new AbortController()
  return { preloader: new StoryPreloader(deps, owner.signal), log, kept, calls, owner, most: () => most }
}
const until = async (check: () => boolean) => { for (let i = 0; i < 200 && !check(); i++) await settle() }

test('the first 10 people\'s to-open stories are fetched one at a time into the cache, and only once', async () => {
  const r = rig()
  r.preloader.poke(); r.preloader.poke()
  await until(() => r.kept.length === 10)
  await settle()
  assert.deepEqual(r.kept, Array.from({ length: 10 }, (_, i) => `stories/user/u${i}/s${i}.jpg`), 'the row\'s order, no more than 10')
  assert.equal(r.most(), 1, 'one at a time')
  r.preloader.poke(); await settle()
  assert.equal(r.calls.length, 10, 'what was fetched is not asked again')
  r.preloader.close()
})

test('what the cache already has is not fetched; automatic download off fetches nothing; under the limit the size is weighed first', async () => {
  const cached = rig({ cached: async path => path.endsWith('s0.jpg') }, [candidate(0), candidate(1)])
  cached.preloader.poke(); await until(() => cached.kept.length === 1)
  assert.deepEqual(cached.calls.map(call => call.path), ['stories/user/u1/s1.jpg'])
  assert.deepEqual(cached.calls[0], { path: 'stories/user/u1/s1.jpg', maxBytes: maxPreloadBytes, weighFirst: false })
  const off = rig({ limit: () => 0 })
  off.preloader.poke(); await settle(); await settle()
  assert.equal(off.calls.length, 0)
  const limited = rig({ limit: () => 1 << 20 }, [candidate(0)])
  limited.preloader.poke(); await until(() => limited.calls.length === 1)
  assert.deepEqual(limited.calls[0], { path: 'stories/user/u0/s0.jpg', maxBytes: 1 << 20, weighFirst: true })
  for (const item of [cached, off, limited]) item.preloader.close()
})

test('it waits while the person is busy or the viewer is open, and does nothing while the row is not shown', async () => {
  let state: 'go' | 'wait' | 'off' = 'off'
  const r = rig({ idle: () => state }, [candidate(0)])
  r.preloader.poke(); await settle()
  assert.equal(r.calls.length, 0, 'off: the row is not on screen')
  state = 'wait'; r.preloader.poke(); await settle()
  assert.equal(r.calls.length, 0, 'wait: an upload, a pressed download, the viewer or no connection')
  state = 'go'; r.preloader.poke()
  await until(() => r.kept.length === 1)
  assert.equal(r.kept.length, 1)
  r.preloader.close()
})

test('a lock, a hidden row or another account stops what is on the way; nothing is kept from it', async () => {
  const signals: AbortSignal[] = []
  const r = rig({ fetch: (_item, _max, _weigh, signal) => new Promise<Buffer>((_, reject) => { signals.push(signal); signal.addEventListener('abort', () => reject(signal.reason)) }) }, [candidate(0)])
  r.preloader.poke(); await until(() => signals.length === 1)
  r.preloader.pause()
  await settle()
  assert.ok(signals[0]!.aborted)
  assert.deepEqual(r.kept, [])
  r.preloader.poke(); await until(() => signals.length === 2)
  r.owner.abort()
  await settle()
  assert.ok(signals[1]!.aborted, 'the account\'s signal ends it')
  r.preloader.poke(); await settle()
  assert.equal(signals.length, 2, 'closed: nothing more')
})

test('a refusal is not asked again; a connection that failed is', async () => {
  const refused = rig({ fetch: async () => { throw new MorseCallableFailure('answered', 'PERMISSION_DENIED') } }, [candidate(0)])
  refused.preloader.poke(); await until(() => refused.log.length === 1)
  refused.preloader.poke(); await settle()
  assert.deepEqual(refused.log, ['story-preload-failed refused'])
  refused.preloader.close()
  let tries = 0
  const network = rig({ fetch: async () => { tries++; if (tries === 1) throw new TypeError('fetch failed'); return Buffer.from('jpg') } }, [candidate(0)])
  network.preloader.poke(); await until(() => tries === 1)
  network.preloader.pause(); network.preloader.poke()
  await until(() => network.kept.length === 1)
  assert.equal(tries, 2)
  assert.equal(network.log[0], 'story-preload-failed network')
  assert.ok(network.log[1]!.startsWith('story-preloaded'))
  network.preloader.close()
})

test('the picture a copy shows first: the photo of a photo story, the poster of a video story', () => {
  const url = (name: string, owner = 'ann') => `https://firebasestorage.googleapis.com/v0/b/${storageBucket}/o/${encodeURIComponent(`stories/user/${owner}/${name}`)}?alt=media`
  const base = { storyPath: 'users/ann/stories/s1', ownerId: 'ann' }
  assert.equal(feedStoryPicturePath({ ...base, mediaType: 'image', mediaURL: url('s1.jpg'), thumbnailURL: null }), 'stories/user/ann/s1.jpg')
  assert.equal(feedStoryPicturePath({ ...base, mediaType: 'video', mediaURL: url('s1.mp4'), thumbnailURL: url('s1_thumb.jpg') }), 'stories/user/ann/s1_thumb.jpg')
  assert.equal(feedStoryPicturePath({ ...base, mediaType: 'video', mediaURL: url('s1.mp4'), thumbnailURL: null }), null, 'no poster, nothing ahead')
  assert.equal(feedStoryPicturePath({ ...base, mediaType: 'image', mediaURL: url('s1.jpg', 'bob'), thumbnailURL: null }), null, 'another owner\'s file is not this story\'s')
})
