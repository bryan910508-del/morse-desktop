import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AttachmentStaging } from '../../src/main/media/attachment-staging'
import { VoiceCaptures } from '../../src/main/platform/voice-captures'
import { mediaMetadata } from '../../src/shared/media-metadata'
import { roundVideoFacts, roundVideoSendRequest, roundVideoSide } from '../../src/shared/round-video'

// A video message recorded in the window (Telegram's RoundVideoRecorder: 400px square, 60 seconds) goes out
// as a round video, and only a grant reserved for a video message may open the camera.
const mp4 = (): Uint8Array => new Uint8Array(Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(300, 3)]))

test('a video message is sent as a circle with its square size, whole seconds and thumbnail', () => {
  const staging = new AttachmentStaging()
  const draft = staging.adopt('chat1', mp4(), 'video-message.mp4')
  assert.equal(draft.kind, 'video')
  const { wire, parts } = staging.prepare('me', 'chat1', draft.id, '', [draft.items[0]!.id], { duration: 12.4, width: roundVideoSide, height: roundVideoSide, thumb: 'QUJD' }, true)
  assert.equal(wire.isCircleVideo, true)
  assert.equal(wire.videoWidthPx, 400)
  assert.equal(wire.videoHeightPx, 400)
  assert.equal(wire.videoDuration, 12)
  assert.equal(wire.thumbData, 'QUJD')
  assert.equal(parts[0]!.upload.path, `chat_videos/chat1/${draft.id}.mp4`)
  const { videoWidthPx, videoHeightPx, videoDuration, thumbData, isCircleVideo } = wire
  assert.deepEqual(mediaMetadata({ videoWidthPx, videoHeightPx, videoDuration, thumbData, isCircleVideo }, 'video', 1).isCircleVideo, true)
  staging.clear()
})

test('a picked video is never marked round, and a recording that is not a video is refused', () => {
  const staging = new AttachmentStaging()
  const draft = staging.adopt('chat1', mp4(), 'clip.mp4')
  assert.equal(staging.prepare('me', 'chat1', draft.id, '', [draft.items[0]!.id], { duration: 3, width: 1280, height: 720, thumb: '' }, true).wire.isCircleVideo, undefined, 'not a square')
  assert.equal(staging.prepare('me', 'chat1', draft.id, '', [draft.items[0]!.id], { duration: 3, width: 400, height: 400, thumb: '' }).wire.isCircleVideo, undefined, 'not asked for')
  assert.throws(() => staging.adopt('chat1', mp4(), 'again.mp4'), 'one selection at a time')
  staging.clear()
  assert.throws(() => staging.adopt('chat1', new Uint8Array(Buffer.from('RIFF....WEBPVP8 ' + 'x'.repeat(20))), 'x.webp'))
  staging.clear()
})

test('the send request carries a real length and a thumbnail the server keeps', () => {
  const valid = { id: '44c07cbb-c781-4c23-98e0-51f98c1488ed', chatId: 'chat1', duration: 2.24, thumb: 'QUJD', reply: null }
  assert.deepEqual(roundVideoSendRequest(valid), valid)
  for (const bad of [{ ...valid, duration: 0.2 }, { ...valid, duration: 75 }, { ...valid, thumb: 'no base64!' }, { ...valid, id: 'NOT-A-UUID' }, { ...valid, extra: 1 }])
    assert.throws(() => roundVideoSendRequest(bad), JSON.stringify(bad).slice(0, 60))
  assert.deepEqual(roundVideoFacts({ duration: 59.9, thumb: '' }), { duration: 59.9, thumb: '' })
})

test('the camera opens only under a grant reserved for a video message', () => {
  const owner = { validate: () => {} }
  const voice = new VoiceCaptures(() => {})
  const audio = { id: '0bf88632-7166-4c75-9c45-da9fb406aefa', chatId: 'chat1' }
  voice.reserve(owner, audio, voice.generationToken()); voice.permissionReady(audio)
  assert.equal(voice.permissionAllowed('audio'), true)
  assert.equal(voice.permissionAllowed('video'), false, 'a voice recording never opens the camera')
  assert.equal(voice.mediaOf(audio), 'audio')
  voice.clear()
  const video = new VoiceCaptures(() => {})
  video.reserve(owner, audio, video.generationToken(), 'video'); video.permissionReady(audio)
  assert.equal(video.permissionAllowed('video'), true)
  assert.equal(video.permissionAllowed('audio'), true, 'a video message records sound too')
  assert.equal(video.mediaOf(audio), 'video')
  video.activate(audio)
  assert.equal(video.permissionAllowed('video'), false, 'the grant opens the devices, it does not keep them open')
  video.complete(audio)
})
