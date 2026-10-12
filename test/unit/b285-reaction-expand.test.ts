import assert from 'node:assert/strict'
import { test } from 'node:test'
import { expandedReactions, maxStoredReactions, reactionStrip } from '../../src/renderer/src/history/recent-reactions'
import { popupMenu } from '../../src/renderer/src/ui/popup-menu'
import emojis from '../../src/renderer/src/history/emoji-data.json'

// B285: the menu's reaction strip expands, in the menu's place, into the recent reactions and then every emoji —
// tdesktop Selector::expand (history_view_reactions_selector.cpp:1014-1138).
test('expanded: every recent reaction first (not only the strip\'s slots), then every emoji', () => {
  const recent = ['🫠', '🍕', '👍', '🫠', '', 'x'.repeat(33), ...Array.from({ length: 40 }, (_, i) => String.fromCodePoint(0x1f600 + i))]
  const { recent: shownRecent, all } = expandedReactions(recent, emojis as string[])
  assert.deepEqual(shownRecent.slice(0, 3), ['🫠', '🍕', '👍'])
  assert.equal(shownRecent.length, maxStoredReactions)
  assert.ok(!shownRecent.includes('') && shownRecent.every(emoji => emoji.length <= 32))
  assert.ok(reactionStrip(recent).length < shownRecent.length, 'the strip shows only its slots; the panel all of them')
  assert.equal(all.length, new Set(emojis as string[]).size)
  assert.ok(all.includes('🫠') || all.length > 1000, 'the full list')
})

test('the menu gives way to the panel without closing', () => {
  let closed = 0
  popupMenu.open({ x: 10, y: 10 }, [{ label: 'a', onSelect: () => {} }], { header: 'strip', onClose: () => { closed++ } })
  popupMenu.expand('panel')
  assert.equal(popupMenu.isOpen, true)
  assert.equal(closed, 0, 'still the same menu')
  popupMenu.close()
  assert.equal(closed, 1)
  popupMenu.expand('nothing open')
  assert.equal(popupMenu.isOpen, false)
})
