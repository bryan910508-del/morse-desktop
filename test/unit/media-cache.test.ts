import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { MediaCacheStore, type MediaCacheCommand } from '../../src/main/storage/media-cache-table'
import { isPlainDatabase } from '../../src/main/storage/encrypted-database'
import { mediaResources } from '../../src/main/media/media-document'
import type { FirestoreDocument } from '../../src/main/network/firestore-values'
import { MediaCache, registerMediaCache } from '../../src/main/accounts/media-cache'
import { ChannelPostPictures } from '../../src/main/accounts/channel-post-pictures'
import { forgetImages, holdsImage } from '../../src/main/accounts/userpic-images'
import type { ReadCredentials } from '../../src/main/network/firestore-rpc'

// Storage::Cache::Database with FileLoader::tryLoadLocal(): what an account fetched once is kept in its own cache
// file and drawn again without any request. Data::PhotoMedia keeps a drawn picture in memory for the session, under
// one address, so a post coming back into the list never reloads.
const picture = (fill: number, length = 64): Buffer => {
  const bytes = Buffer.alloc(length, fill)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 40, 0, 0, 0, 40]).copy(bytes)
  return bytes
}
const key = (value: string): string => MediaCache.key(value)
async function directory(): Promise<{ path: string; done(): Promise<void> }> {
  const path = await mkdtemp(join(tmpdir(), 'morse-media-cache-'))
  return { path, done: () => rm(path, { recursive: true, force: true }) }
}
const settle = async (): Promise<void> => { for (let step = 0; step < 50; step++) await new Promise(resolve => setImmediate(resolve)) }

test('media already fetched is kept sealed in the account cache, oldest and stale entries first to go', async () => {
  const dir = await directory()
  try {
    const file = join(dir.path, 'media.sqlite'), secret = randomBytes(32).toString('hex')
    let now = 1000
    const store = new MediaCacheStore(file, secret, () => now, { bytes: 200, entries: 3, age: 10_000 })
    for (const name of ['a', 'b', 'c']) { now++; store.execute({ kind: 'media-cache-write', key: key(name), data: picture(name.charCodeAt(0)) }) }
    now++
    assert.deepEqual(Buffer.from(store.execute({ kind: 'media-cache-read', key: key('a') }) as Uint8Array), picture('a'.charCodeAt(0)))
    now++; store.execute({ kind: 'media-cache-write', key: key('d'), data: picture(100) })
    assert.equal(store.execute({ kind: 'media-cache-read', key: key('b') }), null, 'the file opened longest ago left')
    assert.ok(store.execute({ kind: 'media-cache-read', key: key('a') }), 'a file opened again stays')
    assert.equal(store.execute({ kind: 'media-cache-usage' }), 64 * 3)
    now += 20_000
    assert.equal(store.execute({ kind: 'media-cache-read', key: key('a') }), null, 'past the time limit it counts as absent')
    assert.throws(() => store.execute({ kind: 'media-cache-write', key: 'not-a-key', data: picture(1) }))
    assert.throws(() => store.execute({ kind: 'media-cache-write', key: key('e'), data: Buffer.alloc(0) }))
    store.close()
    assert.equal(isPlainDatabase(file), false)
    assert.ok(!(await readFile(file)).includes(picture(100).subarray(24)), 'no media bytes in the file')
    const reopened = new MediaCacheStore(file, secret, () => now)
    assert.ok(reopened.execute({ kind: 'media-cache-read', key: key('d') }))
    reopened.execute({ kind: 'media-cache-clear' })
    assert.equal(reopened.execute({ kind: 'media-cache-read', key: key('d') }), null)
    reopened.close()
  } finally { await dir.done() }
})

test('the cache answers by the object it holds, and refuses what is too large for the surface', async () => {
  const dir = await directory()
  try {
    const store = new MediaCacheStore(join(dir.path, 'media.sqlite'), randomBytes(32).toString('hex'))
    const cache = new MediaCache(async command => store.execute(command as MediaCacheCommand) as never)
    cache.write('channel_posts/ch1/a.jpg', picture(7))
    await settle()
    assert.deepEqual(await cache.read('channel_posts/ch1/a.jpg'), picture(7))
    assert.equal(await cache.read('channel_posts/ch1/a.jpg', 8), null, 'a copy past this surface’s limit is not used')
    assert.equal(await cache.read('channel_posts/ch1/missing.jpg'), null)
    assert.equal(await cache.read(''), null)
    await cache.clear()
    assert.equal(await cache.read('channel_posts/ch1/a.jpg'), null)
    cache.close()
    assert.equal(await cache.read('channel_posts/ch1/a.jpg'), null, 'a closed cache reads nothing')
    store.close()
  } finally { await dir.done() }
})

test('a post picture in the account cache is drawn without any request, keeps one address, and comes back at once', async () => {
  forgetImages()
  const dir = await directory()
  try {
    const store = new MediaCacheStore(join(dir.path, 'media.sqlite'), randomBytes(32).toString('hex'))
    const cache = new MediaCache(async command => store.execute(command as MediaCacheCommand) as never)
    const path = 'channel_posts/ch1/post1-0.jpg'
    cache.write(path, picture(3))
    await settle()
    const credentials = { signal: new AbortController().signal, authorize: async () => { throw new Error('no network in this test') } } as unknown as ReadCredentials
    registerMediaCache(credentials, cache)
    let changes = 0
    const pictures = new ChannelPostPictures(credentials, () => ({ path, video: false, postId: 'post1' }), () => { changes++ }, '__channel-post-picture')
    pictures.setWanted(['ch1/post1/0'])
    await settle()
    const ready = pictures.snapshot('ch1/post1/0')
    assert.equal(ready?.status, 'ready', 'the picture came from the cache file, with no grant and no download')
    assert.ok(ready?.url?.startsWith('morse://app/__channel-post-picture/'))
    assert.equal(ready?.width, 40); assert.equal(ready?.height, 40)
    assert.ok(changes > 0)
    assert.ok(holdsImage(path), 'and it stays in memory for this run')
    const token = ready!.url!.slice('morse://app/__channel-post-picture/'.length)
    const response = await pictures.response(token, new Request(ready!.url!))
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('Content-Type'), 'image/png')
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), picture(3))

    // The post scrolls away and comes back: the same address, ready in the same frame.
    pictures.setWanted([])
    assert.equal(pictures.snapshot('ch1/post1/0')?.status, 'idle')
    pictures.setWanted(['ch1/post1/0'])
    const again = pictures.snapshot('ch1/post1/0')
    assert.equal(again?.status, 'ready', 'no loading state on the way back')
    assert.equal(again?.url, ready?.url)

    // Even when memory had to give the picture up, its address still answers, from the cache file.
    forgetImages()
    const afterForget = await pictures.response(token, new Request(ready!.url!))
    assert.equal(afterForget.status, 200)
    assert.deepEqual(Buffer.from(await afterForget.arrayBuffer()), picture(3))
    assert.equal((await pictures.response('0'.repeat(48), new Request(ready!.url!))).status, 403)
    pictures.close()
    assert.equal((await pictures.response(token, new Request(ready!.url!))).status, 403, 'a closed channel answers nothing')
    store.close()
  } finally { forgetImages(); await dir.done() }
})

// A channel's discussion room can answer to two ids — the server keeps `discussionChatId`, which is
// `channel_discuss_{channelId}` for a room it made and the older id for one that already existed — and
// iOS uploads under the name the message itself carries. Media must be found under either.
test('a discussion room finds its media under every name the room has', () => {
  const bucket = 'talky-a38c3.firebasestorage.app'
  const doc = (chatId: string, url: string): FirestoreDocument => ({ name: 'm1', fields: { type: { stringValue: 'image' }, chatId: { stringValue: chatId }, mediaUrl: { stringValue: url } } as FirestoreDocument['fields'] })
  const under = (room: string) => `gs://${bucket}/chat_media/${room}/m1.jpg`
  const names = ['old-room-id', 'channel_discuss_ch1']
  assert.equal(mediaResources(doc('old-room-id', under('old-room-id')), names, 'image', false)[0]?.path, 'chat_media/old-room-id/m1.jpg')
  assert.equal(mediaResources(doc('old-room-id', under('channel_discuss_ch1')), names, 'image', false)[0]?.path, 'chat_media/channel_discuss_ch1/m1.jpg')
  assert.equal(mediaResources(doc('old-room-id', under('someone-elses-room')), names, 'image', false)[0]?.path, null, 'another room’s folder is still refused')
  assert.equal(mediaResources(doc('r', under('r')), 'r', 'image', false)[0]?.path, 'chat_media/r/m1.jpg', 'one name still works')
})
