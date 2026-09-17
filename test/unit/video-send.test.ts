import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AttachmentStaging } from '../../src/main/media/attachment-staging'
import { rangeResponse } from '../../src/main/media/range-response'
import { mediaMetadata } from '../../src/shared/media-metadata'
import { videoFacts } from '../../src/shared/uploads'

// A video sent from this desktop travels the way iOS sends one: display size, whole seconds and a
// 160px placeholder, read by the send box from the staged bytes, which it plays over byte ranges.
const facts = { duration: 16.013, width: 400, height: 258, thumb: Buffer.from('frame').toString('base64') }

test('video facts: what the send box reads is checked before it reaches a message', () => {
  assert.equal(videoFacts(undefined), null)
  assert.equal(videoFacts(null), null)
  assert.deepEqual(videoFacts(facts), facts)
  assert.deepEqual(videoFacts({ ...facts, thumb: '' }), { ...facts, thumb: '' }, 'a frame that could not be drawn leaves the rest')
  for (const bad of [{ ...facts, duration: 0 }, { ...facts, duration: Number.POSITIVE_INFINITY }, { ...facts, width: 0 }, { ...facts, height: 1.5 },
    { ...facts, width: 20000 }, { ...facts, thumb: 'not base64!' }, { ...facts, thumb: 'A'.repeat(100_001) }, { ...facts, extra: 1 }, 'video'])
    assert.throws(() => videoFacts(bad), `rejected: ${JSON.stringify(bad).slice(0, 60)}`)
})

async function stagedVideo() {
  const dir = await mkdtemp(join(tmpdir(), 'morse-video-')), path = join(dir, 'clip.mp4')
  // An ISO base media file header is all the kind detection reads.
  await writeFile(path, Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(200, 1)]))
  const staging = new AttachmentStaging()
  const draft = await staging.pick('chat1', 'media', () => true, async () => [path])
  assert.ok(draft)
  return { staging, draft, done: () => rm(dir, { recursive: true, force: true }) }
}

test('a video carries its size, whole seconds and placeholder the way iOS records them', async () => {
  const { staging, draft, done } = await stagedVideo()
  try {
    assert.equal(draft.kind, 'video')
    assert.equal(draft.items[0]!.previewUrl, `morse://app/__draft-media/${draft.id}/${draft.items[0]!.id}`)
    const { wire } = staging.prepare('me', 'chat1', draft.id, '설명', [draft.items[0]!.id], facts)
    assert.equal(wire.videoWidthPx, 400)
    assert.equal(wire.videoHeightPx, 258)
    assert.equal(wire.videoDuration, 16)
    assert.equal(wire.thumbData, facts.thumb)
    assert.equal(wire.videoCaption, '설명')
    assert.equal(wire.mediaWidthPx, undefined, 'iOS keeps a video size in videoWidthPx only')
    // Whatever goes out must read back as the metadata of a video.
    const { videoWidthPx, videoHeightPx, videoDuration, thumbData } = wire
    assert.deepEqual(mediaMetadata({ videoWidthPx, videoHeightPx, videoDuration, thumbData }, 'video', 1), { videoWidthPx: 400, videoHeightPx: 258, videoDuration: 16, thumbData: facts.thumb })
  } finally { staging.clear(); await done() }
})

test('a video the send box could not read is sent as before', async () => {
  const { staging, draft, done } = await stagedVideo()
  try {
    const { wire } = staging.prepare('me', 'chat1', draft.id, '', [draft.items[0]!.id])
    for (const key of ['videoWidthPx', 'videoHeightPx', 'videoDuration', 'thumbData'] as const) assert.equal(wire[key], undefined)
  } finally { staging.clear(); await done() }
})

test('the staged video is served to the send box, over byte ranges, and nothing else is', async () => {
  const { staging, draft, done } = await stagedVideo()
  try {
    const path = `${draft.id}/${draft.items[0]!.id}`
    const whole = staging.response('chat1', path, new Request('morse://app/x'))
    assert.equal(whole.status, 200)
    assert.equal(whole.headers.get('accept-ranges'), 'bytes')
    assert.equal(whole.headers.get('content-type'), 'video/mp4')
    const part = staging.response('chat1', path, new Request('morse://app/x', { headers: { range: 'bytes=4-11' } }))
    assert.equal(part.status, 206)
    assert.equal(Buffer.from(await part.arrayBuffer()).toString('ascii'), 'ftypisom')
    assert.equal(staging.response('chat2', path, new Request('morse://app/x')).status, 403, 'another chat')
    assert.equal(staging.response('chat1', `${draft.id}/other`, new Request('morse://app/x')).status, 403, 'another item')
    assert.equal(staging.response('chat1', path, new Request('morse://app/x', { method: 'POST' })).status, 403)
    staging.clear()
    assert.equal(staging.response('chat1', path, new Request('morse://app/x')).status, 403, 'a cleared selection')
  } finally { staging.clear(); await done() }
})

test('byte ranges: open-ended, suffix, past the end, and malformed', async () => {
  const bytes = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  const read = async (range?: string, method = 'GET') => {
    const response = rangeResponse(bytes, 'video/mp4', new Request('morse://app/x', { method, headers: range ? { range } : {} }))
    return { status: response.status, range: response.headers.get('content-range'), length: response.headers.get('content-length'), body: method === 'HEAD' || response.status >= 400 ? null : [...new Uint8Array(await response.arrayBuffer())] }
  }
  assert.deepEqual(await read(), { status: 200, range: null, length: '10', body: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] })
  assert.deepEqual(await read('bytes=7-'), { status: 206, range: 'bytes 7-9/10', length: '3', body: [7, 8, 9] })
  assert.deepEqual(await read('bytes=-2'), { status: 206, range: 'bytes 8-9/10', length: '2', body: [8, 9] })
  assert.deepEqual(await read('bytes=2-100'), { status: 206, range: 'bytes 2-9/10', length: '8', body: [2, 3, 4, 5, 6, 7, 8, 9] })
  assert.equal((await read('bytes=10-')).status, 416)
  assert.equal((await read('bytes=5-2')).status, 416)
  assert.equal((await read('items=0-1')).status, 416)
  assert.deepEqual(await read('bytes=0-1', 'HEAD'), { status: 206, range: 'bytes 0-1/10', length: '2', body: null })
  assert.equal((await read(undefined, 'PUT')).status, 403)
})
