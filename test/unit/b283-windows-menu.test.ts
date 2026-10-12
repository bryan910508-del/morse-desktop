import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applicationMenuShown, shortcutFor, windowShortcutFor, type ShortcutInput } from '../../src/shared/shortcuts'

// B283: no menu bar in the window on Windows and Linux (tdesktop builds a menu only on macOS); what its roles gave is
// kept as the window's own keys there, as tdesktop's Close/Minimize/Quit shortcuts are. macOS keeps its menu.
const key = (key: string, extra: Partial<ShortcutInput> = {}): ShortcutInput => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...extra })
const ctrl = (k: string, extra: Partial<ShortcutInput> = {}) => key(k, { ctrlKey: true, ...extra })

test('the menu is shown on macOS only', () => {
  assert.equal(applicationMenuShown('macOS'), true)
  assert.equal(applicationMenuShown('Windows'), false)
})

test('Windows and Linux: the keys the menu gave are the window\'s own', () => {
  const cases: [ShortcutInput, string][] = [
    [ctrl('w', { code: 'KeyW' }), 'close-window'], [ctrl('F4'), 'close-window'], [ctrl('m', { code: 'KeyM' }), 'minimize-window'],
    [ctrl('q', { code: 'KeyQ' }), 'quit'], [ctrl('0', { code: 'Digit0' }), 'zoom-reset'], [ctrl('=', { code: 'Equal' }), 'zoom-in'],
    [ctrl('+', { code: 'Equal', shiftKey: true }), 'zoom-in'], [ctrl('+', { code: 'NumpadAdd' }), 'zoom-in'], [ctrl('-', { code: 'Minus' }), 'zoom-out'],
    [key('F11'), 'toggle-full-screen'],
    // A Hangul input source: the letter by its place.
    [ctrl('ㅈ', { code: 'KeyW' }), 'close-window']
  ]
  for (const [input, command] of cases) assert.equal(windowShortcutFor(input, 'Windows'), command, `${input.key} ${input.code ?? ''}`)
})

test('editing keys and the app\'s own shortcuts are left alone', () => {
  for (const k of ['c', 'v', 'x', 'z', 'y', 'a']) assert.equal(windowShortcutFor(ctrl(k, { code: `Key${k.toUpperCase()}` }), 'Windows'), null, `Ctrl+${k}`)
  assert.equal(windowShortcutFor(ctrl('M', { code: 'KeyM', shiftKey: true }), 'Windows'), null, 'Ctrl+Shift+M is the composer')
  assert.equal(shortcutFor(ctrl('M', { code: 'KeyM', shiftKey: true }), 'Windows'), 'focus-composer')
  for (const k of ['k', 'f', '1', '2', '3']) assert.equal(windowShortcutFor(ctrl(k), 'Windows'), null)
  assert.equal(windowShortcutFor(ctrl('w', { code: 'KeyW', altKey: true }), 'Windows'), null)
  assert.equal(windowShortcutFor(ctrl('w', { code: 'KeyW', isComposing: true }), 'Windows'), null)
})

test('macOS: the menu does it, so the window has none of its own', () => {
  for (const input of [key('w', { metaKey: true, code: 'KeyW' }), ctrl('w', { code: 'KeyW' }), key('F11')]) assert.equal(windowShortcutFor(input, 'macOS'), null)
})
