import assert from 'node:assert/strict'
import { test } from 'node:test'
import { linkState, listRetryDelay } from '../../src/main/accounts/link-state'

// B100: the list and the chat title speak of the way updates arrive (the chat list's Firestore listen) and the network,
// as Telegram's title speaks of its update connection; the message server's socket alone says nothing (sends go by the
// callables, A15). And a list stopped by an error listens again by itself.
test('no network, a dropped listen, and the first catch-up — never the socket alone', () => {
  assert.equal(linkState(true, 'ready', true, true), 'waiting-network')
  assert.equal(linkState(false, 'ready', true, true), 'ready', 'the list is current: nothing to say, whatever the socket does')
  assert.equal(linkState(false, 'loading', false, false), 'updating', 'the first catch-up since the account opened')
  assert.equal(linkState(false, 'ready', false, true), 'connecting', 'the listen dropped; the list stays on screen')
  assert.equal(linkState(false, 'error', false, true), 'connecting', 'stopped, and listening again')
  assert.equal(linkState(false, 'error', false, false), 'updating')
})

test('a stopped list listens again after 5 s, doubling to a minute', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 10].map(listRetryDelay), [5000, 10000, 20000, 40000, 60000, 60000])
})
