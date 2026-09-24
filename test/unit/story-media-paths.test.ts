import assert from 'node:assert/strict'
import { test } from 'node:test'
import { storyMediaPaths } from '../../src/main/accounts/story-media-paths'
import type { FirestoreDocument } from '../../src/main/network/firestore-values'

// stories.getPeerStories already tells Telegram where each story's media is, and it downloads that
// without reading the story again. The list read here carries the same addresses.
const bucket = 'talky-a38c3.firebasestorage.app'
const doc = (fields: Record<string, unknown>): FirestoreDocument => ({ name: 'stories/story1', fields: fields as FirestoreDocument['fields'] })

test('a photo story gives its image, and nothing it does not have', () => {
  const paths = storyMediaPaths(doc({ mediaType: { stringValue: 'image' }, mediaURL: { stringValue: `gs://${bucket}/stories/user/owner1/photo.jpg` } }), 'owner1')
  assert.equal(paths.image, 'stories/user/owner1/photo.jpg')
  assert.equal(paths.video, null)
  assert.equal(paths.poster, null)
  assert.equal(paths.audio, null)
})

test('a video story gives the video, its poster and its sound', () => {
  const paths = storyMediaPaths(doc({
    mediaType: { stringValue: 'video' },
    mediaURL: { stringValue: `gs://${bucket}/stories/user/owner1/clip.mp4` },
    thumbnailURL: { stringValue: `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent('stories/user/owner1/clip.jpg')}` },
    audioURL: { stringValue: `gs://${bucket}/stories/user/owner1/clip.wav` },
  }), 'owner1')
  assert.equal(paths.video, 'stories/user/owner1/clip.mp4')
  assert.equal(paths.poster, 'stories/user/owner1/clip.jpg')
  assert.equal(paths.audio, 'stories/user/owner1/clip.wav')
  assert.equal(paths.image, null, 'a video has no still image of its own')
})

test('an address that is not this owner’s, or not a story at all, is left out', () => {
  const someoneElse = storyMediaPaths(doc({ mediaType: { stringValue: 'image' }, mediaURL: { stringValue: `gs://${bucket}/stories/user/other/photo.jpg` } }), 'owner1')
  assert.deepEqual(someoneElse, { image: null, poster: null, video: null, audio: null })
  const elsewhere = storyMediaPaths(doc({ mediaType: { stringValue: 'image' }, mediaURL: { stringValue: 'https://example.com/photo.jpg' } }), 'owner1')
  assert.equal(elsewhere.image, null, 'the viewer reads the story itself when the list cannot say')
})
