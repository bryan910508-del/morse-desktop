import assert from 'node:assert/strict'
import { test } from 'node:test'
import { StoryMediaCache, storyMediaKey } from '../../src/main/accounts/story-media-cache'

// Telegram keeps the stories around the one on screen ready (kPreloadNextMediaCount 3,
// kPreloadPreviousMediaCount 1), so this holds four and no more.
const entry = (size: number, fill = 7) => ({ bytes: Buffer.alloc(size, fill), mime: 'image/jpeg', audioBytes: null, audioMime: '' })
const key = (id: string) => storyMediaKey('owner', id, '100:0', 'photo:image:everyone')

test('what was fetched ahead is handed over once, and belongs to whoever took it', () => {
  const cache = new StoryMediaCache()
  cache.keep(key('a'), entry(16))
  assert.equal(cache.has(key('a')), true)
  const held = cache.take(key('a'))
  assert.equal(held?.bytes.length, 16)
  assert.equal(held?.bytes[0], 7)
  assert.equal(cache.take(key('a')), null, 'it is gone from the cache')
  cache.clear()
  assert.equal(held?.bytes[0], 7, 'clearing does not wipe what was already handed over')
})

test('only four stories are held, the oldest going first', () => {
  const cache = new StoryMediaCache()
  for (const id of ['a', 'b', 'c', 'd', 'e']) cache.keep(key(id), entry(16))
  assert.deepEqual(['a', 'b', 'c', 'd', 'e'].map(id => cache.has(key(id))), [false, true, true, true, true])
})

test('one story too large for the cache is not kept, and the rest are unharmed', () => {
  const cache = new StoryMediaCache()
  cache.keep(key('a'), entry(16))
  const huge = entry(97 * 1024 * 1024, 1)
  cache.keep(key('huge'), huge)
  assert.equal(cache.has(key('huge')), false)
  assert.equal(huge.bytes[0], 0, 'what is not kept is wiped')
  assert.equal(cache.has(key('a')), true)
})

test('keeping the same story again replaces it', () => {
  const cache = new StoryMediaCache()
  cache.keep(key('a'), entry(16, 1))
  cache.keep(key('a'), entry(32, 2))
  const held = cache.take(key('a'))
  assert.equal(held?.bytes.length, 32)
  assert.equal(held?.bytes[0], 2)
})

test('a closed cache holds nothing and wipes what it is given', () => {
  const cache = new StoryMediaCache()
  cache.keep(key('a'), entry(16))
  cache.close()
  assert.equal(cache.has(key('a')), false)
  const late = entry(16)
  cache.keep(key('b'), late)
  assert.equal(cache.has(key('b')), false)
  assert.equal(late.bytes[0], 0)
})
