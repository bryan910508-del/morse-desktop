import assert from 'node:assert/strict'
import { test } from 'node:test'
import { tokenExpiry } from '../../src/main/network/socket-transport'

// The registration is renewed five minutes before the moment the server's authTimer would end it: the `exp` of the
// ID token it was made with, read as verifyIdToken reads it.
test('the expiry of an ID token is read from its payload, and an unreadable one gives none', () => {
  const part = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url')
  assert.equal(tokenExpiry(`${part({ alg: 'RS256' })}.${part({ exp: 1_790_000_000 })}.signature`), 1_790_000_000_000)
  assert.equal(tokenExpiry('not-a-token'), 0)
  assert.equal(tokenExpiry(`${part({})}.${part({ exp: 'soon' })}.s`), 0)
  assert.equal(tokenExpiry(`${part({})}.!!!.s`), 0)
})
