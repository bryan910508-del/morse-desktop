import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decodeInquiryMessage, inquiryAttachmentFields } from '../../src/main/accounts/channel-inquiries'
import { documents, type FirestoreDocument, type WireObject } from '../../src/main/network/firestore-values'

// B222 (contracts/B222-inquiry-video-caption.md): a picture's or a video's caption reads the same on the three apps —
// `text` unless it is the media itself, else the mirror field (iOS MorseInquiryMessageMapper.videoCaption, c444f691).
const url = 'https://firebasestorage.googleapis.com/v0/b/x/o/inquiry_files%2Finq1%2Fv.mp4?alt=media'
const s = (value: string): WireObject => ({ stringValue: value })
function caption(kind: 'video' | 'image', fields: Record<string, string | undefined>): string {
  const wire: Record<string, WireObject> = { createdAt: { timestampValue: { seconds: String(Math.floor(Date.now() / 1000) - 60), nanos: 0 } }, senderId: s('peer1'), type: s(kind) }
  for (const [key, value] of Object.entries(fields)) if (value !== undefined) wire[key] = s(value)
  const doc = { name: `${documents}/channelInquiries/inq1/messages/m1`, updateTime: { seconds: '5', nanos: 0 }, fields: wire } as unknown as FirestoreDocument
  return decodeInquiryMessage(doc, { id: 'inq1', cutoff: null }, 'me1')!.text
}

test('every app\'s video caption, as each sends it, reaches the bubble', () => {
  const rows: [string, Record<string, string | undefined>, string][] = [
    ['iOS: text', { mediaUrl: url, text: 'Hi' }, 'Hi'],
    ['Desktop: text and videoCaption', { mediaUrl: url, text: 'Hi', videoCaption: 'Hi' }, 'Hi'],
    ['Android: the address in text, videoCaption', { mediaUrl: url, text: url, videoCaption: 'Hi' }, 'Hi'],
    ['edited on any app: text only', { mediaUrl: url, text: 'New', videoCaption: 'Old' }, 'New'],
    ['no caption', { mediaUrl: url, text: '' }, ''],
    ['empty text: the mirror', { mediaUrl: url, text: '', videoCaption: 'Hi' }, 'Hi'],
    ['spaces around are dropped', { mediaUrl: url, text: '  Hi  ' }, 'Hi'],
  ]
  for (const [name, fields, expected] of rows) assert.equal(caption('video', fields), expected, name)
})

test('only the video itself is not a caption; a link the sender wrote is', () => {
  const rows: [string, string | undefined, string, string][] = [
    ['a link', url, 'https://example.com/a', 'https://example.com/a'],
    ['words with a link', url, 'see https://example.com/a', 'see https://example.com/a'],
    ['another inquiry\'s path', url, 'inquiry_files/other/v.mp4', 'inquiry_files/other/v.mp4'],
    ['gs://', url, 'gs://bucket/inquiry_files/inq1/v.mp4', 'M'],
    ['GS:// any case', url, 'GS://bucket/v.mp4', 'M'],
    ['a Firebase download URL', url, 'https://firebasestorage.googleapis.com/v0/b/x/o/other.mp4', 'M'],
    ['with a port', url, 'https://firebasestorage.googleapis.com:443/v0/b/x/o/other.mp4', 'M'],
    ['this inquiry\'s inquiry_files path', url, 'inquiry_files/inq1/v.mp4', 'M'],
    ['inquiry_media', url, 'inquiry_media/inq1/v.mp4', 'M'],
    ['inquiry_videos', url, 'inquiry_videos/inq1/v.mp4', 'M'],
    ['text equal to mediaUrl', 'vid_local', 'vid_local', 'M'],
    ['no mediaUrl: text is where the video is', undefined, 'https://example.com/v.mp4', 'M'],
  ]
  for (const [name, mediaUrl, text, expected] of rows) assert.equal(caption('video', { mediaUrl, text, videoCaption: 'M' }), expected, name)
})

test('a picture reads the same way with imageCaption', () => {
  assert.equal(caption('image', { mediaUrl: url, imageCaption: 'Pic' }), 'Pic', 'Desktop and iOS before: imageCaption only')
  assert.equal(caption('image', { mediaUrl: url, text: 'Edited', imageCaption: 'Pic' }), 'Edited', 'text first')
  assert.equal(caption('image', { mediaUrl: url, text: url, imageCaption: 'Pic' }), 'Pic', 'the address in text')
  assert.equal(caption('image', { mediaUrl: url, videoCaption: 'V' }), '', 'a picture never reads videoCaption')
})

test('Desktop still sends a video\'s caption as text and videoCaption (§2)', () => {
  assert.deepEqual(inquiryAttachmentFields('video', 'v.mp4', 10, 'Hi', null), { type: 'video', text: 'Hi', videoCaption: 'Hi' })
  assert.deepEqual(inquiryAttachmentFields('video', 'v.mp4', 10, '', null), { type: 'video', text: '' })
})
