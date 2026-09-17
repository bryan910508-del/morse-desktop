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

test('a photo with no placeholder of its own gets one, and only the placeholder is kept', async () => {
  const server = serving(png)
  try {
    const previews = new PhotoPreviews(credentials(), () => resource())
    const expected = Buffer.from(`thumb:${png.length}`).toString('base64')
    assert.equal(await previews.loadThumb('chat1', request), expected)
    assert.equal(previews.thumb('chat1', request), expected)
    assert.equal(previews.url('chat1', request), null, 'the picture it came from is not kept')
    assert.equal(await previews.loadThumb('chat1', request), expected)
    assert.equal(server.fetches(), 1, 'a held placeholder is not fetched again')
    previews.close()
  } finally { server.restore() }
})

test('two bubbles asking at once share one fetch', async () => {
  const server = serving(png)
  try {
    const previews = new PhotoPreviews(credentials(), () => resource())
    const [first, second] = await Promise.all([previews.loadThumb('chat1', request), previews.loadThumb('chat1', request)])
    assert.equal(first, second)
    assert.equal(server.fetches(), 1)
    previews.close()
  } finally { server.restore() }
})

test('a picture shown by automatic download leaves its placeholder behind for when it is turned off', async () => {
  const server = serving(png)
  try {
    const previews = new PhotoPreviews(credentials(), () => resource())
    assert.match(await previews.load('chat1', request) ?? '', /^morse:\/\/app\/__photo-preview\//)
    assert.ok(previews.thumb('chat1', request))
    assert.equal(await previews.loadThumb('chat1', request), previews.thumb('chat1', request))
    assert.equal(server.fetches(), 1, 'the placeholder came from the picture already here')
    previews.close()
  } finally { server.restore() }
})

test('reading a placeholder asks no one, and nothing is shrunk from what is not a picture', async () => {
  let asked = 0
  const reading = new PhotoPreviews(credentials(), () => { asked++; return resource() })
  assert.equal(reading.thumb('chat1', request), null)
  assert.equal(asked, 0)
  reading.close()
  const server = serving(Buffer.from('<html>not a picture</html>'))
  try {
    const previews = new PhotoPreviews(credentials(), () => resource())
    assert.equal(await previews.loadThumb('chat1', request), null)
    assert.equal(previews.thumb('chat1', request), null)
    previews.close()
  } finally { server.restore() }
  for (const value of [resource({ blind: true }), resource({ kind: 'video' }), resource({ available: false }), null]) {
    const previews = new PhotoPreviews(credentials(), () => value)
    assert.equal(await previews.loadThumb('chat1', request), null)
    previews.close()
  }
})

test('locking or leaving the account forgets every placeholder', async () => {
  const server = serving(png)
  try {
    const previews = new PhotoPreviews(credentials(), () => resource())
    await previews.loadThumb('chat1', request)
    previews.clear()
    assert.equal(previews.thumb('chat1', request), null)
    await previews.loadThumb('chat1', request)
    previews.close()
    assert.equal(previews.thumb('chat1', request), null)
    assert.equal(await previews.loadThumb('chat1', request), null)
  } finally { server.restore() }
})
