import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { EndFollower, type ScrollBox } from '../../src/renderer/src/history/keep-bottom'

// B372 (review 10-14 06:3x): the 1:1 inquiry room pulled one reading further up to its bottom whenever a message arrived
// (channel-inquiry-panel.tsx:139 at 3cc3d4b scrolled on every count change). tdesktop takes the history to its bottom for
// a send from here (MessageSent → scrollTopMax, history_widget.cpp:846-847, v7.3.1 6fed91ff) and otherwise only while it
// is read at its bottom; the chat history already does that (keep-bottom.ts followsBottom / keepsBottomOnChange).
// A scroller as the page keeps one: scrollTop is held between 0 and scrollHeight - clientHeight.
function box(scrollHeight: number, clientHeight = 500): ScrollBox & { scrollHeight: number } {
  let top = scrollHeight - clientHeight
  const result = {
    scrollHeight, clientHeight,
    get scrollTop() { return top },
    set scrollTop(value: number) { top = Math.max(0, Math.min(value, result.scrollHeight - result.clientHeight)) }
  }
  return result
}
const fromBottom = (b: ScrollBox) => b.scrollHeight - b.clientHeight - b.scrollTop

test('read at the bottom, a message that arrives is followed', () => {
  const follower = new EndFollower(), list = box(2000)
  follower.scrolled(list)
  list.scrollHeight += 120 // a message from the other side
  follower.changed(list, 0)
  assert.equal(fromBottom(list), 0)
})

test('read further up, a message that arrives keeps the place; the distance shows «최근 메시지로 이동»', () => {
  const follower = new EndFollower(), list = box(2000)
  list.scrollTop = 200
  assert.ok(follower.scrolled(list) > 480)
  list.scrollHeight += 120
  follower.changed(list, 0)
  assert.equal(list.scrollTop, 200, 'not pulled down')
  list.scrollHeight += 300 // a picture in it measured
  follower.follow(list)
  assert.equal(list.scrollTop, 200)
})

test('a send from here takes it to the bottom from anywhere, and it follows from there', () => {
  const follower = new EndFollower(), list = box(2000)
  list.scrollTop = 0
  follower.scrolled(list)
  list.scrollHeight += 80
  follower.changed(list, 1) // one more of this device's messages on its way
  assert.equal(fromBottom(list), 0)
  list.scrollHeight += 80 // the server's copy replaces it; the queue empties
  follower.changed(list, 0)
  assert.equal(fromBottom(list), 0, 'still followed')
  list.scrollHeight += 120
  follower.changed(list, 0)
  assert.equal(fromBottom(list), 0, 'the next one that arrives too')
})

test('near the bottom counts as at it (80px, as the chat); the button takes it there', () => {
  const follower = new EndFollower(), list = box(2000)
  list.scrollTop = 1500 - 60
  follower.scrolled(list)
  list.scrollHeight += 100
  follower.changed(list, 0)
  assert.equal(fromBottom(list), 0)
  list.scrollTop = 100
  follower.scrolled(list)
  follower.toBottom(list)
  assert.equal(fromBottom(list), 0)
  list.scrollHeight += 50
  follower.follow(list)
  assert.equal(fromBottom(list), 0)
})

test('the room uses the one follower, watches its newest message rather than the count, and offers the way down', () => {
  const source = readFileSync('src/renderer/src/channels/channel-inquiry-panel.tsx', 'utf8')
  assert.ok(!/scrollTop = element\.scrollHeight \}, \[items\.length/.test(source), 'no scroll on every count change')
  assert.match(source, /new EndFollower\(\)/)
  assert.match(source, /follower\.changed\(element, waiting\.length\) \}, \[newest, waiting\.length\]/)
  assert.match(source, /onScroll=\{\(\) => \{ const element = list\.current; if \(element\) setAway\(follower\.scrolled\(element\) > 480\)/)
  assert.match(source, /className="history-down" aria-label=\{tr\('최근 메시지로 이동'\)\}/)
  assert.match(source, /observer\.observe\(inner\)/)
})
