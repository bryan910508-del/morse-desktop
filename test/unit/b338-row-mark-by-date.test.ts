import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

// B338: a row's send state (sending clock, failed «!», sent check, read circle) sits just left of its date, the room
// left over between it and the name (TI ChatListItem.swift:4627-4633; tdesktop dialogs_layout.cpp:825-863 paints it at
// the end of the name's rectangle once the date's width is taken off). In 0.241.23–24 the date alone was pushed right,
// so the mark stayed against the name.
const widget = readFileSync('src/renderer/src/dialogs/dialogs-widget.tsx', 'utf8')
const css = readFileSync('src/renderer/src/styles/dialogs.css', 'utf8')
const rule = (selector: string): string => {
  const at = css.indexOf(`${selector} {`)
  assert.ok(at >= 0, `${selector} is styled`)
  return css.slice(at, css.indexOf('}', at))
}

test('in a chat row and an inquiry row the send state and the date are one group, the state first', () => {
  const groups = [...widget.matchAll(/<span className="dialog-row-end">([\s\S]*?)<\/span>\n\s*<\/span>/g)].map(match => match[1]!)
  assert.equal(groups.length, 2, 'the chat row and the inquiry row')
  for (const group of groups) {
    const mark = group.indexOf('<RowStateMark'), time = group.indexOf('className="dialog-row-time"')
    assert.ok(mark >= 0 && time > mark, 'the state, then the date')
  }
  assert.equal((widget.match(/<RowStateMark /g) ?? []).length, 2, 'no state mark outside the group')
})

test('the group takes the far end and the name gives way to it', () => {
  const end = rule('.dialog-row-end')
  assert.match(end, /margin-left: auto/)
  assert.match(end, /flex: none/)
  assert.match(rule('.dialog-row-name'), /flex: 0 1 auto; min-width: 0/)
  // The muted and official marks stay beside the name, before the group.
  const chatRow = widget.slice(widget.indexOf('const DialogRow = memo'))
  assert.ok(chatRow.indexOf('<BellOff') < chatRow.indexOf('dialog-row-end'))
  assert.ok(chatRow.indexOf('<OfficialMark') < chatRow.indexOf('dialog-row-end'))
})
