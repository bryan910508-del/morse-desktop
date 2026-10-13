import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

// B342: a delete choice is rows in one look — the one for everyone in the danger colour with no filled button under it,
// as tdesktop's delete confirmation uses attentionBoxButton (red text, no background). An accent-filled button with red
// text (button primary … danger) read poorly in the chat and history delete boxes.
function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => { const path = join(dir, name); return statSync(path).isDirectory() ? files(path) : path.endsWith('.tsx') ? [path] : [] })
}

test('no button in the app is both primary and danger', () => {
  // One class string holding both; a choice between them (`'flat danger' : 'primary'`) is not one.
  const both = /["'`]([^"'`]*\bprimary\b[^"'`]*\bdanger\b[^"'`]*|[^"'`]*\bdanger\b[^"'`]*\bprimary\b[^"'`]*)["'`]/
  const found = files('src/renderer/src').filter(path => both.test(readFileSync(path, 'utf8')))
  assert.deepEqual(found, [])
})

test('the message, chat and history delete boxes choose with the one DeleteChoice', () => {
  for (const [path, box] of [['src/renderer/src/history/history-widget.tsx', 'function DeleteMessagesBox'], ['src/renderer/src/dialogs/dialogs-widget.tsx', 'function ChatDeleteBox'],
    ['src/renderer/src/dialogs/clear-history-box.tsx', 'export function showClearHistoryBox']] as const) {
    const source = readFileSync(path, 'utf8'), start = source.indexOf(box)
    assert.ok(start >= 0, box)
    const body = source.slice(start, start + 1800)
    assert.match(body, /<DeleteChoice rows=/, box)
    assert.match(body, /danger: true/, `${box}: the one for everyone is the danger row`)
    assert.doesNotMatch(body, /delete-choice-row|button primary/, `${box}: no row or button of its own`)
  }
})
