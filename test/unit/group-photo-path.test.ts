import assert from 'node:assert/strict'
import { test } from 'node:test'
import { groupPhotoFields, groupPhotoStoragePath } from '../../src/main/accounts/group-photo'
import { storageBucket } from '../../src/main/media/media-document'
import type { FirestoreDocument } from '../../src/main/network/firestore-values'

// A channel discussion group is created with the channel's own photo address (server
// ensureDiscussionChat), which sits in the channel's public folder rather than the group's, so the
// chat list showed no picture at all. Only this room's own channel may be read that way.
const chatId = 'channel_discuss_1', uid = 'me', channelId = 'channel1'
const address = (path: string): string =>
  `https://firebasestorage.googleapis.com/v0/b/${storageBucket}/o/${encodeURIComponent(path)}?alt=media&token=1d7f0f9e-0000-4000-8000-0f9e1d7f0f9e`
const chat = (path: string, discussion: boolean): FirestoreDocument => ({
  name: `documents/chats/${chatId}`, updateTime: { seconds: '1', nanos: 0 },
  fields: { photoURL: { stringValue: address(path) }, ...(discussion ? { isChannelDiscussion: { booleanValue: true }, channelId: { stringValue: channelId } } : {}) }
} as unknown as FirestoreDocument)

test('a discussion row reads the channel photo, current and legacy folders alike', () => {
  for (const root of ['channel_photos', 'channels']) {
    const path = `${root}/${channelId}/p.jpg`
    const fields = groupPhotoFields(chat(path, true))
    assert.equal(fields.channelId, channelId, 'the room names its channel')
    assert.equal(groupPhotoStoragePath(fields.raw!, chatId, uid, fields.channelId), path)
  }
})

test('another channel or a plain group cannot borrow the channel folder', () => {
  const foreign = `channel_photos/channel9/p.jpg`
  const discussion = groupPhotoFields(chat(foreign, true))
  assert.equal(groupPhotoStoragePath(discussion.raw!, chatId, uid, discussion.channelId), null)
  const plain = groupPhotoFields(chat(`channel_photos/${channelId}/p.jpg`, false))
  assert.equal(plain.channelId, null, 'a group without the discussion flag names no channel')
  assert.equal(groupPhotoStoragePath(plain.raw!, chatId, uid, plain.channelId), null)
})

test('a group keeps its own folder and its creation draft', () => {
  const own = `group_photos/${chatId}/p.jpg`
  assert.equal(groupPhotoStoragePath(address(own), chatId, uid, null), own)
  const draft = `group_photos_draft/${uid}/p.jpg`
  assert.equal(groupPhotoStoragePath(address(draft), chatId, uid, null), draft)
  assert.equal(groupPhotoStoragePath(address(`group_photos/other/p.jpg`), chatId, uid, null), null)
})
