import assert from 'node:assert/strict'
import { test } from 'node:test'
import { quietDownward } from '../../src/renderer/src/history/scroll-date'

// B286: the floating date shows on scrolling up, and on scrolling down only on crossing into another day —
// tdesktop HistoryInner::visibleAreaUpdated → scrollDateCheck / scrollDateCheckDownward. It flashed under the top bar
// each time the composer grew a line and the chat kept its bottom (a scroll down within the day).
test('down within the same day: quiet; up, or down across a day: the date shows', () => {
  assert.equal(quietDownward(8996, 9036, false), true, 'the composer grew a line, the chat kept its bottom')
  assert.equal(quietDownward(8996, 8900, false), false, 'scrolled up')
  assert.equal(quietDownward(8996, 9400, true), false, 'scrolled down into another day')
  assert.equal(quietDownward(null, 9036, false), false, 'nothing to compare with yet')
})
