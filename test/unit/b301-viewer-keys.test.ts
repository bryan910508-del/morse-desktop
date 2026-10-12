import assert from 'node:assert/strict'
import { test } from 'node:test'
import { windowShortcutFor, type ShortcutInput } from '../../src/shared/shortcuts'

// B301: while a media viewer is open, its zoom keys go to it — the window (Windows, B283) does not zoom the page with
// them; F11 and the window's other keys stay the window's. Closed, the window's keys are as before.
const ctrl = (key: string, code?: string): ShortcutInput => ({ key, code, ctrlKey: true, metaKey: false, altKey: false, shiftKey: false })
test('open viewer: Ctrl+= − 0 are the viewer\'s; Ctrl+W, Ctrl+M, Ctrl+Q and F11 stay the window\'s', () => {
  for (const input of [ctrl('=', 'Equal'), ctrl('-', 'Minus'), ctrl('0', 'Digit0')]) assert.equal(windowShortcutFor(input, 'Windows', true), null, input.key)
  assert.equal(windowShortcutFor(ctrl('w', 'KeyW'), 'Windows', true), 'close-window')
  assert.equal(windowShortcutFor(ctrl('m', 'KeyM'), 'Windows', true), 'minimize-window')
  assert.equal(windowShortcutFor({ key: 'F11', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false }, 'Windows', true), 'toggle-full-screen')
})
test('no viewer: the zoom keys zoom the window as before', () => {
  assert.equal(windowShortcutFor(ctrl('=', 'Equal'), 'Windows'), 'zoom-in')
  assert.equal(windowShortcutFor(ctrl('0', 'Digit0'), 'Windows', false), 'zoom-reset')
})
