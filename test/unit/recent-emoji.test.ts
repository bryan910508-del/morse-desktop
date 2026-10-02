import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addRecentEmoji, defaultRecentEmoji, recentEmojiLimit, recentEmojiShown, type RecentEmoji } from '../../src/renderer/src/history/recent-emoji'

// B57 (Telegram R-66): the emoji panel's recent row — most used first, up to 54, filled with the defaults.
const pick = (list: RecentEmoji[], ...emoji: string[]) => emoji.reduce(addRecentEmoji, list)

test('nothing used yet shows the defaults; what is used comes first, each once', () => {
  assert.deepEqual(recentEmojiShown([]), defaultRecentEmoji)
  const shown = recentEmojiShown(pick([], '🦊', '😂'))
  assert.deepEqual(shown.slice(0, 2), ['😂', '🦊'], 'the latest of equals first')
  assert.equal(shown.filter(emoji => emoji === '😂').length, 1)
})

test('the most used comes first, and a newer one passes it only by being used more', () => {
  let list = pick([], '🦊', '🦊', '🐼')
  assert.deepEqual(list.map(item => item.emoji), ['🦊', '🐼'])
  list = pick(list, '🐼')
  assert.deepEqual(list.map(item => item.emoji), ['🐼', '🦊'], 'equal counts: the one just used goes first')
})

test('at most 54: a new one pushes out the least used', () => {
  let list: RecentEmoji[] = []
  for (let n = 0; n < recentEmojiLimit; n++) list = pick(list, String.fromCodePoint(0x1F600 + n), String.fromCodePoint(0x1F600 + n))
  list = pick(list, '🦊')
  assert.equal(list.length, recentEmojiLimit)
  assert.equal(list.at(-1)!.emoji, '🦊')
  assert.equal(recentEmojiShown(list).length, recentEmojiLimit)
})
