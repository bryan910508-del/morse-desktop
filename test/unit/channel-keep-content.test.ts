import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ChannelInquiries } from '../../src/main/accounts/channel-inquiries'
import { ChannelPosts } from '../../src/main/accounts/channel-posts'
import type { InquirySendRequest } from '../../src/main/accounts/inquiry-sends'
import type { FirestoreReader, ReadCredentials, WatchEvents } from '../../src/main/network/firestore-rpc'
import { documents, type FirestoreDocument } from '../../src/main/network/firestore-values'

// Telegram keeps what a screen shows while its connection comes back, and replaces it with the next consistent
// snapshot. A channel's posts and what this account may see there stay on screen while their watches reconnect
// (FirestoreReader.watch calls `reconnecting` instead of state('loading') for a watch that was current).
const credentials: ReadCredentials = { signal: new AbortController().signal, authorize: async () => { throw new Error('offline') } }
const at = { seconds: '1790121600', nanos: 0 }
const root = `${documents}/channels/ch-a`
const channel: FirestoreDocument = { name: root, updateTime: at, createTime: at, fields: { ownerId: { stringValue: 'me' }, name: { stringValue: '채널' } } } as unknown as FirestoreDocument
const post = (id: string): FirestoreDocument => ({ name: `${root}/posts/${id}`, updateTime: at, createTime: at, fields: { channelId: { stringValue: 'ch-a' }, authorId: { stringValue: 'me' },
  text: { stringValue: id }, visibility: { stringValue: 'public' }, createdAt: { timestampValue: at }, likedBy: { arrayValue: { values: [] } }, likeCount: { integerValue: '0' }, commentCount: { integerValue: '0' } } }) as unknown as FirestoreDocument

test('a channel\'s posts stay on screen while their watches reconnect', () => {
  const watches: WatchEvents[] = []
  const reader = { watch: (_target: unknown, _signal: AbortSignal, events: WatchEvents) => { watches.push(events); return () => {} } } as unknown as FirestoreReader
  const posts = new ChannelPosts('me', credentials, () => ({ doc: channel, reader }), () => {})
  posts.open({ requestId: 'r1', channelId: 'ch-a' })
  const [policy] = watches
  assert.ok(policy, 'what this account may see is watched')
  policy.snapshot(new Map([[root, channel]]))
  const feed = watches[1]
  assert.ok(feed, 'then the posts are watched')
  feed.snapshot(new Map([[`${root}/posts/p1`, post('p1')], [`${root}/posts/p2`, post('p2')]]))
  assert.equal(posts.snapshot?.status, 'ready')
  assert.equal(posts.snapshot?.posts.length, 2)
  assert.equal(typeof feed.reconnecting, 'function')
  assert.equal(typeof policy.reconnecting, 'function')
  feed.reconnecting!(); policy.reconnecting!()
  assert.equal(posts.snapshot?.status, 'ready', 'still shown while they reconnect')
  assert.deepEqual(posts.snapshot?.posts.map(item => item.id).sort(), ['p1', 'p2'])
})

// An inquiry room with no messages yet, or one whose watch is still connecting, stays open to write in: what is written
// goes to the device queue (inquiry-sends.ts), which sends it once the connection is back, as Telegram lets a chat be
// written in while it says «Connecting...».
test('an empty inquiry room still takes a message while its watch connects, and hands it to the queue', async () => {
  const room = `${documents}/channelInquiries/ch-a_me`
  const roomDoc = { name: room, updateTime: at, createTime: at, fields: { channelOwnerId: { stringValue: 'owner1' }, subscriberId: { stringValue: 'me' },
    channelId: { stringValue: 'ch-a' }, channelName: { stringValue: '채널' } } } as unknown as FirestoreDocument
  const watches: { target: { query?: { parent?: string } }; events: WatchEvents }[] = []
  const reader = { getDocument: async () => roomDoc, watch: (target: { query?: { parent?: string } }, _signal: AbortSignal, events: WatchEvents) => { watches.push({ target, events }); return () => {} } }
  let connected = true
  const queued: InquirySendRequest[] = []
  const inquiries = new ChannelInquiries('me', credentials, () => { if (!connected) throw new Error('offline') }, () => ({ authorName: '나', authorPhotoURL: null }), () => true, () => {},
    async request => { queued.push(request) }, async () => {})
  ;(inquiries as unknown as { reader: unknown }).reader = reader
  const thread = { requestId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301', inquiryId: 'ch-a_me' }
  inquiries.openThread(thread)
  await new Promise(resolve => setImmediate(resolve))
  const messages = watches.find(watch => watch.target.query?.parent === room)
  assert.ok(messages, 'the room\'s messages are watched')
  messages.events.state('loading')
  connected = false
  const messageId = '9B2F1C3E-5A6D-4E7F-8A9B-0C1D2E3F4A5B'
  assert.equal(await inquiries.send({ ...thread, messageId, text: '안녕하세요' }), 'queued')
  assert.equal(queued.length, 1)
  assert.equal(queued[0]?.id, messageId)
  assert.equal(queued[0]?.message.text, '안녕하세요')
  inquiries.closeThread()
  await assert.rejects(inquiries.send({ ...thread, messageId, text: '또' }), 'a closed room takes nothing')
})
