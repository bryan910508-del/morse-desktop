import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mediaResources, storageBucket } from '../../src/main/media/media-document'
import { PhotoPreviews } from '../../src/main/media/photo-previews'
import { ChannelPostPictures } from '../../src/main/accounts/channel-post-pictures'
import { registerAutoDownload, autoDownloadFor } from '../../src/main/accounts/auto-download-limits'
import type { FirestoreDocument } from '../../src/main/network/firestore-values'
import type { ReadCredentials } from '../../src/main/network/firestore-rpc'
import type { MediaResource } from '../../src/main/media/media-document'
import type { MediaRequest } from '../../src/shared/media'

// B360 (reports/desktop/2026-10-14-b359-b360-plan.md, review 10-14 02:0x): automatic download weighs what it knows before
// asking (tdesktop Data::AutoDownload::Should, data_auto_download.cpp:406-424 — the photo's own byte size), and a
// broadcast channel's pictures follow the «채널» limit (SourceFromPeer :50-58). v7.3.1 6fed91ff.
const doc = (fields: Record<string, unknown>): FirestoreDocument => ({ name: 'projects/p/databases/(default)/documents/chats/chat1/messages/m1', fields } as unknown as FirestoreDocument)
const url = (path: string) => ({ stringValue: `https://firebasestorage.googleapis.com/v0/b/${storageBucket}/o/${encodeURIComponent(path)}?alt=media&token=t` })

test('a photo\'s or a sticker\'s size is read when the message carries one; several photos give none; a file as before', () => {
  const one = mediaResources(doc({ type: { stringValue: 'image' }, mediaUrl: url('chat_media/chat1/m1.jpg'), fileSize: { integerValue: '3000000' } }), 'chat1', 'image', false)
  assert.equal(one[0]!.summary.size, 3000000)
  const many = mediaResources(doc({ type: { stringValue: 'image' }, mediaKeys: { arrayValue: { values: [url('chat_media/chat1/m1_0.jpg'), url('chat_media/chat1/m1_1.jpg')] } }, fileSize: { integerValue: '3000000' } }), 'chat1', 'image', false)
  assert.ok(many.length === 2 && many.every(part => part.summary.size === undefined), 'one fileSize cannot name one of several photos')
  const none = mediaResources(doc({ type: { stringValue: 'image' }, mediaUrl: url('chat_media/chat1/m1.jpg') }), 'chat1', 'image', false)
  assert.equal(none[0]!.summary.size, undefined)
})

const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(92, 7)])
const credentials = () => ({ signal: new AbortController().signal, authorize: async () => ({ idToken: 'token', appCheckToken: 'check' }) } as unknown as ReadCredentials)
const request: MediaRequest = { requestId: 'r1', messageId: 'm1', version: '1:0', index: 0 }
const sized = (size?: number): MediaResource => ({ path: 'chat_media/chat1/m1.jpg', summary: { index: 0, kind: 'image', name: '사진', available: true, blind: false, ...(size ? { size } : {}) } })

test('a photo over the room\'s limit by its own size is not asked for at all; under it, it is', async () => {
  const original = globalThis.fetch
  let fetches = 0
  globalThis.fetch = (async () => { fetches++; return new Response(new Uint8Array(png), { status: 200, headers: { 'content-length': String(png.length) } }) }) as typeof fetch
  try {
    const big = new PhotoPreviews(credentials(), () => sized(2 * 1024 * 1024))
    assert.equal(await big.load('chat1', request, 1024 * 1024), null)
    assert.equal(fetches, 0, 'held before the request (was: the answer\'s length after it)')
    assert.ok(await big.load('chat1', request), 'pressed: no limit, fetched')
    assert.equal(fetches, 1)
    big.close()
    const small = new PhotoPreviews(credentials(), () => sized(500 * 1024))
    assert.ok(await small.load('chat1', request, 1024 * 1024))
    assert.equal(fetches, 2)
    small.close()
  } finally { globalThis.fetch = original }
})

test('the registry gives a loader the person\'s limit now; none registered keeps the loader\'s own', () => {
  const auth = {}, other = {}
  let channel = 0
  registerAutoDownload(auth, () => ({ user: 8 << 20, group: 8 << 20, channel }))
  assert.equal(autoDownloadFor(auth, 'channel', 4 << 20), 0)
  channel = 1 << 20
  assert.equal(autoDownloadFor(auth, 'channel', 4 << 20), 1 << 20, 'read as it is now')
  assert.equal(autoDownloadFor(other, 'channel', 4 << 20), 4 << 20)
})

test('a channel\'s pictures: «채널» off asks nothing (the picture stays its placeholder); 1 MB refuses a bigger one before its bytes', async () => {
  const original = globalThis.fetch
  const asked: string[] = []
  const path = 'channel_posts/ch1/post1-0.jpg'
  globalThis.fetch = (async (input: string | URL | Request) => {
    const target = String(input instanceof Request ? input.url : input)
    asked.push(target.includes('cloudfunctions') ? 'grant' : target.includes('alt=media') ? 'body' : 'metadata')
    if (target.includes('cloudfunctions')) return new Response(JSON.stringify({ result: { ok: true, resourceURL: `gs://${storageBucket}/${path}` } }), { status: 200 })
    return new Response(JSON.stringify({ bucket: storageBucket, name: path, size: String(2 * 1024 * 1024), generation: '1', metageneration: '1', md5Hash: 'AAAAAAAAAAAAAAAAAAAAAA==', metadata: { postId: 'post1' } }), { status: 200 })
  }) as typeof fetch
  try {
    let channel = 0
    const auth = credentials()
    registerAutoDownload(auth, () => ({ user: 8 << 20, group: 8 << 20, channel }))
    const off = new ChannelPostPictures(auth, () => ({ path, video: false, postId: 'post1' }), () => {}, '__channel-post-picture')
    off.setWanted(['ch1/post1/0'])
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.deepEqual(asked, [], 'nothing asked of the server')
    assert.equal(off.snapshot('ch1/post1/0')?.status, 'idle', 'its placeholder, not an error')
    off.close()
    channel = 1 << 20
    const limited = new ChannelPostPictures(auth, () => ({ path, video: false, postId: 'post1' }), () => {}, '__channel-post-picture')
    limited.setWanted(['ch1/post1/0'])
    await new Promise(resolve => setTimeout(resolve, 50))
    assert.ok(asked.includes('metadata'), 'its size is looked at')
    assert.ok(!asked.includes('body'), 'a 2 MB picture over the 1 MB limit: no bytes asked')
    limited.close()
  } finally { globalThis.fetch = original }
})
