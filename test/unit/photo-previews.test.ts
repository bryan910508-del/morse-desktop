import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PhotoPreviews } from '../../src/main/media/photo-previews'
import type { MediaResource } from '../../src/main/media/media-document'
import type { ReadCredentials } from '../../src/main/network/firestore-rpc'
import type { MediaRequest } from '../../src/shared/media'

// The preview path answers Telegram's automatic media download. It must stay silent about anything
// it cannot show, and reading it must never change anything: a publish passes through url().
const credentials = () => ({ signal: new AbortController().signal, authorize: async () => ({ idToken: 'token', appCheckToken: 'check' }) } as unknown as ReadCredentials)
const request: MediaRequest = { requestId: 'r1', messageId: 'm1', version: '1:0', index: 0 }
const resource = (over: Partial<MediaResource['summary']> & { path?: string | null } = {}): MediaResource => ({
  path: over.path === undefined ? 'chat_media/chat1/m1.jpg' : over.path,
  summary: { index: 0, kind: over.kind ?? 'image', name: '사진', available: over.available ?? true, blind: over.blind ?? false }
})

test('a message with no preview held reads as nothing, without asking anyone', () => {
  let asked = 0
  const previews = new PhotoPreviews(credentials(), () => { asked++; return resource() })
  assert.equal(previews.url('chat1', request), null)
  assert.equal(asked, 0, 'reading does not resolve, download or notify')
  previews.close()
})

test('nothing to show: an absent, blind, unavailable or non-image attachment', async () => {
  const cases: (MediaResource | null)[] = [null, resource({ path: null }), resource({ blind: true }), resource({ available: false }), resource({ kind: 'video' }), resource({ kind: 'file' })]
  for (const value of cases) {
    const previews = new PhotoPreviews(credentials(), () => value)
    assert.equal(await previews.load('chat1', request), null)
    assert.equal(previews.url('chat1', request), null)
    previews.close()
  }
})

test('an unknown token is refused, and a closed account serves nothing', async () => {
  const previews = new PhotoPreviews(credentials(), () => resource())
  assert.equal(previews.response('4f843cf9-2bc9-441d-8d9e-fbabccf99ba7', new Request('morse://app/__photo-preview/x')).status, 403)
  assert.equal(previews.response('', new Request('morse://app/__photo-preview/x', { method: 'DELETE' })).status, 403)
  previews.close()
  assert.equal(await previews.load('chat1', request), null, 'a closed account downloads nothing')
  assert.equal(previews.response('4f843cf9-2bc9-441d-8d9e-fbabccf99ba7', new Request('morse://app/__photo-preview/x')).status, 403)
})

// Telegram fetches the small size of a photo whose message carries no stripped thumbnail, whatever
// the automatic download preference says. Morse has only the picture itself, so it is fetched,
// shrunk to a placeholder, and let go. The stubbed nativeImage marks what it shrank; the real
// JPEG encoding belongs to Electron.
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(92, 7)])
function serving(body: Buffer): { fetches: () => number; restore: () => void } {
  const original = globalThis.fetch
  let count = 0
  globalThis.fetch = (async () => { count++; return new Response(new Uint8Array(body), { status: 200, headers: { 'content-length': String(body.length) } }) }) as typeof fetch
  return { fetches: () => count, restore: () => { globalThis.fetch = original } }
}

test('nothing is fetched to make a placeholder', async () => {
  const server = serving(png)
  try {
    const previews = new PhotoPreviews(credentials(), () => resource())
    // The limit for this room holds the picture back, so neither the picture nor a placeholder made
    // from it is fetched: Telegram's small size costs ten kilobytes, and this would cost the whole photo.
    assert.equal(await previews.load('chat1', request, 0), null)
    assert.equal(previews.thumb('chat1', request), null)
    assert.equal(server.fetches(), 0, 'a held back photo costs nothing')
    previews.close()
  } finally { server.restore() }
})

test('two bubbles asking at once share one fetch', async () => {
  const server = serving(png)
  try {
    const previews = new PhotoPreviews(credentials(), () => resource())
    const [first, second] = await Promise.all([previews.load('chat1', request), previews.load('chat1', request)])
    assert.equal(first, second)
    assert.equal(server.fetches(), 1)
    previews.close()
  } finally { server.restore() }
})

test('a picture that was shown leaves its placeholder behind for when its preview is gone', async () => {
  const server = serving(png)
  try {
    const previews = new PhotoPreviews(credentials(), () => resource())
    assert.match(await previews.load('chat1', request) ?? '', /^morse:\/\/app\/__photo-preview\//)
    const thumb = previews.thumb('chat1', request)
    assert.ok(thumb, 'the picture that was fetched to be shown left a placeholder')
    assert.equal(server.fetches(), 1, 'the placeholder came from the picture already here')
    previews.close()
  } finally { server.restore() }
})

test('reading a placeholder asks no one, and what is not a picture leaves none', async () => {
  let asked = 0
  const reading = new PhotoPreviews(credentials(), () => { asked++; return resource() })
  assert.equal(reading.thumb('chat1', request), null)
  assert.equal(asked, 0)
  reading.close()
  const server = serving(Buffer.from('<html>not a picture</html>'))
  try {
    const previews = new PhotoPreviews(credentials(), () => resource())
    assert.equal(await previews.load('chat1', request), null)
    assert.equal(previews.thumb('chat1', request), null)
    previews.close()
  } finally { server.restore() }
})

test('locking or leaving the account forgets every placeholder', async () => {
  const server = serving(png)
  try {
    const previews = new PhotoPreviews(credentials(), () => resource())
    await previews.load('chat1', request)
    assert.ok(previews.thumb('chat1', request))
    previews.clear()
    assert.equal(previews.thumb('chat1', request), null)
    await previews.load('chat1', request)
    previews.close()
    assert.equal(previews.thumb('chat1', request), null)
    assert.equal(await previews.load('chat1', request), null)
  } finally { server.restore() }
})

// Telegram keeps one cache entry up to `Settings::maxDataSize` (an entry's length is three bytes, so
// 16 MiB) and bounds the cache itself by `totalSizeLimit`. A 4 MB cap on one picture refused an
// ordinary phone photograph, and with it went the placeholder: the bubble showed an icon.
test('a photograph larger than four megabytes is shown, not refused', async () => {
  const large = Buffer.concat([png, Buffer.alloc(5 * 1024 * 1024, 3)])
  const server = serving(large)
  try {
    const previews = new PhotoPreviews(credentials(), () => resource())
    const url = await previews.load('chat1', request)
    assert.match(url ?? '', /^morse:\/\/app\/__photo-preview\//)
    assert.equal(previews.url('chat1', request), url)
    assert.ok(previews.thumb('chat1', request), 'its placeholder is kept too')
    assert.equal(previews.response(url!.split('/').pop()!, new Request(url!)).status, 200)
    previews.close()
  } finally { server.restore() }
})

// Data::AutoDownload: the limit kept for the kind of peer decides whether a photo is fetched without
// being asked for. The same picture, asked for by the person, comes with no limit but the preview cap.
test('a photo over the room’s limit is not fetched until it is asked for', async () => {
  const large = Buffer.concat([png, Buffer.alloc(2 * 1024 * 1024, 5)])
  const server = serving(large)
  try {
    const previews = new PhotoPreviews(credentials(), () => resource())
    assert.equal(await previews.load('chat1', request, 1024 * 1024), null, 'over the limit, so it waits')
    assert.equal(previews.url('chat1', request), null)
    assert.equal(previews.thumb('chat1', request), null, 'nothing is kept from a picture that was not read')
    assert.match(await previews.load('chat1', request) ?? '', /^morse:\/\/app\/__photo-preview\//, 'asked for, it is fetched')
    previews.close()
  } finally { server.restore() }
})
