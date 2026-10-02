import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ChannelPosts } from '../../src/main/accounts/channel-posts'
import { ChannelListUnavailable } from '../../src/main/accounts/channel-list-availability'
import type { FirestoreReader, ReadCredentials } from '../../src/main/network/firestore-rpc'
import { documents, type FirestoreDocument } from '../../src/main/network/firestore-values'

// Nothing is read here: the reader only records that a watch was asked for, so the checks are about which
// requests the screen makes while the account's channel list is still being read.
const credentials: ReadCredentials = { signal: new AbortController().signal, authorize: async () => { throw new Error('offline') } }
const channel = (id: string): FirestoreDocument => ({ name: `${documents}/channels/${id}`, fields: { ownerId: { stringValue: 'someone-else' } } })

function posts() {
  let state: 'unavailable' | 'gone' | 'ready' = 'unavailable'
  const watches: string[] = []
  const reader = { watch: (target: { documents?: { documents: string[] } }) => { watches.push(JSON.stringify(target.documents?.documents ?? [])); return () => {} } } as unknown as FirestoreReader
  const value = new ChannelPosts('me', credentials, id => {
    if (state === 'unavailable') throw new ChannelListUnavailable('Channel list unavailable')
    if (state === 'gone') throw new Error('Channel not in current list')
    return { doc: channel(id), reader }
  }, () => {})
  return { value, watches, arrive: () => { state = 'ready' }, lose: () => { state = 'gone' }, wait: () => { state = 'unavailable' } }
}

// The screen is opened from a chat-list inquiry row or a shared link before the channel list has been read.
test('a channel opened before its list arrives waits, and is read as soon as the list is there', () => {
  const { value, watches, arrive } = posts()
  value.open({ requestId: 'r1', channelId: 'ch-a' })
  assert.equal(value.snapshot?.status, 'loading')
  assert.equal(watches.length, 0, 'nothing can be read until the list names the channel')
  arrive()
  value.prune()
  assert.equal(watches.length, 1)
  assert.deepEqual(JSON.parse(watches[0]!), [`${documents}/channels/ch-a`, `${documents}/channels/ch-a/subscribers/me`, `${documents}/channels/ch-a/admins/me`])
  assert.equal(value.snapshot?.status, 'loading')
})

// One request only: a list published again while the posts are already being read changes nothing.
test('a list published again does not ask for the same posts twice', () => {
  const { value, watches, arrive } = posts()
  value.open({ requestId: 'r1', channelId: 'ch-a' })
  arrive()
  value.prune(); value.prune(); value.prune()
  assert.equal(watches.length, 1)
})

// The window goes away and comes back: the request is held, not refused.
test('a list that becomes unreadable is waited for, and a channel that is gone is refused', () => {
  const { value, watches, arrive, lose, wait } = posts()
  value.open({ requestId: 'r1', channelId: 'ch-a' })
  arrive(); value.prune()
  wait(); value.prune()
  assert.equal(value.snapshot?.status, 'loading')
  arrive(); value.prune()
  assert.equal(watches.length, 2, 'the channel is named again once the list is back')
  lose(); value.prune()
  assert.equal(value.snapshot?.status, 'blocked')
})
