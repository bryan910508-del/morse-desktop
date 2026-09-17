import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mediaResources } from '../../src/main/media/media-document'
import { channelPostCardPath } from '../../src/main/media/channel-post-media-document'
import { documents, type FirestoreDocument, type WireObject } from '../../src/main/network/firestore-values'

// onChannelPostCreated mirrors a channel post into its discussion room as a system message whose thumbnailUrl points
// at the post's own picture, under the channel's folder. storage.rules reads there are authorizedMediaRead, so the
// card's picture carries the post it belongs to and is fetched through that grant.
const bucket = 'talky-a38c3.firebasestorage.app'
const card = (fields: Record<string, WireObject>): FirestoreDocument => ({
  name: `${documents}/chats/channel_discuss_ch1/messages/chpost_post1`, updateTime: { seconds: '3', nanos: 0 },
  fields: { type: { stringValue: 'channelPost' }, channelId: { stringValue: 'ch1' }, channelPostId: { stringValue: 'post1' }, ...fields }
} as unknown as FirestoreDocument)

test('a channel post card carries the post picture, with the post it needs a grant for', () => {
  const picture = mediaResources(card({ thumbnailUrl: { stringValue: `gs://${bucket}/channel_posts/ch1/a.jpg` } }), 'channel_discuss_ch1', 'channelPost', false)
  assert.equal(picture.length, 1)
  assert.equal(picture[0]!.path, 'channel_posts/ch1/a.jpg')
  assert.equal(picture[0]!.grantPostId, 'post1')
  assert.equal(picture[0]!.summary.kind, 'image')
  assert.equal(picture[0]!.summary.available, true)
  const video = mediaResources(card({ thumbnailUrl: { stringValue: `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent('channel_video_thumbs/ch1/v.jpg')}` } }), 'channel_discuss_ch1', 'channelPost', false)
  assert.equal(video[0]!.path, 'channel_video_thumbs/ch1/v.jpg', 'a video post card shows the video\'s thumbnail')
})

test('a card picture from another channel, another folder or an encrypted room is not read', () => {
  assert.deepEqual(mediaResources(card({ thumbnailUrl: { stringValue: `gs://${bucket}/channel_posts/other/a.jpg` } }), 'channel_discuss_ch1', 'channelPost', false), [])
  assert.deepEqual(mediaResources(card({ thumbnailUrl: { stringValue: `gs://${bucket}/chat_media/ch1/a.jpg` } }), 'channel_discuss_ch1', 'channelPost', false), [])
  assert.deepEqual(mediaResources(card({}), 'channel_discuss_ch1', 'channelPost', false), [], 'a card without a picture shows none')
  assert.deepEqual(mediaResources(card({ thumbnailUrl: { stringValue: `gs://${bucket}/channel_posts/ch1/a.jpg` } }), 'channel_discuss_ch1', 'channelPost', true), [], 'a secret room reads nothing')
  assert.equal(channelPostCardPath(`gs://${bucket}/channel_posts/ch1/a.jpg`, 'ch1'), 'channel_posts/ch1/a.jpg')
  assert.equal(channelPostCardPath(`gs://${bucket}/channel_photos/ch1/a.jpg`, 'ch1'), null, 'only a post\'s own folders')
  assert.equal(channelPostCardPath('not an address', 'ch1'), null)
})

test('an ordinary message is unaffected', () => {
  const photo = mediaResources({ name: `${documents}/chats/chat1/messages/m1`, updateTime: { seconds: '1', nanos: 0 },
    fields: { type: { stringValue: 'image' }, mediaUrl: { stringValue: `gs://${bucket}/chat_media/chat1/m1.jpg` } } } as unknown as FirestoreDocument, 'chat1', 'image', false)
  assert.equal(photo[0]!.path, 'chat_media/chat1/m1.jpg')
  assert.equal(photo[0]!.grantPostId, undefined, 'a chat photo needs no grant')
})
