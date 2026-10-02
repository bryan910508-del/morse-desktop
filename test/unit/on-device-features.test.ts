import assert from 'node:assert/strict'
import { test } from 'node:test'
import { onDeviceFeatures, translationMessage } from '../../src/shared/translation'

// B51: on Windows and on Macs before macOS 26, «전체번역» was offered and did nothing. What this device can do is known
// up front: translation from macOS 26 (Darwin 25), background removal from macOS 14 (Darwin 23), voice to text on a Mac.
const both = { translate: true, media: true }

test('each feature is on only where its helper can run', () => {
  assert.deepEqual(onDeviceFeatures('darwin', '25.4.0', both), { translation: true, voiceToText: true, backgroundRemoval: true }, 'macOS 26')
  assert.deepEqual(onDeviceFeatures('darwin', '24.6.0', both), { translation: false, voiceToText: true, backgroundRemoval: true }, 'macOS 15')
  assert.deepEqual(onDeviceFeatures('darwin', '22.6.0', both), { translation: false, voiceToText: true, backgroundRemoval: false }, 'macOS 13')
  assert.deepEqual(onDeviceFeatures('win32', '10.0.26100', both), { translation: false, voiceToText: false, backgroundRemoval: false }, 'Windows')
})

test('a helper that is missing or was given up on turns its features off', () => {
  assert.deepEqual(onDeviceFeatures('darwin', '25.0.0', { translate: false, media: true }).translation, false)
  assert.deepEqual(onDeviceFeatures('darwin', '25.0.0', { translate: true, media: false }), { translation: true, voiceToText: false, backgroundRemoval: false })
})

test('the note does not speak of «this Mac» on a device that is not one', () => {
  assert.doesNotMatch(translationMessage({ status: 'unavailable' }), /이 Mac/)
  assert.match(translationMessage({ status: 'unavailable' }), /macOS 26/)
})
