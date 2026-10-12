import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { LocalPreviews } from '../../src/main/platform/local-previews'
import { AttachmentStaging, setVideoCompressor } from '../../src/main/media/attachment-staging'

// B323-a·b·c: what the window chose for a channel story or a sticker, and a video edited in the send box, are shown
// from addresses main answers — the page's policy allows no blob: images or media.
const png = (fill: number): Uint8Array => new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(64, fill)]))
const mp4 = (fill: number, length = 200): Buffer => Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(length, fill)])
const path = (url: string): string => url.slice('morse://app/__local-preview/'.length)

test('a chosen picture or video is held and served, and nothing a page could run is', async () => {
  const previews = new LocalPreviews()
  const url = previews.hold(png(3))
  assert.match(url, /^morse:\/\/app\/__local-preview\/[0-9a-f-]{36}$/)
  const response = previews.response(path(url), new Request('http://app/x'))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('Content-Type'), 'image/png')
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff')
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), png(3))
  const video = previews.hold(new Uint8Array(mp4(5)))
  const ranged = previews.response(path(video), new Request('http://app/x', { headers: { range: 'bytes=0-15' } }))
  assert.equal(ranged.status, 206, 'a video seeks by ranges')
  assert.throws(() => previews.hold(new TextEncoder().encode('<html><script>alert(1)</script></html>')))
  assert.throws(() => previews.hold(new Uint8Array(0)))
  assert.throws(() => previews.hold('not bytes'))
  previews.release(url)
  assert.equal(previews.response(path(url), new Request('http://app/x')).status, 403, 'a released one is gone')
  assert.equal(previews.response('../etc', new Request('http://app/x')).status, 403)
  previews.clear()
  assert.equal(previews.response(path(video), new Request('http://app/x')).status, 403)
})

test('past a few, the oldest held go first', () => {
  const previews = new LocalPreviews()
  const urls = Array.from({ length: 8 }, (_, n) => previews.hold(png(n)))
  const alive = urls.map(url => previews.response(path(url), new Request('http://app/x')).status)
  assert.deepEqual(alive, [403, 403, 200, 200, 200, 200, 200, 200])
})

test('an edited video is read at its own address after the edit, and an older one is refused', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'morse-b323c-')), file = join(dir, 'clip.mp4')
  await writeFile(file, mp4(1, 4000))
  let n = 0
  setVideoCompressor(async (_path, edit) => ({ status: 'ok', bytes: Buffer.from(edit ? mp4(10 + ++n, 64) : mp4(3, 120)) }))
  const staging = new AttachmentStaging()
  try {
    const draft = (await staging.pick('c1', 'media', () => true, async () => [file]))!
    const item = draft.items[0]!
    const edit = { start: 0, end: 1, preset: 'medium' as const }
    const first = (await staging.editVideo('c1', draft.id, item.id, edit, () => true)).items[0]!.previewUrl!
    assert.ok(first.endsWith(`/${item.id}/e1`))
    const read = async (url: string) => { const r = staging.response('c1', url.slice('morse://app/__draft-media/'.length), new Request('http://app/x')); return r.status === 200 ? Buffer.from(await r.arrayBuffer()) : r.status }
    assert.deepEqual(await read(first), mp4(11, 64))
    const second = (await staging.editVideo('c1', draft.id, item.id, edit, () => true)).items[0]!.previewUrl!
    assert.ok(second.endsWith('/e2'))
    assert.deepEqual(await read(second), mp4(12, 64))
    assert.equal(await read(first), 403)
    assert.deepEqual(await read(item.previewUrl!), mp4(12, 64), 'the first address serves what will be sent')
  } finally { staging.clear(); setVideoCompressor(null); await rm(dir, { recursive: true, force: true }) }
})
