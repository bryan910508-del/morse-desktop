import assert from 'node:assert/strict'
import { test } from 'node:test'
import { followsBottom, keepBottomOnResize } from '../../src/renderer/src/history/keep-bottom'

// B56 (Telegram R-66): the composer growing over a chat at its bottom no longer hides the last message.
const box = (clientHeight: number, scrollHeight: number, scrollTop: number) => ({ clientHeight, scrollHeight, scrollTop })

test('a chat at its bottom stays there when the area above the composer gets shorter', () => {
  // 600 high, at the bottom (2000 - 600); a fifth line in the composer takes 100.
  const chat = box(500, 2000, 1400)
  assert.equal(keepBottomOnResize(chat, 600, true), 500)
  assert.equal(chat.scrollTop, 2000, 'scrolled to the bottom (the browser stops it at 1500)')
})

test('a chat scrolled up keeps its place, and a taller area changes nothing', () => {
  const up = box(500, 2000, 300)
  keepBottomOnResize(up, 600, false)
  assert.equal(up.scrollTop, 300)
  const taller = box(700, 2000, 1300)
  assert.equal(keepBottomOnResize(taller, 600, true), 700)
  assert.equal(taller.scrollTop, 1300, 'the browser keeps a taller area at the bottom by itself')
})

// B184 (Phase1 2026-10-07): reading down from a jump, the view at the bottom of a window short of the newest jumped
// to the newest message when the last page came, skipping 28-58 rows, and drew one empty screen on the way.
test('the bottom of a window short of the newest is not followed; the newest window\'s bottom is', () => {
  assert.equal(followsBottom(0, true), false, 'read down from a jump: the next page is added below, the view stays')
  assert.equal(followsBottom(40, true), false)
  assert.equal(followsBottom(0, false), true, 'the window reaches the newest: a new message keeps it at the bottom')
  assert.equal(followsBottom(79, false), true)
  assert.equal(followsBottom(80, false), false, 'scrolled up from the newest keeps its place')
})
