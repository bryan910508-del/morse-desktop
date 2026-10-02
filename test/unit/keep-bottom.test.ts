import assert from 'node:assert/strict'
import { test } from 'node:test'
import { keepBottomOnResize } from '../../src/renderer/src/history/keep-bottom'

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
