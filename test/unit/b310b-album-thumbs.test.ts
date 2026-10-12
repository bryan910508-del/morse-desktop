import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { nativeImage } from 'electron'
import { albumPlaceholder, albumThumbs, mediaMetadata } from '../../src/shared/media-metadata'
import { messageMediaMetadata } from '../../src/main/media/message-media-metadata'
import { textDigest, textDigestMatches } from '../../src/main/messaging/text-identity'
import { AttachmentStaging } from '../../src/main/media/attachment-staging'
import type { FirestoreDocument } from '../../src/main/network/firestore-values'
import type { SendWire } from '../../src/shared/model'

// B310ⓑ (contracts/B310b-album-per-photo-thumbs.md): every photo of an album carries its own placeholder (thumbDatas, in
// mediaKeys order, "" where none was made); thumbData stays the first one's.
test('what thumbDatas may hold: no more than the photos, strings within the bound', () => {
  assert.deepEqual(albumThumbs(['QUJD', ''], 2), ['QUJD', ''])
  assert.deepEqual(albumThumbs(['QUJD'], 3), ['QUJD'], 'fewer than the photos: the rest have none')
  assert.equal(albumThumbs(['a', 'b', 'c'], 2), null)
  assert.equal(albumThumbs(['A'.repeat(16_385)], 1), null)
  assert.equal(albumThumbs([1], 1), null)
  assert.equal(albumThumbs(['not base64!'], 1), null)
  assert.deepEqual(mediaMetadata({ thumbData: 'QUJD', thumbDatas: ['QUJD', 'REVG'] }, 'image', 2), { thumbData: 'QUJD', thumbDatas: ['QUJD', 'REVG'] })
  assert.throws(() => mediaMetadata({ thumbDatas: ['QUJD'] }, 'video', 1), 'a photo album\'s only')
})

const doc = (fields: Record<string, unknown>): FirestoreDocument => ({ name: 'x', fields } as unknown as FirestoreDocument)
const list = (...items: string[]) => ({ arrayValue: { values: items.map(stringValue => ({ stringValue })) } })
test('read from the message: each photo its own; a malformed list is left out and the rest stays', () => {
  assert.deepEqual(messageMediaMetadata(doc({ thumbData: { stringValue: 'QUJD' }, thumbDatas: list('QUJD', '', 'R0hJ') }), 'image', 3, false), { thumbData: 'QUJD', thumbDatas: ['QUJD', '', 'R0hJ'] })
  assert.deepEqual(messageMediaMetadata(doc({ thumbData: { stringValue: 'QUJD' }, thumbDatas: list('QUJD', 'R0hJ', 'x', 'y') }), 'image', 3, false), { thumbData: 'QUJD' })
})

test('each tile\'s placeholder: thumbDatas[i], else the first falls back to thumbData, any other has none', () => {
  const both = { thumbData: 'QUJD', thumbDatas: ['QUJD', '', 'R0hJ'] }
  assert.deepEqual([0, 1, 2].map(index => albumPlaceholder(both, index)), ['QUJD', '', 'R0hJ'])
  assert.deepEqual([0, 1].map(index => albumPlaceholder({ thumbData: 'QUJD' }, index)), ['QUJD', ''], 'an older album: no longer the first photo\'s colours on the second')
})

test('the digest puts thumbDatas where the server does; a digest stored without them is another message (B253: no loosening)', () => {
  const wire = { id: 'm1', chatId: 'c1', senderId: 'me', type: 'image', text: '', mediaUrl: '', isSilent: false, isEncrypted: false, protocolVersion: 3,
    mediaKeys: ['a', 'b'], thumbData: 'QUJD', thumbDatas: ['QUJD', 'R0hJ'] } as unknown as SendWire
  const { thumbDatas: _thumbs, ...older } = wire as unknown as Record<string, unknown>
  assert.notEqual(textDigest(wire), textDigest(older as unknown as SendWire))
  assert.equal(textDigestMatches(wire, textDigest(wire)), true)
  assert.equal(textDigestMatches(wire, textDigest(older as unknown as SendWire)), false, 'the server allowing thumbDatas goes out before the apps (review 21:3x)')
})

const crc = (bytes: Buffer): number => { let c = ~0; for (const b of bytes) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)) } return ~c >>> 0 }
const chunk = (type: string, data: Buffer): Buffer => { const body = Buffer.concat([Buffer.from(type), data]); const out = Buffer.alloc(8 + data.length + 4); out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc(body), 8 + data.length); return out }
const png = (shade: number): Buffer => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]),
  chunk('IHDR', Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0])), chunk('IDAT', deflateSync(Buffer.from([0, shade, 0, 0]))), chunk('IEND', Buffer.alloc(0))])
test('an album sent from here carries one per photo, the first being thumbData', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'morse-b310b-')), paths = [join(dir, 'a.png'), join(dir, 'b.png')]
  await writeFile(paths[0]!, png(10)); await writeFile(paths[1]!, png(200))
  const original = nativeImage.createFromBuffer
  ;(nativeImage as { createFromBuffer: unknown }).createFromBuffer = (bytes: Buffer) => {
    const image = { getSize: () => ({ width: 4, height: 3 }), resize: () => image, toJPEG: () => Buffer.from(`t${bytes.length}:${bytes[bytes.length - 20]}`) }
    return image
  }
  const staging = new AttachmentStaging()
  try {
    const draft = await staging.pick('chat1', 'media', () => true, async () => paths)
    const { wire } = staging.prepare('me', 'chat1', draft!.id, '', draft!.items.map(item => item.id))
    assert.equal(wire.thumbDatas?.length, 2)
    assert.equal(wire.thumbData, wire.thumbDatas![0])
    assert.notEqual(wire.thumbDatas![0], wire.thumbDatas![1], 'each photo its own')
  } finally { (nativeImage as { createFromBuffer: unknown }).createFromBuffer = original; staging.clear(); await rm(dir, { recursive: true, force: true }) }
})
