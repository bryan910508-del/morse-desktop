import assert from 'node:assert/strict'
import { test } from 'node:test'
import { inquiryVoiceFields } from '../../src/main/accounts/channel-inquiries'
import { forwardMediaFormat } from '../../src/main/media/forward-media-format'
import { inquiryAttachmentPath } from '../../src/main/network/inquiry-photo-upload-api'
import { inquiryVoiceRequest, inquiryVoiceTarget } from '../../src/shared/channel-inquiries'
import { VoiceCaptures } from '../../src/main/platform/voice-captures'

// ChannelInquiryChatView.uploadAndSendVoice: an M4A recording in inquiry_files, sent with no text, its
// whole seconds (at least one) and the 36 levels MorseVoiceRecordingSession keeps.
const inquiryId = 'channel1_subscriber1', messageId = 'AC470EC9-6603-4992-9160-C9B1CC7AB14E'
const valid = { requestId: 'f8d2d858-65d6-446e-b4fe-948a81589389', inquiryId, messageId, duration: 1.94, waveform: Array.from({ length: 36 }, (_, index) => index / 35), captureId: '0bf88632-7166-4c75-9c45-da9fb406aefa', sha256: 'b'.repeat(64) }

test('a voice message is stored as .m4a in the room', () => {
  assert.equal(inquiryAttachmentPath(inquiryId, messageId, 'm4a'), `inquiry_files/${inquiryId}/${messageId}.m4a`)
})

test('it says what iOS says: no text, whole seconds with at least one, and the levels', () => {
  assert.deepEqual(inquiryVoiceFields('https://x', 1.94, [0.08, 0.6543, 1]), { type: 'voice', mediaUrl: 'https://x', voiceDuration: 2, voiceWaveform: [0.08, 0.654, 1] })
  assert.equal(inquiryVoiceFields('https://x', 0.6, [0.1]).voiceDuration, 1)
  assert.equal('text' in inquiryVoiceFields('https://x', 3, [0.1]), false)
})

test('the send request is a real recording length and waveform', () => {
  assert.deepEqual(inquiryVoiceRequest(valid), valid)
  for (const bad of [{ ...valid, duration: 0.3 }, { ...valid, duration: 90 }, { ...valid, duration: Number.NaN }, { ...valid, waveform: [] },
    { ...valid, waveform: [1.5] }, { ...valid, waveform: Array(65).fill(0.1) }, { ...valid, waveform: ['0.2'] }, { ...valid, messageId: messageId.toLowerCase() }, { ...valid, text: 'x' }, { ...valid, captureId: 'NOT-A-UUID' }, { ...valid, sha256: 'not-a-hash' }, (({ sha256: _unused, ...rest }) => rest)(valid)])
    assert.throws(() => inquiryVoiceRequest(bad), `refused: ${JSON.stringify(bad).slice(0, 80)}`)
})

test("only an M4A the recorder makes is accepted as a voice message", () => {
  const recorded = Buffer.concat([Buffer.from([0, 0, 0, 36]), Buffer.from('ftypisom'), Buffer.alloc(40, 1)])
  assert.equal(forwardMediaFormat('voice', recorded).extension, 'm4a')
  assert.throws(() => forwardMediaFormat('voice', Buffer.from('RIFF....WAVEfmt ' + 'x'.repeat(40))))
})

// The microphone is only granted to a recording that holds a reservation for its open room, as a chat
// recording's is; sending an inquiry recording ends the grant straight away.
test('an inquiry recording holds the microphone grant from reservation until it is sent', () => {
  const revoked: string[] = []
  let roomOpen = true
  const captures = new VoiceCaptures(id => revoked.push(id))
  const target = inquiryVoiceTarget({ requestId: valid.requestId, inquiryId, captureId: valid.captureId })
  const capture = { id: target.captureId, chatId: target.inquiryId }
  assert.equal(captures.permissionAllowed(), false, 'no microphone without a reservation')
  captures.reserve({ validate: () => { if (!roomOpen) throw new Error('closed') } }, capture, captures.generationToken())
  assert.equal(captures.permissionAllowed(), false, 'not before the system permission is confirmed')
  captures.permissionReady(capture)
  assert.equal(captures.permissionAllowed(), true)
  assert.throws(() => captures.complete(capture), 'a reservation that never recorded is not a recording')
  captures.activate(capture)
  assert.equal(captures.permissionAllowed(), false, 'the grant is for opening the microphone, not for keeping it open')
  captures.complete(capture)
  assert.deepEqual(revoked, [capture.id])
  assert.throws(() => captures.complete(capture), 'a recording is sent once')
})

test('closing the room ends an inquiry recording before it can be sent', () => {
  let roomOpen = true
  const captures = new VoiceCaptures(() => {})
  const capture = { id: valid.captureId, chatId: inquiryId }
  captures.reserve({ validate: () => { if (!roomOpen) throw new Error('closed') } }, capture, captures.generationToken())
  captures.permissionReady(capture); captures.activate(capture)
  roomOpen = false
  assert.throws(() => captures.complete(capture))
  assert.throws(() => inquiryVoiceTarget({ requestId: valid.requestId, inquiryId, captureId: valid.captureId, extra: 1 }))
})

test('an inquiry recording is sent from the preview it was finished into, once', () => {
  const captures = new VoiceCaptures(() => {})
  const capture = { id: valid.captureId, chatId: inquiryId }
  captures.reserve({ validate: () => {} }, capture, captures.generationToken()); captures.permissionReady(capture); captures.activate(capture)
  const recording = new Uint8Array(Buffer.concat([Buffer.from([0, 0, 0, 36]), Buffer.from('ftypisom'), Buffer.alloc(40, 1)]))
  const preview = captures.finish(capture, recording)
  assert.match(preview.url, /^morse:\/\/app\/__voice-capture\//)
  assert.throws(() => captures.forSend(capture, 'c'.repeat(64)), 'another recording')
  assert.equal(captures.forSend(capture, preview.sha256).byteLength, recording.byteLength)
  assert.equal(captures.forSend(capture, preview.sha256).byteLength, recording.byteLength, 'a retry sends the same recording')
  captures.clear(capture.id)
  assert.throws(() => captures.forSend(capture, preview.sha256), 'gone once sent')
})
