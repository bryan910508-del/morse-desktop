import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PersonalChannels, personalChannelIdField, personalChannelPost } from '../../src/main/accounts/personal-channel'
import { personalChannelCardRequest, personalChannelLink, personalChannelPreview } from '../../src/shared/personal-channel'
import type { ReadCredentials } from '../../src/main/network/firestore-rpc'
import { documents, type FirestoreDocument } from '../../src/main/network/firestore-values'

// users/{uid}.personalChannelId as iOS writes it (MorsePersonalChannel.swift, MorseIOS e373a9dd).
const credentials = () => ({ signal: new AbortController().signal, authorize: async () => ({ idToken: 'token', appCheckToken: 'check' }) } as unknown as ReadCredentials)

test('the linked channel is read as the clients write it, and anything else is no channel', () => {
  assert.equal(personalChannelIdField({ personalChannelId: { stringValue: 'AbC123_-x' } }), 'AbC123_-x')
  // iOS trims the stored value (linkedChannelId).
  assert.equal(personalChannelIdField({ personalChannelId: { stringValue: '  AbC123  ' } }), 'AbC123')
  assert.equal(personalChannelIdField({}), '', 'no field is no channel')
  assert.equal(personalChannelIdField({ personalChannelId: { stringValue: '' } }), '')
  // A malformed value must not cost the whole profile: it reads as no channel.
  assert.equal(personalChannelIdField({ personalChannelId: { integerValue: '5' } }), '')
  assert.equal(personalChannelIdField({ personalChannelId: { stringValue: 'a/b' } }), '')
  assert.equal(personalChannelIdField({ personalChannelId: { stringValue: 'x'.repeat(161) } }), '')
})

const post = (fields: Record<string, unknown>): FirestoreDocument => ({ name: `${documents}/channels/c1/posts/p1`, fields: fields as FirestoreDocument['fields'] })
const created = { createdAt: { timestampValue: { seconds: '1758760000', nanos: 0 } } }
const types = (...kinds: string[]) => ({ mediaTypes: { arrayValue: { values: kinds.map(kind => ({ stringValue: kind })) } } })

test('the line under the channel is the post text, else what its first media is', () => {
  assert.deepEqual(personalChannelPost(post({ ...created, text: { stringValue: ' 새 글 ' }, ...types('video') })), { text: '새 글', kind: 'video', time: 1758760000000 })
  assert.equal(personalChannelPreview(personalChannelPost(post({ ...created, text: { stringValue: '글' }, ...types('image') }))!), '글')
  assert.equal(personalChannelPreview(personalChannelPost(post({ ...created, ...types('image', 'video') }))!), '사진')
  assert.equal(personalChannelPreview(personalChannelPost(post({ ...created, ...types('video', 'image') }))!), '동영상')
  // MorsePersonalChannel.previewText names only a photo or a video; anything else, or no mediaTypes, has no line.
  assert.equal(personalChannelPreview(personalChannelPost(post({ ...created, mediaKeys: { arrayValue: { values: [{ stringValue: 'x' }] } } }))!), '')
  assert.equal(personalChannelPreview(personalChannelPost(post({ ...created, ...types('file') }))!), '')
  assert.equal(personalChannelPost(post({ text: { stringValue: 'no time' } })), null, 'a post without its time is not shown')
})

test('the requests carry only what they name', () => {
  assert.deepEqual(personalChannelLink({ channelId: null }), { channelId: null })
  assert.deepEqual(personalChannelLink({ channelId: 'c1' }), { channelId: 'c1' })
  assert.throws(() => personalChannelLink({}))
  assert.throws(() => personalChannelLink({ channelId: 'c1', extra: true }))
  assert.throws(() => personalChannelLink({ channelId: '../c1' }))
  assert.deepEqual(personalChannelCardRequest({ requestId: 'r1', profileUid: 'u1', channelId: 'c1' }), { requestId: 'r1', profileUid: 'u1', channelId: 'c1' })
  assert.throws(() => personalChannelCardRequest({ requestId: 'r1', profileUid: 'u1' }))
})

// Every publish reads the snapshot, so reading it must stay silent (discussion-avatars.test.ts found why).
test('reading the snapshot announces nothing, and a locked screen reads and shows nothing', () => {
  let changes = 0
  const channels = new PersonalChannels('me', credentials(), () => { changes++ })
  channels.setLocked(true)
  channels.openCard({ requestId: 'r1', profileUid: 'u1', channelId: 'c1' })
  channels.openOwned('o1')
  const before = changes
  for (let attempt = 0; attempt < 3; attempt++) assert.equal(channels.snapshot, null, 'a locked screen shows nothing')
  assert.equal(changes, before, 'a snapshot is read-only')
  channels.close()
  assert.equal(channels.snapshot, null)
})

test('only a channel the chooser offered can be linked', async () => {
  const channels = new PersonalChannels('me', credentials(), () => {})
  await assert.rejects(channels.save({ channelId: 'not-listed' }), 'nothing is written for a channel outside the owned list')
  channels.close()
  await assert.rejects(channels.save({ channelId: null }), 'a closed account writes nothing')
})
