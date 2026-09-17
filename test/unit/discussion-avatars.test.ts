import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DiscussionAvatars } from '../../src/main/accounts/discussion-avatars'
import type { ReadCredentials } from '../../src/main/network/firestore-rpc'

// The publish path reads this snapshot, so reading it must stay silent: a reader that announced a
// change would ask for the next publish without end, which the app showed as a repeating alert.
const credentials = () => ({ signal: new AbortController().signal, authorize: async () => ({ idToken: 'token', appCheckToken: 'check' }) } as unknown as ReadCredentials)

test('reading a discussion picture never announces a change', () => {
  let changes = 0
  const avatars = new DiscussionAvatars(credentials(), () => { changes++ })
  for (let attempt = 0; attempt < 5; attempt++) assert.equal(avatars.snapshot('channel1'), null)
  assert.equal(changes, 0, 'a snapshot is read-only')
  avatars.close()
})

test('a locked or closed account answers with no picture', () => {
  const avatars = new DiscussionAvatars(credentials(), () => {})
  avatars.setLocked(true)
  avatars.setVisible(['channel1'])
  assert.equal(avatars.snapshot('channel1'), null, 'a locked screen reads nothing')
  avatars.setLocked(false)
  assert.equal(avatars.snapshot('channel1'), null, 'a channel that has not been read yet has no picture')
  avatars.close()
  assert.equal(avatars.snapshot('channel1'), null)
})
