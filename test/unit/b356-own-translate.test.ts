import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { menuTranslatable } from '../../src/shared/translation'

// B356 (reports/desktop/2026-10-13-b356-plan.md, review 10-13 23:5x): the message menu offers «번역» on one's own text
// too, as tdesktop's does (history_view_context_menu.cpp:1901-1909 asks for an original text, not for out()); the server
// translates the sender's own message (morse-translation.js:149, :161, :71-76 — no senderId rule). «전체번역» keeps to
// received messages (history_view_translate_tracker.cpp:116). v7.3.1 6fed91ff.
test('the menu offers «번역» on any text with words, one\'s own too; not a secret chat\'s, an encrypted or a service line', () => {
  const text = (extra: Record<string, unknown> = {}) => ({ kind: 'text', text: 'Good evening', ...extra })
  assert.equal(menuTranslatable(text(), 'direct'), true)
  assert.equal(menuTranslatable(text(), 'group'), true)
  assert.equal(menuTranslatable(text(), 'secret'), false)
  assert.equal(menuTranslatable(text({ encrypted: true }), 'direct'), false)
  assert.equal(menuTranslatable(text({ system: true }), 'direct'), false)
  assert.equal(menuTranslatable(text({ text: '   ' }), 'direct'), false)
  assert.equal(menuTranslatable({ kind: 'image', text: '' }, 'direct'), false)
})

test('the menu and the main process use the one rule, and «전체번역» still asks only for received messages', () => {
  const widget = readFileSync('src/renderer/src/history/history-widget.tsx', 'utf8')
  const session = readFileSync('src/main/accounts/session.ts', 'utf8')
  // B343b moved the row into translations.ts translationMenuEntry, which applies menuTranslatable.
  assert.match(widget, /translationMenuEntry\(accountUid, chatId, message, owner\?\.kind,/)
  assert.match(readFileSync('src/renderer/src/app/translations.ts', 'utf8'), /if \(!menuTranslatable\(message, roomKind\)/)
  const source = session.slice(session.indexOf('  translationSource(chatId: string, messageId: string): string {'))
  const body = source.slice(0, source.indexOf('\n  }\n'))
  assert.match(body, /menuTranslatable\(message, history\.dialog\.summary\.kind\)/)
  assert.doesNotMatch(body, /senderId === this\.profile\.uid/, 'one\'s own message is not refused')
  const onScreen = widget.slice(widget.indexOf('const translatableOnScreen'), widget.indexOf('const translatableKey'))
  assert.match(onScreen, /!entry\.own/, '«전체번역»: received messages only (translate_tracker.cpp:116)')
})
