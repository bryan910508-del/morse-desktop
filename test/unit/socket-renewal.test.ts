import assert from 'node:assert/strict'
import { test } from 'node:test'
import { tokenExpiry, shouldFallBack, fallbackAfter } from '../../src/main/network/socket-transport'

// The registration is renewed five minutes before the moment the server's authTimer would end it: the `exp` of the
// ID token it was made with, read as verifyIdToken reads it.
test('the expiry of an ID token is read from its payload, and an unreadable one gives none', () => {
  const part = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url')
  assert.equal(tokenExpiry(`${part({ alg: 'RS256' })}.${part({ exp: 1_790_000_000 })}.signature`), 1_790_000_000_000)
  assert.equal(tokenExpiry('not-a-token'), 0)
  assert.equal(tokenExpiry(`${part({})}.${part({ exp: 'soon' })}.s`), 0)
  assert.equal(tokenExpiry(`${part({})}.!!!.s`), 0)
})

// Telegram gives a connection one to eight seconds and tries again (kMinConnectedTimeout 1000,
// kMaxConnectedTimeout 8000). Measured here, a websocket came back in 3 to 31 seconds where a long
// poll took 20 to 290, so the poll is only for a network that never carries a websocket at all.
test('the long poll is used only after enough tries with nothing ever connected', () => {
  assert.equal(shouldFallBack(false, false, fallbackAfter - 1), false, 'a few failures are the edge, not the network')
  assert.equal(shouldFallBack(false, false, fallbackAfter), true)
  assert.equal(shouldFallBack(true, false, fallbackAfter * 3), false, 'a websocket that has worked once is not given up')
  assert.equal(shouldFallBack(false, true, fallbackAfter * 3), false, 'the poll is not asked for twice')
})
