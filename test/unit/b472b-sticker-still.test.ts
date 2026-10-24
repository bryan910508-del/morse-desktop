import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { stickerMoves } from '../../src/shared/stickers'

// B472b, the receiving side (one rule in the three apps): an MP4 sticker of length 0 or a single frame is shown as that
// frame, still, and not repeated. Chromium's looping <video> restarts such a file without a pause; Telegram Desktop draws
// a sticker's still picture until its player has a frame (history_view_sticker.cpp:238-256) and keeps its loop to the
// clock (media_clip_ffmpeg.cpp:148-161). Measured in a hidden Electron 44.3.0 window on a local file (mvhd 0, mdhd 0,
// stts (1,0), stsz 1): the length reads Infinity first, then 0.
test('only a known length longer than one frame moves', () => {
  assert.equal(stickerMoves(Number.POSITIVE_INFINITY), false, 'before the length is known')
  assert.equal(stickerMoves(Number.NaN), false)
  assert.equal(stickerMoves(0), false, 'the B472 file')
  assert.equal(stickerMoves(0.04), false, 'a single frame at 25 fps or slower')
  assert.equal(stickerMoves(0.067), true, 'two frames')
  assert.equal(stickerMoves(1), true)
  assert.equal(stickerMoves(5), true)
})

const read = (path: string) => readFileSync(join(__dirname, '../../src/renderer/src', path), 'utf8')
test('one view draws every MP4 sticker: paused on its first frame, repeated only once it moves', () => {
  const view = read('history/sticker-video.tsx')
  assert.doesNotMatch(view, /autoPlay|\bloop\b(?!\s*=)/, 'no autoplay or loop attribute: a file of length 0 would restart without end')
  assert.match(view, /preload="auto"/)
  assert.match(view, /onDurationChange=\{event => \{\n      const video = event\.currentTarget\n      if \(stickerMoves\(video\.duration\)\) \{ video\.loop = true; void video\.play\(\)\.catch\(\(\) => \{\}\) \}\n      else \{ video\.loop = false; video\.pause\(\) \}/)
})

test('a bubble, the sticker panel and a pack\'s sheet all use it', () => {
  const places = { 'history/message.tsx': 2, 'history/entity-panel.tsx': 1, 'history/sticker-pack-sheet.tsx': 1 }
  for (const [path, count] of Object.entries(places)) {
    const source = read(path)
    assert.equal((source.match(/<StickerVideo src=\{/g) ?? []).length, count, path)
    assert.doesNotMatch(source, /<video[^>]*\bloop\b/, `${path}: no looping video of its own`)
  }
})
