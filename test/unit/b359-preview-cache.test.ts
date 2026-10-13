import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PhotoPreviews } from '../../src/main/media/photo-previews'
import { MediaCache } from '../../src/main/accounts/media-cache'
import type { MediaCacheCommand } from '../../src/main/storage/media-cache-table'
import type { MediaResource } from '../../src/main/media/media-document'
import type { ReadCredentials } from '../../src/main/network/firestore-rpc'
import type { MediaRequest } from '../../src/shared/media'

// B359 (reports/desktop/2026-10-14-b359-b360-plan.md, review 10-14 02:0x): chat photo and sticker previews go through
// the account's disk cache — the one opened media use — as tdesktop's photos go through Storage::Cache and are read
// from it even when automatic download holds the server back (PhotoMedia::automaticLoad LoadFromLocalOnly,
// data_photo_media.cpp:173-186, v7.3.1 6fed91ff). The server is asked only for what this device does not keep.
const credentials = () => ({ signal: new AbortController().signal, authorize: async () => ({ idToken: 'token', appCheckToken: 'check' }) } as unknown as ReadCredentials)
const request: MediaRequest = { requestId: 'r1', messageId: 'm1', version: '1:0', index: 0 }
const resource = (over: { kind?: 'image' | 'sticker'; blind?: boolean; path?: string } = {}): MediaResource => ({
  path: over.path ?? 'chat_media/chat1/m1.jpg',
  summary: { index: 0, kind: over.kind ?? 'image', name: '사진', available: true, blind: over.blind ?? false }
})
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(92, 7)])
function serving(body: Buffer) {
  const original = globalThis.fetch
  let count = 0
  globalThis.fetch = (async () => { count++; return new Response(new Uint8Array(body), { status: 200, headers: { 'content-length': String(body.length) } }) }) as typeof fetch
  return { fetches: () => count, restore: () => { globalThis.fetch = original } }
}
// The account's MediaCache over a store that keeps entries by their key, as media-cache-table.ts does on disk.
function diskCache() {
  const entries = new Map<string, Uint8Array>()
  const store = (async (command: MediaCacheCommand) => {
    if (command.kind === 'media-cache-read') return entries.get(command.key) ?? null
    if (command.kind === 'media-cache-write') { entries.set(command.key, command.data); return null }
    if (command.kind === 'media-cache-clear') { entries.clear(); return null }
    return null
  }) as never
  return { cache: new MediaCache(store), entries }
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

test('a picture fetched once is drawn again from the disk after a lock, a reconnection or a restart — no second request', async () => {
  const server = serving(png), { cache, entries } = diskCache()
  try {
    const previews = new PhotoPreviews(credentials(), () => resource(), cache)
    assert.ok(await previews.load('chat1', request))
    await settle()
    assert.equal(server.fetches(), 1)
    assert.ok(entries.has(MediaCache.key('chat_media/chat1/m1.jpg')), 'kept by its storage path')
    previews.clear() // a lock or a reconnection (session.ts stop/lock): memory goes, the disk stays
    assert.ok(await previews.load('chat1', request))
    previews.close()
    const restarted = new PhotoPreviews(credentials(), () => resource(), cache)
    assert.ok(await restarted.load('chat1', request), 'a new run draws it')
    assert.equal(server.fetches(), 1, 'the server was asked once in all')
    restarted.close()
  } finally { server.restore() }
})

test('automatic download off still shows what the device keeps, and asks the server for nothing else', async () => {
  const server = serving(png), { cache } = diskCache()
  try {
    const previews = new PhotoPreviews(credentials(), path => resource({ path: path === 'kept' ? 'chat_media/chat1/kept.jpg' : 'chat_media/chat1/other.jpg' }), cache)
    cache.write('chat_media/chat1/kept.jpg', png)
    await settle()
    assert.ok(await previews.load('kept', request, 0), 'LoadFromLocalOnly')
    assert.equal(await previews.load('other', request, 0), null)
    assert.equal(server.fetches(), 0)
    previews.close()
  } finally { server.restore() }
})

test('a photo this device sent is found under the path the outbox kept it at', async () => {
  const server = serving(png), { cache } = diskCache()
  try {
    // outbox.ts:1125-1127 — mediaCacheFor(auth).write(part.upload.path, bytes), the path the message later names.
    cache.write('chat_media/chat1/m1.jpg', png)
    await settle()
    const previews = new PhotoPreviews(credentials(), () => resource(), cache)
    assert.ok(await previews.load('chat1', request))
    assert.equal(server.fetches(), 0)
    previews.close()
  } finally { server.restore() }
})

test('stickers go the same way; a kept copy that is not a picture is fetched again; blind media is never kept', async () => {
  const server = serving(png), { cache, entries } = diskCache()
  try {
    const stickers = new PhotoPreviews(credentials(), () => resource({ kind: 'sticker', path: 'sticker_files/abc.png' }), cache)
    assert.ok(await stickers.loadSticker('chat1', request))
    await settle()
    stickers.close()
    const again = new PhotoPreviews(credentials(), () => resource({ kind: 'sticker', path: 'sticker_files/abc.png' }), cache)
    assert.ok(await again.loadSticker('chat2', request), 'the same sticker in another room, from the disk')
    assert.equal(server.fetches(), 1)
    again.close()
    cache.write('chat_media/chat1/bad.jpg', Buffer.from('not a picture at all'))
    await settle()
    const bad = new PhotoPreviews(credentials(), () => resource({ path: 'chat_media/chat1/bad.jpg' }), cache)
    assert.ok(await bad.load('chat1', request))
    assert.equal(server.fetches(), 2, 'an unreadable copy is not shown; the picture is fetched')
    bad.close()
    const before = entries.size
    const blind = new PhotoPreviews(credentials(), () => resource({ blind: true, path: 'chat_media/secret/s.jpg' }), cache)
    assert.equal(await blind.load('chat1', request), null)
    await settle()
    assert.equal(entries.size, before, 'a secret chat\'s media is neither shown here nor kept')
    blind.close()
  } finally { server.restore() }
})
