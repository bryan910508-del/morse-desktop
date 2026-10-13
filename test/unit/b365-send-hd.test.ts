import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { photoSendHdInitial, photoSendHdRemembered, photoSendMode, photoSendSpec, type PhotoSendChoice } from '../../src/shared/photo-quality'
import { preferencePatch } from '../../src/shared/validation'
import { defaultPreferences } from '../../src/shared/model'

// B365 (reports/desktop/2026-10-14-b359-b360-plan.md §B365, review 10-14 02:0x): the send box has tdesktop's «High Quality»
// (menu_send.cpp:780-786 → SendFilesBox::setSendLargePhotos, send_files_box.cpp:1146-1153), remembered across boxes as
// its SendFilesWay is (core_settings.h:409-413). The settings choice stays the default. v7.3.1 6fed91ff.
const choice = (photoSendQuality: PhotoSendChoice['photoSendQuality'], photoSendHd: boolean | null): PhotoSendChoice => ({ photoSendQuality, photoSendHd })

test('the box opens with the last pick, else the setting\'s default', () => {
  const rows: [PhotoSendChoice, boolean][] = [
    [choice('auto', null), false], [choice('original', null), true], [choice('compressed', null), false],
    [choice('auto', true), true], [choice('original', false), false], [choice('compressed', true), true]
  ]
  for (const [value, expected] of rows) assert.equal(photoSendHdInitial(value), expected, JSON.stringify(value))
})

test('what is sent: on 2560, off 1280; the setting\'s «압축» and power saving\'s compression still send 512', () => {
  const spec = (value: PhotoSendChoice, hd: boolean, saving = false) => photoSendSpec(photoSendMode(value, hd), saving).maxEdge
  assert.deepEqual([spec(choice('auto', null), true), spec(choice('auto', null), false), spec(choice('original', null), false)], [2560, 1280, 1280])
  assert.deepEqual([spec(choice('compressed', null), true), spec(choice('auto', null), true, true)], [512, 512])
  assert.deepEqual(photoSendSpec(photoSendMode(choice('auto', null), true), false), { maxEdge: 2560, quality: 0.9 })
  assert.deepEqual(photoSendSpec(photoSendMode(choice('auto', null), false), false), { maxEdge: 1280, quality: 0.8 })
})

test('after a send the pick is kept only when it differs from the default; the setting\'s change forgets it', () => {
  assert.equal(photoSendHdRemembered(choice('auto', null), true), true)
  assert.equal(photoSendHdRemembered(choice('auto', true), false), null, 'back to the default: nothing kept')
  assert.equal(photoSendHdRemembered(choice('original', null), false), false)
  assert.equal(photoSendHdRemembered(choice('original', null), true), null)
  const settings = readFileSync('src/renderer/src/settings/settings-box.tsx', 'utf8')
  assert.match(settings, /update\(\{ photoSendQuality: id, photoSendHd: null \}\)/, 'choosing the setting makes it the default again')
})

test('the pick is a preference of its own: boolean or null, nothing else; null by default', () => {
  assert.equal(defaultPreferences.photoSendHd, null)
  assert.deepEqual(preferencePatch({ photoSendHd: true }), { photoSendHd: true })
  assert.deepEqual(preferencePatch({ photoSendHd: null }), { photoSendHd: null })
  assert.throws(() => preferencePatch({ photoSendHd: 'yes' }))
})

test('the row is in a chat\'s box only, for photos that are re-encoded (not GIFs alone), and the send carries it', () => {
  const box = readFileSync('src/renderer/src/boxes/send-files-box.tsx', 'utf8')
  assert.match(box, /hdOffered = sender\.highQuality === true && draft\.kind === 'image' && items\.some\(item => !\/\\\.gif\$\/i\.test\(item\.name\)\)/)
  assert.match(box, /highQuality: true,\n    send: async \(caption, itemIds, video, options\)/)
  assert.match(box, /reencodePhotos\(accountUid, chatId, draft, itemIds, photoSendMode\(choice, hd\)\)/)
  assert.doesNotMatch(readFileSync('src/renderer/src/channels/channel-inquiry-panel.tsx', 'utf8'), /highQuality/, 'an inquiry room keeps its own size')
})
