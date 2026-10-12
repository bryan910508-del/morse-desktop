import assert from 'node:assert/strict'
import { test } from 'node:test'
import { appendedCount, easeOutCirc, itemRevealMs, remainingAt, revealAllowed } from '../../src/renderer/src/history/item-reveal'

// B306 ② (tdesktop history_widget.cpp:8745-8803, chat.style:58): what joins the bottom rises over 150 ms, easeOutCirc.
test('a message joining the bottom rises; more than one rise together', () => {
  assert.equal(appendedCount(['a', 'b'], ['a', 'b', 'c']), 1)
  assert.equal(appendedCount(['a', 'b'], ['a', 'b', 'c', 'd']), 2)
  assert.equal(itemRevealMs, 150)
})
test('the hidden height falls from the whole row to nothing over 150 ms, easeOutCirc (fast first)', () => {
  assert.equal(easeOutCirc(0), 0); assert.equal(easeOutCirc(1), 1)
  assert.equal(remainingAt(40, 0, 0), 40)
  assert.ok(remainingAt(40, 0, 15) < 40 && remainingAt(40, 0, 15) > 20, 'a tenth of the time: a good part already up')
  assert.ok(remainingAt(40, 0, 75) < 20, 'more than half is up at half the time')
  assert.equal(remainingAt(40, 0, 150), 0); assert.equal(remainingAt(40, 0, 400), 0)
})
test('nothing rises: the same list, a message on its way taking its server copy\'s place, older pages, another chat, a first read', () => {
  assert.equal(appendedCount(['a', 'b'], ['a', 'b']), 0)
  assert.equal(appendedCount(['a', 'b'], ['a', 'b']), 0, 'B303: the same key handed over')
  assert.equal(appendedCount(['c', 'd'], ['a', 'b', 'c', 'd']), 0, 'older pages go on top')
  assert.equal(appendedCount(['x', 'y'], ['a', 'b']), 0, 'another chat')
  assert.equal(appendedCount([], ['a', 'b']), 0, 'the first read')
  assert.equal(appendedCount(['a', 'b'], ['a', 'b', 'a']), 0, 'a key seen before is not new')
})
test('only at the bottom, in a window that is shown, with motion allowed', () => {
  assert.equal(revealAllowed(true, true, false), true)
  assert.equal(revealAllowed(false, true, false), false)
  assert.equal(revealAllowed(true, false, false), false)
  assert.equal(revealAllowed(true, true, true), false)
})
