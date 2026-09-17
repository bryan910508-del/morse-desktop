import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mediaResources, storageBucket } from '../../src/main/media/media-document'
import type { FirestoreDocument } from '../../src/main/network/firestore-values'

// A channel inquiry keeps its attachments under the inquiry_* prefixes the server manages, with the
// room id in the middle segment; a chat keeps them under chat_*. Neither scope may accept the other's.
const inquiryId = 'channel1_subscriber1', chatId = 'chat1', messageId = 'M1'
const downloadURL = (path: string): string =>
  `https://firebasestorage.googleapis.com/v0/b/${storageBucket}/o/${encodeURIComponent(path)}?alt=media&token=1d7f0f9e-0000-4000-8000-0f9e1d7f0f9e`
const photo = (path: string): FirestoreDocument => ({
  name: `documents/messages/${messageId}`, updateTime: { seconds: '1', nanos: 0 },
  fields: { type: { stringValue: 'image' }, mediaUrl: { stringValue: downloadURL(path) }, text: { stringValue: downloadURL(path) } }
} as unknown as FirestoreDocument)
const first = (doc: FirestoreDocument, room: string, scope: 'chat' | 'inquiry') => mediaResources(doc, room, 'image', false, scope)[0]

test('an inquiry photo uploaded by any client is available in that room', () => {
  for (const root of ['inquiry_files', 'inquiry_media', 'inquiry_videos']) {
    const resource = first(photo(`${root}/${inquiryId}/${messageId}.jpg`), inquiryId, 'inquiry')
    assert.equal(resource?.path, `${root}/${inquiryId}/${messageId}.jpg`, `${root} belongs to the room`)
    assert.equal(resource?.summary.available, true)
  }
})

test('an inquiry photo from another room or another prefix stays unavailable', () => {
  const foreign = first(photo(`inquiry_files/channel9_subscriber9/${messageId}.jpg`), inquiryId, 'inquiry')
  assert.equal(foreign?.path, null)
  assert.equal(foreign?.summary.available, false)
  const chatRoot = first(photo(`chat_media/${inquiryId}/${messageId}.jpg`), inquiryId, 'inquiry')
  assert.equal(chatRoot?.path, null)
})

test('a chat keeps its own prefixes and refuses an inquiry one', () => {
  const chat = first(photo(`chat_media/${chatId}/${messageId}.jpg`), chatId, 'chat')
  assert.equal(chat?.path, `chat_media/${chatId}/${messageId}.jpg`)
  assert.equal(chat?.summary.available, true)
  const inquiryRoot = first(photo(`inquiry_files/${chatId}/${messageId}.jpg`), chatId, 'chat')
  assert.equal(inquiryRoot?.path, null)
})
