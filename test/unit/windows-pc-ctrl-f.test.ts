import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { shortcutFor, shortcuts } from '../../src/shared/shortcuts'

// Windows PC check 10-① (user 10-14 17:2x: «채팅목록에서는 안 되지만 채팅방에선 된다»): Ctrl+F did nothing in the chat
// list. tdesktop's Command::Search (core/shortcuts.cpp:496) searches the open chat (history_widget.cpp:2708-2711) and,
// with no chat open, puts the cursor in the chat list's search field (dialogs_widget.cpp:1874-1895). v7.3.1 6fed91ff.
const key = { key: 'f', code: 'KeyF', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false }

test('Ctrl+F on Windows (and ⌘F on macOS) is the one search command, named «검색»', () => {
  assert.equal(shortcutFor(key, 'Windows'), 'find-message')
  assert.equal(shortcutFor({ ...key, key: 'ㄹ' }, 'Windows'), 'find-message', 'a Hangul input source keeps the key')
  assert.equal(shortcutFor({ ...key, ctrlKey: false, metaKey: true }, 'macOS'), 'find-message')
  assert.equal(shortcuts['find-message'].label, '검색')
})

test('with a chat open it opens the chat\'s search; with none it goes to the chat list\'s search field', () => {
  const source = readFileSync('src/renderer/src/window/main-window.tsx', 'utf8')
  assert.match(source, /case 'find-message': if \(state\.chatId\) controller\.setRight\('search'\); else \{ if \(oneColumn && state\.channelId\) controller\.closeChat\(\); controller\.focusSearch\(\) \} return true/)
})
