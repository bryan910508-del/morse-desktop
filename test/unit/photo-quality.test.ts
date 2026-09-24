import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { photoSendSpec, reencodedPhotoType } from '../../src/shared/photo-quality'
import { AttachmentStaging } from '../../src/main/media/attachment-staging'

// iOS PhotoSendQuality and MorseMediaPolicy.photoSendQualityDefault.
test('the photo quality follows iOS, and power saving compresses', () => {
  // «자동» and «원본» are the SD and HD sizes Telegram sends a photo at, 1280 and 2560.
  assert.deepEqual(photoSendSpec('auto', false), { maxEdge: 1280, quality: 0.8 })
  assert.deepEqual(photoSendSpec('original', false), { maxEdge: 2560, quality: 0.9 })
  assert.deepEqual(photoSendSpec('compressed', false), { maxEdge: 512, quality: 0.55 })
  assert.deepEqual(photoSendSpec('original', true), { maxEdge: 512, quality: 0.55 })
  assert.equal(reencodedPhotoType('image/gif'), false, 'an animated GIF keeps its bytes')
})

test('a re-encoded photo takes the staged original\'s place with its own checksums', async () => {
  const staging = new AttachmentStaging()
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(64, 1)])
  const { writeFile, mkdtemp } = await import('node:fs/promises'), { join } = await import('node:path'), { tmpdir } = await import('node:os')
  const dir = await mkdtemp(join(tmpdir(), 'morse-photo-')), path = join(dir, 'a.png')
  await writeFile(path, png)
  const draft = await staging.pick('c1', 'media', () => true, async () => [path])
  assert.ok(draft)
  const jpeg = new Uint8Array(Buffer.concat([Buffer.from([255, 216, 255, 224]), Buffer.alloc(40, 7)]))
  const next = staging.replaceImage('c1', draft!.id, draft!.items[0]!.id, jpeg)
  assert.equal(next.items[0]!.size, jpeg.byteLength)
  const { parts } = staging.prepare('me', 'c1', draft!.id, '', [draft!.items[0]!.id])
  assert.equal(parts[0]!.upload.contentType, 'image/jpeg')
  assert.equal(parts[0]!.upload.sha256, createHash('sha256').update(jpeg).digest('hex'))
  assert.ok(parts[0]!.upload.path.endsWith('.jpg'))
  assert.throws(() => staging.replaceImage('c1', draft!.id, draft!.items[0]!.id, new Uint8Array(png)), 'only a JPEG replaces')
  staging.clear()
})
