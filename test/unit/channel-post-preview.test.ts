import assert from 'node:assert/strict'
import { test } from 'node:test'
import { blurThumb, channelPostMedia } from '../../src/main/media/channel-post-media-document'
import { documents, type FirestoreDocument, type WireObject } from '../../src/main/network/firestore-values'

// Telegram paints a message's own immediateThumbnailData (a tiny JPEG) blurred until the picture itself is there,
// and then the picture, at its own size. A post carries that thumb in thumbDataBase64 and its size in mediaWidthsPx.
// Posts written before those fields read exactly as they did.
const bucket = 'talky-a38c3.firebasestorage.app'
const gs = (path: string): WireObject => ({ stringValue: `gs://${bucket}/${path}` })
const array = (values: WireObject[]): WireObject => ({ arrayValue: { values } })
const numbers = (values: number[]): WireObject => array(values.map(value => ({ integerValue: String(value) })))
const tinyJpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 7), Buffer.from([0xff, 0xd9])]).toString('base64')
const post = (fields: Record<string, WireObject>): FirestoreDocument =>
  ({ name: `${documents}/channels/ch1/posts/post1`, updateTime: { seconds: '4', nanos: 0 }, fields } as unknown as FirestoreDocument)

test('a post carries its shape and its blurred thumb, and the list still draws the picture itself', () => {
  const media = channelPostMedia(post({
    mediaKeys: array([gs('channel_posts/ch1/a.jpg'), gs('channel_posts/ch1/b.jpg')]),
    mediaTypes: array([{ stringValue: 'image' }, { stringValue: 'image' }]),
    thumbDataBase64: array([{ stringValue: tinyJpeg }, { stringValue: '' }]),
    mediaWidthsPx: numbers([1440, 0]), mediaHeightsPx: numbers([1080, 0])
  }), 'ch1')
  assert.equal(media.items[0]!.path, 'channel_posts/ch1/a.jpg', 'the picture itself, in the list and in the post')
  assert.equal(media.items[0]!.blur, `data:image/jpeg;base64,${tinyJpeg}`)
  assert.equal(media.items[0]!.width, 1440); assert.equal(media.items[0]!.height, 1080)
  assert.equal(media.items[1]!.path, 'channel_posts/ch1/b.jpg')
  assert.equal(media.items[1]!.blur, '')
  assert.equal(media.items[1]!.width, undefined, 'an unknown size is not guessed')
})

test('a post from before these fields reads exactly as it did, and a video keeps its own thumbnail', () => {
  const plain = channelPostMedia(post({ mediaKeys: array([gs('channel_posts/ch1/a.jpg')]), mediaTypes: array([{ stringValue: 'image' }]) }), 'ch1')
  assert.equal(plain.items[0]!.available, true)
  assert.equal(plain.items[0]!.blur, '')
  const video = channelPostMedia(post({
    mediaKeys: array([gs('channel_videos/ch1/v.mp4')]), mediaTypes: array([{ stringValue: 'video' }]),
    thumbnailKeys: array([gs('channel_video_thumbs/ch1/v.jpg')])
  }), 'ch1')
  assert.equal(video.items[0]!.path, 'channel_video_thumbs/ch1/v.jpg')
  assert.equal(video.items[0]!.videoPath, 'channel_videos/ch1/v.mp4')
})

test('a picture of another channel is not read, and only a real thumb is drawn', () => {
  const other = channelPostMedia(post({
    mediaKeys: array([gs('channel_posts/other/a.jpg')]), mediaTypes: array([{ stringValue: 'image' }])
  }), 'ch1')
  assert.equal(other.items[0]!.available, false, 'a picture under another channel is refused')
  assert.equal(blurThumb({ stringValue: tinyJpeg }), `data:image/jpeg;base64,${tinyJpeg}`)
  assert.equal(blurThumb({ stringValue: 'iVBORw0KGgo=' }), '', 'only a JPEG thumb')
  assert.equal(blurThumb({ stringValue: `${tinyJpeg}<script>` }), '')
  assert.equal(blurThumb({ stringValue: `/9j/${'A'.repeat(5000)}` }), '', 'a thumb this large is not a thumb')
  assert.equal(blurThumb({ stringValue: '' }), '')
  assert.equal(blurThumb(undefined), '')
})
