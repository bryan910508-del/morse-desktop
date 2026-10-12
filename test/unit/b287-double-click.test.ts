import assert from 'node:assert/strict'
import { test } from 'node:test'
import { onMessageText } from '../../src/renderer/src/history/text-point'

// B287: a double-click on a message's text selects a word; beside the text (the bubble's empty room, its time) it is the
// quick action (reply) — tdesktop history_inner_widget.cpp:2700-2731.
// A line of text «hello» at y 10–30, one character 10 px wide from x 100 (so the text ends at 150).
const text = { nodeType: 3, length: 5 }
const host = { contains: (node: unknown) => node === text }
const element = (inside: { link?: boolean; selectable?: boolean }) => ({
  closest: (selector: string) => selector.startsWith('a,') ? (inside.link ? {} : null) : selector === '.selectable' ? (inside.selectable ? host : null) : null
})
const doc = {
  // The caret lands on the nearest character, as Chromium's does: beyond the line's end, at its end.
  caretRangeFromPoint: (x: number) => ({ startContainer: text, startOffset: Math.max(0, Math.min(5, Math.round((x - 100) / 10))) }),
  createRange: () => {
    let from = 0
    return { setStart: (_node: unknown, at: number) => { from = at }, setEnd: () => {}, getClientRects: () => [{ left: 100 + from * 10, right: 110 + from * 10, top: 10, bottom: 30 }] }
  }
} as unknown as Pick<Document, 'caretRangeFromPoint' | 'createRange'>

test('on a character of the text: the word is selected, no reply', () => {
  assert.equal(onMessageText(element({ selectable: true }), 123, 20, doc), true)
  assert.equal(onMessageText(element({ selectable: true }), 100, 12, doc), true)
})

test('beside the text — past the line\'s end, above it, or outside any text: the reply', () => {
  assert.equal(onMessageText(element({ selectable: true }), 180, 20, doc), false, 'past the end of the line')
  assert.equal(onMessageText(element({ selectable: true }), 120, 40, doc), false, 'below the line')
  assert.equal(onMessageText(element({}), 120, 20, doc), false, 'the bubble\'s empty room or its time')
})

test('a link or a button: neither — no reply', () => {
  assert.equal(onMessageText(element({ link: true }), 120, 20, doc), true)
})

test('no element, or a document without caret lookup: the reply', () => {
  assert.equal(onMessageText(null, 120, 20, doc), false)
  assert.equal(onMessageText(element({ selectable: true }), 120, 20, { createRange: doc.createRange } as unknown as Pick<Document, 'caretRangeFromPoint' | 'createRange'>), false)
})
