import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ChatTyping, typingExpiryMs, typingUntil } from '../../src/main/accounts/chat-typing'
import type { FirestoreDocument } from '../../src/main/network/firestore-values'

const watcher = (uid: string, typing: boolean, atMs: number): FirestoreDocument => ({
  name: `projects/p/databases/(default)/documents/chats/c1/watchers/${uid}`,
  fields: { typing: { booleanValue: typing }, typingAt: { timestampValue: { seconds: String(Math.floor(atMs / 1000)), nanos: (atMs % 1000) * 1e6 } } }
} as unknown as FirestoreDocument)

// iOS startTypingWatcher: typing && now - typingAt < 8s, never my own watcher.
test('another person typing within 8 seconds shows until those 8 seconds end', () => {
  const now = 1_750_000_010_000
  assert.equal(typingUntil([watcher('peer', true, now - 3000)], 'me', now), now - 3000 + typingExpiryMs)
  assert.equal(typingUntil([watcher('peer', true, now - 9000)], 'me', now), 0, 'too old')
  assert.equal(typingUntil([watcher('peer', false, now - 1000)], 'me', now), 0, 'stopped')
  assert.equal(typingUntil([watcher('me', true, now - 1000)], 'me', now), 0, 'my own')
  assert.equal(typingUntil([watcher('a', true, now - 6000), watcher('b', true, now - 1000)], 'me', now), now - 1000 + typingExpiryMs, 'the latest in a group')
})

// updateTypingStateIfNeeded: "typing" at most every 5 seconds, "stopped" once.
test('typing is repeated no sooner than every 5 seconds and a stop is written once', () => {
  const typing = new ChatTyping('me', new AbortController().signal, () => {})
  assert.equal(typing.shouldWrite('c1', false, 0), false, 'nothing to stop')
  assert.equal(typing.shouldWrite('c1', true, 1000), true)
  assert.equal(typing.shouldWrite('c1', true, 4000), false)
  assert.equal(typing.shouldWrite('c1', true, 6000), true)
  assert.equal(typing.pendingStop(), 'c1')
  assert.equal(typing.shouldWrite('c1', false, 6500), true)
  assert.equal(typing.shouldWrite('c1', false, 6600), false)
  assert.equal(typing.pendingStop(), null)
  assert.equal(typing.shouldWrite('c2', true, 6700), true, 'another chat starts at once')
})
