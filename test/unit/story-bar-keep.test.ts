import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mergeStoryBar, type StoryBarEntry } from '../../src/shared/story-bar'

// B47 (Telegram R-59): the stories row keeps what it has when a read fails; a dropped connection no longer empties it.
// Main keeps each list's last answer while it listens again (b277-story-bar-reads); the row merges what it is told.
test('the row merges a partial result and drops only what has expired', () => {
  const now = 1_000_000
  const a: StoryBarEntry = { uid: 'a', count: 1, unseen: 1, latestAt: 1, expiresAt: now + 10 }
  const b: StoryBarEntry = { uid: 'b', count: 2, unseen: 0, latestAt: 2, expiresAt: now + 10 }
  const gone: StoryBarEntry = { uid: 'c', count: 1, unseen: 0, latestAt: 3, expiresAt: now - 1 }
  assert.deepEqual(mergeStoryBar([a, b], { entries: [], observedAt: now, partial: true }, now).map(entry => entry.uid), ['a', 'b'], 'a partial empty answer keeps the row')
  assert.deepEqual(mergeStoryBar([a, b], { entries: [{ ...a, unseen: 0 }], observedAt: now, partial: true }, now).map(entry => [entry.uid, entry.unseen]), [['a', 0], ['b', 0]])
  assert.deepEqual(mergeStoryBar([a, b], { entries: [a], observedAt: now, partial: false }, now).map(entry => entry.uid), ['a'], 'a full answer replaces it')
  assert.deepEqual(mergeStoryBar([a, gone], { entries: [], observedAt: now, partial: true }, now).map(entry => entry.uid), ['a'], 'expired stories leave')
})
