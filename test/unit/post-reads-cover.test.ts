import assert from 'node:assert/strict'
import { test } from 'node:test'
import { postUncovered } from '../../src/renderer/src/channels/post-reads'

// B60 (Telegram mainwindow.cpp:597-606 markingAsRead needs no layer; history_inner_widget.cpp:1410-1416 reads nothing
// overlapped): a channel post under a box, the post viewer, a menu or the side panel is not marked seen.
type Rect = { left: number; top: number; right: number; bottom: number }
const box = (rect: Rect, children: unknown[] = []) => {
  const self = { getBoundingClientRect: () => rect, contains: (other: unknown) => other === self || children.includes(other) }
  return self
}
const viewport = { width: 1000, height: 800 }
const feed = box({ left: 0, top: 0, right: 1000, bottom: 800 })

test('a post on screen with nothing over it is seen', () => {
  const post = box({ left: 100, top: 100, right: 500, bottom: 300 })
  assert.equal(postUncovered(post, feed, [], () => post, viewport), true)
})

test('a box, the post viewer, a menu or the side panel over the feed: nothing is seen', () => {
  const post = box({ left: 100, top: 100, right: 500, bottom: 300 })
  const layer = box({ left: 0, top: 0, right: 1000, bottom: 800 })
  assert.equal(postUncovered(post, feed, [layer], () => post, viewport), false)
})

test('the side panel that holds the feed itself does not hide it', () => {
  const post = box({ left: 600, top: 100, right: 900, bottom: 300 })
  const holder = box({ left: 500, top: 0, right: 1000, bottom: 800 }, [feed])
  assert.equal(postUncovered(post, feed, [holder], () => post, viewport), true)
})

test("something else at the post's visible middle (a floating bar, a toast) means it is not seen; off screen is not seen", () => {
  const post = box({ left: 100, top: 700, right: 500, bottom: 1200 })
  let asked: [number, number] | null = null
  const other = box({ left: 0, top: 0, right: 0, bottom: 0 })
  assert.equal(postUncovered(post, feed, [], (x, y) => { asked = [x, y]; return other }, viewport), false)
  assert.deepEqual(asked, [300, 750], 'the middle of the part on screen')
  assert.equal(postUncovered(box({ left: 0, top: 900, right: 100, bottom: 950 }), feed, [], () => null, viewport), false)
})
