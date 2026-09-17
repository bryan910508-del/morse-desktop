import assert from 'node:assert/strict'
import { test } from 'node:test'
import { messageMediaMetadata } from '../../src/main/media/message-media-metadata'
import { mediaMetadata } from '../../src/shared/media-metadata'
import type { FirestoreDocument } from '../../src/main/network/firestore-values'

// Telegram shows a stripped placeholder before the picture itself arrives. Morse carries it in
// thumbData, so it has to survive the whole way from the message document to the bubble - and a
// placeholder this reader cannot use must never cost the picture its shape.
const thumb = Buffer.from('placeholder bytes that stand in for a tiny JPEG').toString('base64')
const photo = (over: Record<string, unknown> = {}): FirestoreDocument => ({
  name: 'projects/talky-a38c3/databases/(default)/documents/chats/c1/messages/m1',
  fields: { mediaWidthPx: { integerValue: '900' }, mediaHeightPx: { integerValue: '1600' },
    thumbData: { stringValue: thumb }, ...over } as FirestoreDocument['fields']
})

test('a photo carries its placeholder and its shape out of the message document', () => {
  const metadata = messageMediaMetadata(photo(), 'image', 1, false)
  assert.deepEqual(metadata, { mediaWidthPx: 900, mediaHeightPx: 1600, thumbData: thumb })
})

test('a placeholder this reader cannot use is left out, and the shape still arrives', () => {
  for (const value of [{ stringValue: 'not base64!' }, { stringValue: '' }, { stringValue: 'A'.repeat(100_001) },
    { integerValue: '5' }, { stringValue: 'AAAA'.repeat(2) + '=====' }]) {
    const metadata = messageMediaMetadata(photo({ thumbData: value }), 'image', 1, false)
    assert.deepEqual(metadata, { mediaWidthPx: 900, mediaHeightPx: 1600 }, `unreadable placeholder: ${JSON.stringify(value)}`)
  }
})

test('a photo sent without a placeholder is read exactly as before', () => {
  const fields = { mediaWidthPx: { integerValue: '900' }, mediaHeightPx: { integerValue: '1600' } }
  const metadata = messageMediaMetadata({ name: photo().name, fields } as FirestoreDocument, 'image', 1, false)
  assert.deepEqual(metadata, { mediaWidthPx: 900, mediaHeightPx: 1600 })
})

test('a placeholder belongs to a picture: photos, videos and stickers only', () => {
  assert.equal(mediaMetadata({ thumbData: thumb }, 'image', 1).thumbData, thumb)
  assert.equal(mediaMetadata({ thumbData: thumb }, 'video', 1).thumbData, thumb)
  assert.equal(mediaMetadata({ thumbData: thumb }, 'sticker', 1).thumbData, thumb)
  for (const kind of ['file', 'voice', 'text']) assert.throws(() => mediaMetadata({ thumbData: thumb }, kind, 1))
})

test('an album keeps every picture size beside the placeholder of the first', () => {
  const metadata = messageMediaMetadata(photo({ imageWidthsPx: { arrayValue: { values: [{ integerValue: '900' }, { integerValue: '400' }] } },
    imageHeightsPx: { arrayValue: { values: [{ integerValue: '1600' }, { integerValue: '400' }] } } }), 'image', 2, false)
  assert.deepEqual(metadata, { mediaWidthPx: 900, mediaHeightPx: 1600, thumbData: thumb, imageWidthsPx: [900, 400], imageHeightsPx: [1600, 400] })
})

test('a video placeholder the size iOS sends arrives whole', () => {
  // iOS: AVAssetImageGenerator at 160px, JPEG quality 0.78. A busy 160x160 frame measured 21,296
  // base64 characters here, so anything the server accepts is read.
  const large = 'A'.repeat(21_296)
  const doc: FirestoreDocument = { name: photo().name, fields: { videoWidthPx: { integerValue: '1080' }, videoHeightPx: { integerValue: '1920' },
    videoDuration: { integerValue: '12' }, thumbData: { stringValue: large } } as FirestoreDocument['fields'] }
  assert.deepEqual(messageMediaMetadata(doc, 'video', 1, false), { videoWidthPx: 1080, videoHeightPx: 1920, videoDuration: 12, thumbData: large })
  assert.equal(mediaMetadata({ thumbData: 'A'.repeat(100_000) }, 'video', 1).thumbData?.length, 100_000)
  assert.throws(() => mediaMetadata({ thumbData: 'A'.repeat(100_001) }, 'video', 1))
})
