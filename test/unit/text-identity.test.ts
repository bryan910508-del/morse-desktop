import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { textDigest } from '../../src/main/messaging/text-identity'
import type { SendWire } from '../../src/shared/model'

const sha = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')

// The server stores sha256(JSON(canonical)) as payloadDigest; the fields below are in its order.
test('a video with a thumbnail and a forum topic digests exactly as the server does', () => {
  const wire = { id: 'v1', chatId: 'c1', senderId: 'me', type: 'video', text: '', mediaUrl: 'https://x/v.mp4', isSilent: false, isEncrypted: false, protocolVersion: 3,
    videoCaption: '설명', thumbData: 'QUJD', categoryId: 'general', replyToId: 'm0', videoDuration: 12, videoWidthPx: 1920, videoHeightPx: 1080, isCircleVideo: true } as unknown as SendWire
  assert.equal(textDigest(wire), sha({ type: 'video', text: '', isSilent: false, isEncrypted: false, mediaUrl: 'https://x/v.mp4', thumbData: 'QUJD', videoCaption: '설명',
    categoryId: 'general', replyToId: 'm0', videoDuration: 12, videoWidthPx: 1920, videoHeightPx: 1080, isCircleVideo: true }))
})

test('a plain text keeps the digest it always had', () => {
  const wire = { id: 't1', chatId: 'c1', senderId: 'me', type: 'text', text: '안녕', isSilent: true, isEncrypted: false, protocolVersion: 3, replyToId: 'm1' } as SendWire
  assert.equal(textDigest(wire), sha({ type: 'text', text: '안녕', isSilent: true, isEncrypted: false, replyToId: 'm1' }))
})
