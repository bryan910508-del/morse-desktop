import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PhotoPreviews } from '../../src/main/media/photo-previews'
import { MediaSession } from '../../src/main/media/media-session'
import type { MediaResource } from '../../src/main/media/media-document'
import type { ReadCredentials } from '../../src/main/network/firestore-rpc'
import type { MediaRequest } from '../../src/shared/media'

// B252: with several sticker bubbles in a room only the first was drawn. Each bubble asked the attachment viewer's single
// slot (MediaSession), which refuses an open while another downloads; now each asks the room's previews, one per message
// (tdesktop: a media view per Sticker, history_view_sticker.cpp:566-575).
const credentials = () => ({ signal: new AbortController().signal, authorize: async () => ({ idToken: 'token', appCheckToken: 'check' }) } as unknown as ReadCredentials)
const png = (seed: number) => Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(64, seed)])
const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(64, 1)])
const files: Record<string, Buffer> = { 'chat_media/chat1/s1.png': png(1), 'chat_media/chat1/s2.png': png(2), 'chat_videos/chat1/s3.mp4': mp4 }
const request = (messageId: string): MediaRequest => ({ requestId: `r-${messageId}`, messageId, version: '1:0', index: 0 })
const resource = (path: string): MediaResource => ({ path, summary: { index: 0, kind: 'sticker', name: '스티커', available: true, blind: false } })
const resolve = (_chat: string, value: MediaRequest): MediaResource | null => {
  const path = Object.keys(files).find(name => name.includes(`/${value.messageId}.`))
  return path ? resource(path) : null
}
function serving(): () => void {
  const original = globalThis.fetch
  globalThis.fetch = (async (url: string) => {
    await new Promise(done => setTimeout(done, 20))
    const path = decodeURIComponent(String(url).split('/o/')[1]!.split('?')[0]!), body = files[path]!
    return new Response(new Uint8Array(body), { status: 200, headers: { 'content-length': String(body.length) } })
  }) as typeof fetch
  return () => { globalThis.fetch = original }
}

test('before: the viewer\'s single slot refuses a second bubble while the first downloads', async () => {
  const restore = serving()
  try {
    const session = new MediaSession(credentials(), resolve, () => {})
    const first = session.open('chat1', request('s1'))
    assert.throws(() => session.open('chat1', request('s2')), 'only the first sticker could load')
    await first.catch(() => {})
    await session.close()
  } finally { restore() }
})

test('every sticker bubble of a room is drawn at once, an MP4 one as video', async () => {
  const restore = serving()
  try {
    const previews = new PhotoPreviews(credentials(), resolve)
    const [first, second, third] = await Promise.all(['s1', 's2', 's3'].map(id => previews.loadSticker('chat1', request(id))))
    assert.ok(first && second && third, 'all three')
    assert.equal(new Set([first!.url, second!.url, third!.url]).size, 3)
    assert.deepEqual([first!.video, second!.video, third!.video], [false, false, true])
    const served = previews.response(third!.url.split('/').pop()!, new Request(third!.url))
    assert.equal(served.status, 200); assert.equal(served.headers.get('content-type'), 'video/mp4')
    assert.equal(previews.response(first!.url.split('/').pop()!, new Request(first!.url)).headers.get('content-type'), 'image/png', 'the first is still served')
    previews.close()
  } finally { restore() }
})

test('a photo is still never taken for a video, and a sticker that is neither image nor MP4 is not drawn', async () => {
  const restore = serving()
  try {
    const odd = new PhotoPreviews(credentials(), () => ({ path: 'chat_videos/chat1/s3.mp4', summary: { index: 0, kind: 'image', name: '사진', available: true, blind: false } }))
    assert.equal(await odd.load('chat1', request('s3')), null, 'an MP4 under an image is not a photo preview')
    odd.close()
  } finally { restore() }
})
