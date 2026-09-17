import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decodeInquiryMessage } from '../../src/main/accounts/channel-inquiries'
import { storageBucket } from '../../src/main/media/media-document'
import { documents, type FirestoreDocument } from '../../src/main/network/firestore-values'

// iOS sends videos, voice messages and files in a channel inquiry as well as photos
// (ChannelInquiryChatView), all under inquiry_files. Each is read with what a chat message carries,
// so the panel can show and open it the way a chat does.
const inquiry = { id: 'channel1_subscriber1', cutoff: null }
const url = (id: string, ext: string) => `https://firebasestorage.googleapis.com/v0/b/${storageBucket}/o/${encodeURIComponent(`inquiry_files/${inquiry.id}/${id}.${ext}`)}?alt=media&token=1d7f0f9e-0000-4000-8000-0f9e1d7f0f9e`
const message = (id: string, fields: Record<string, unknown>): FirestoreDocument => ({
  name: `${documents}/channelInquiries/${inquiry.id}/messages/${id}`, updateTime: { seconds: '5', nanos: 0 },
  fields: { senderId: { stringValue: 'owner1' }, senderType: { stringValue: 'owner' }, createdAt: { timestampValue: { seconds: '1750000000', nanos: 0 } }, ...fields }
} as unknown as FirestoreDocument)

test('a video arrives with its size, length, placeholder and caption', () => {
  const item = decodeInquiryMessage(message('V1', { type: { stringValue: 'video' }, mediaUrl: { stringValue: url('V1', 'mp4') }, videoCaption: { stringValue: '영상 설명' },
    videoWidthPx: { integerValue: '1280' }, videoHeightPx: { integerValue: '720' }, videoDuration: { integerValue: '42' }, thumbData: { stringValue: 'QUJD' } }), inquiry, 'subscriber1')
  assert.equal(item?.kind, 'video')
  assert.equal(item?.text, '영상 설명')
  assert.equal(item?.attachments?.[0]?.available, true)
  assert.deepEqual(item?.mediaMetadata, { videoWidthPx: 1280, videoHeightPx: 720, videoDuration: 42, thumbData: 'QUJD' })
  assert.equal(item?.circular, undefined)
})

test('a round video is marked as one', () => {
  const item = decodeInquiryMessage(message('V2', { type: { stringValue: 'video' }, mediaUrl: { stringValue: url('V2', 'mp4') }, isCircleVideo: { booleanValue: true },
    videoWidthPx: { integerValue: '480' }, videoHeightPx: { integerValue: '480' } }), inquiry, 'subscriber1')
  assert.equal(item?.circular, true)
  assert.equal(item?.mediaMetadata?.isCircleVideo, true)
})

test('a voice message arrives with its length and waveform', () => {
  const item = decodeInquiryMessage(message('A1', { type: { stringValue: 'voice' }, mediaUrl: { stringValue: url('A1', 'm4a') }, voiceDuration: { integerValue: '7' },
    voiceWaveform: { arrayValue: { values: [{ doubleValue: 0.1 }, { doubleValue: 0.9 }] } } }), inquiry, 'owner1')
  assert.equal(item?.own, true)
  assert.deepEqual(item?.mediaMetadata, { voiceDuration: 7, voiceWaveform: [0.1, 0.9] })
})

test('a file arrives with its name and something to open', () => {
  const item = decodeInquiryMessage(message('F1', { type: { stringValue: 'file' }, mediaUrl: { stringValue: url('F1', 'pdf') }, fileName: { stringValue: '안내서.pdf' } }), inquiry, 'subscriber1')
  assert.equal(item?.label, '안내서.pdf')
  assert.equal(item?.attachments?.length, 1)
  assert.equal(item?.mediaMetadata, undefined)
})

test('a text message carries no attachment information', () => {
  const item = decodeInquiryMessage(message('T1', { type: { stringValue: 'text' }, text: { stringValue: '안녕하세요' } }), inquiry, 'subscriber1')
  assert.equal(item?.text, '안녕하세요')
  assert.equal(item?.attachments, undefined)
  assert.equal(item?.mediaMetadata, undefined)
})
