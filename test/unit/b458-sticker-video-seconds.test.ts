import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { maxStickerVideoSeconds, stickerVideoPart, stickerVideoRange } from '../../src/shared/stickers'
import { onDeviceFeatures } from '../../src/shared/translation'

// B458 (user 10-16 «문제가 없으면 5 초», the three apps one number): a sticker made from a video keeps at most five seconds,
// from a start chosen on a slider as iOS MorseStickerEditor does (:44·:57-60; tdesktop's own editor keeps a part too,
// video_editor.cpp:240-265, at Telegram's 3 s). Measured on the Mac helper (10-16 20:1x): a 5 s 512 sticker of an 8 s test
// pattern came to 1.28 MB, of per-frame noise 1.80 MB — well inside the 10 MB a sticker may be.
test('the part: from the chosen start, held inside the video, at most five seconds', () => {
  assert.equal(maxStickerVideoSeconds, 5)
  assert.deepEqual(stickerVideoRange(2, 0), { start: 0, seconds: 2 }, 'a short video is kept whole')
  assert.deepEqual(stickerVideoRange(5, 1), { start: 0, seconds: 5 }, 'five seconds exactly has nowhere to move')
  assert.deepEqual(stickerVideoRange(8, 2), { start: 2, seconds: 5 })
  assert.deepEqual(stickerVideoRange(8, 6.5), { start: 3, seconds: 5 }, 'a start past the last five seconds is brought back')
  assert.deepEqual(stickerVideoRange(8, -1), { start: 0, seconds: 5 })
  assert.deepEqual(stickerVideoRange(Number.NaN, 2), { start: 0, seconds: 0 })
})

test('main takes a part of up to five seconds from a start at or after 0; none sent is the first five; anything else is refused', () => {
  assert.deepEqual(stickerVideoPart({ start: 2, seconds: 5 }), { start: 2, seconds: 5 })
  assert.deepEqual(stickerVideoPart(undefined), { start: 0, seconds: 5 })
  for (const raw of [{ start: 0, seconds: 5.5 }, { start: -1, seconds: 3 }, { start: 0, seconds: 0 }, { start: Number.NaN, seconds: 3 }, { start: '1', seconds: 3 }, 'part'])
    assert.equal(stickerVideoPart(raw), null, JSON.stringify(raw))
})

test('only where the Mac helper can cut it does a longer video open; elsewhere it is refused when chosen, a GIF untouched', () => {
  assert.equal(onDeviceFeatures('darwin', '22.6.0', { translate: false, media: true }).videoTrim, true)
  assert.equal(onDeviceFeatures('darwin', '25.0.0', { translate: true, media: false }).videoTrim, false)
  assert.equal(onDeviceFeatures('win32', '10.0.26100', { translate: true, media: true }).videoTrim, false)
  const editor = readFileSync('src/renderer/src/history/sticker-editor.tsx', 'utf8')
  assert.match(editor, /kind === 'mp4' && !canTrim && size\.duration > maxStickerVideoSeconds\) \{ setError\(tr\('5초 이하 영상을 선택해 주세요\.'\)\)/)
  assert.match(editor, /stickerCropAnimated\(accountUid, source\.bytes, source\.video \? 'mp4' : 'gif', square, part \?\? undefined\)/)
  for (const lang of ['en', 'ru']) {
    const words = JSON.parse(readFileSync(`src/shared/i18n/${lang}.json`, 'utf8')) as Record<string, string>
    for (const key of ['5초 이하 영상을 선택해 주세요.', '{0} – {1}초', '시작 지점']) assert.ok(words[key], `${lang}: ${key}`)
  }
})
