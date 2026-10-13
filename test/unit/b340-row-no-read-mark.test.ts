import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

// B340: the chat list's rows no longer draw the sent check or the read circle; the clock and the «!» stay in B338's group
// by the date, and the unread badge (grey when muted) and the marked-unread mark are as they were. The room's bubbles
// keep their own marks (history-widget.tsx).
const widget = readFileSync('src/renderer/src/dialogs/dialogs-widget.tsx', 'utf8')
const css = readFileSync('src/renderer/src/styles/dialogs.css', 'utf8')

test('the row mark has the clock and the «!» only', () => {
  const mark = widget.slice(widget.indexOf('function RowStateMark('), widget.indexOf('const DialogRow = memo'))
  assert.match(mark, /'sending'/); assert.match(mark, /'failed'/)
  assert.doesNotMatch(mark, /'sent'|'read'|ReadMark|<Check /)
  assert.doesNotMatch(css, /\.dialog-row-sent|\.dialog-row-read/)
})

test('the unread badge, its muted grey and the marked-unread mark stay', () => {
  assert.match(widget, /dialog-row-badge\$\{dialog\.muted \? ' muted' : ''\}/)
  assert.match(widget, /dialog-row-badge mark/)
  assert.match(css, /\.dialog-row-badge\.muted \{ background: var\(--swipe-mute\) \}/)
})
