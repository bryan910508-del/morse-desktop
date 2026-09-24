import assert from 'node:assert/strict'
import { test } from 'node:test'
import { maxStoredReactions, reactionFallback, reactionSlots, reactionStrip } from '../../src/renderer/src/history/recent-reactions'

// Telegram orders the strip by what has been used lately (its list comes from the server and moves as a
// person reacts); iOS keeps the same order in a list of its own (MorseRecentReactionEmojis.compactStrip:
// `recent + fallback`, each once, up to the slot count). Desktop's strip stood in one order for ever.
test('what was reacted with lately comes first, then the rest of the choices', () => {
  const strip = reactionStrip(['🔥', '🙏'])
  assert.deepEqual(strip.slice(0, 2), ['🔥', '🙏'])
  assert.equal(strip.length, reactionSlots)
  assert.deepEqual([...strip].sort(), [...reactionFallback].sort(), 'the choices themselves do not change')
})

test('nothing appears twice, and an empty history is the choices as they stand', () => {
  assert.deepEqual(reactionStrip([]), reactionFallback)
  assert.deepEqual(reactionStrip(['👍', '👍', '❤️']).slice(0, 2), ['👍', '❤️'])
  assert.equal(new Set(reactionStrip(['😂', '😂', '🔥'])).size, reactionSlots)
})

test('a reaction that is not one of the choices still takes its place, and the strip stays its length', () => {
  const strip = reactionStrip(['🐳'])
  assert.equal(strip[0], '🐳', 'a reaction picked from the full list is remembered like any other')
  assert.equal(strip.length, reactionSlots)
  assert.equal(strip.includes(reactionFallback[reactionFallback.length - 1]!), false, 'the last choice is pushed out')
})

test('nothing unusable reaches the strip', () => {
  assert.deepEqual(reactionStrip(['', 'x'.repeat(33), '👍']).slice(0, 1), ['👍'])
  assert.equal(maxStoredReactions, 32)
})
