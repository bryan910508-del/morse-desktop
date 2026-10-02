import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ChannelHome } from '../../src/main/accounts/channel-home'
import type { ChannelSummary } from '../../src/shared/channels'
import type { ReadCredentials } from '../../src/main/network/firestore-rpc'
import { documents, type FirestoreDocument } from '../../src/main/network/firestore-values'

const credentials: ReadCredentials = { signal: new AbortController().signal, authorize: async () => { throw new Error('unused') } }
const summary = (id: string, name: string, owned: boolean, seconds: number): ChannelSummary => ({
  id, name, owned, status: 'ready', version: null, publicSharing: null, hasAvatar: false, hasCover: false, avatar: null, cover: null, access: null, editableAccess: null,
  discussion: null, tags: null, description: '', subscriptionListed: !owned, type: 'public', subscriberCount: 10, postCount: 1, updated: { seconds, nanoseconds: 0, id }
})
const channelDoc = (id: string, name: string): FirestoreDocument => ({ name: `${documents}/channels/${id}`, fields: {
  name: { stringValue: name }, ownerId: { stringValue: 'someone' }, createdAt: { timestampValue: { seconds: '1788220800', nanos: 0 } }, isPublic: { booleanValue: true }, subscriberCount: { integerValue: '42' }
} })
const feedPost = (channelId: string, id: string, seconds: number, promoted = false) => ({
  channelId, promoted, doc: { name: `${documents}/channels/${channelId}/posts/${id}`, fields: {} },
  post: { id, text: id, position: { seconds, nanoseconds: 0, id }, mediaCount: 0, likeCount: 1, commentCount: 0, visibility: 'public' }
})

function home(allowed = true): { home: ChannelHome; state: Record<string, unknown> } {
  const items = [summary('mine', '내 채널', true, 30), summary('a', 'A', false, 20), summary('b', 'B', false, 10)]
  const value = new ChannelHome('me', credentials, { items: () => items, status: () => 'ready', document: () => null }, () => allowed, () => {})
  const state = value as unknown as Record<string, unknown>
  state.visible = true; state.status = 'ready'; state.discoverStatus = 'ready'
  return { home: value, state }
}

// ChannelFeedView: boosted posts lead, the organic timeline leaves them out, and the «구독 중» strip
// is the subscribed channels then the channels of the organic timeline (never a promoted stranger).
test('the channel tab puts promoted posts first and keeps promoted channels out of the subscribed strip', () => {
  const { home: value, state } = home()
  state.others = new Map([['p', channelDoc('p', '홍보')]])
  // The organic feed only ever holds the account's own channels; one of its posts is also promoted.
  state.feed = [feedPost('a', 'a1', 300), feedPost('mine', 'm1', 200), feedPost('b', 'shared', 100)]
  state.boosted = [feedPost('p', 'p1', 400, true), feedPost('b', 'shared', 100, true)]
  state.promoted = ['p']
  const snapshot = value.snapshot!
  assert.deepEqual(snapshot.posts.map(post => [post.id, post.promoted]), [['p1', true], ['shared', true], ['a1', false], ['m1', false]])
  assert.equal(snapshot.mine?.id, 'mine')
  assert.deepEqual(snapshot.subscribed.map(channel => channel.id), ['a', 'b', 'mine'])
  const promoted = snapshot.channels.find(channel => channel.id === 'p')
  assert.deepEqual(promoted && { listed: promoted.listed, name: promoted.name, subscriberCount: promoted.subscriberCount }, { listed: false, name: '홍보', subscriberCount: 42 })
  assert.deepEqual(snapshot.discover.promoted.map(channel => channel.id), ['p'])
})

test('the channel tab shows nothing while it is closed, locked or offline', () => {
  const closed = home(); closed.state.visible = false
  assert.equal(closed.home.snapshot, null)
  assert.equal(home(false).home.snapshot, null)
})

test('a post whose channel is no longer known is left out', () => {
  const { home: value, state } = home()
  state.feed = [feedPost('gone', 'g1', 100), feedPost('b', 'b1', 50)]
  assert.deepEqual(value.snapshot!.posts.map(post => post.id), ['b1'])
})

// A like, new words or a delete the channel operation queue has finished: the tab reads that post again at once instead
// of at its next reload a minute on, so new words show and a deleted post leaves it (Telegram takes a deleted message
// away locally at once: tdesktop Histories::deleteMessages).
test('a post read again after a finished change takes its new words, and one the server no longer has leaves the tab', () => {
  const { home: value, state } = home()
  const refreshed = (channelId: string, postId: string, fresh: FirestoreDocument | null): void =>
    (state.refreshed as (c: string, p: string, d: FirestoreDocument | null) => void).call(value, channelId, postId, fresh)
  state.feed = [feedPost('a', 'a1', 300), feedPost('a', 'a2', 200), feedPost('b', 'shared', 100)]
  state.boosted = [feedPost('b', 'shared', 100, true)]
  refreshed('a', 'a1', { name: `${documents}/channels/a/posts/a1`, fields: {
    channelId: { stringValue: 'a' }, authorId: { stringValue: 'someone' }, visibility: { stringValue: 'public' }, text: { stringValue: '고친 글' },
    createdAt: { timestampValue: { seconds: '300', nanos: 0 } }, commentCount: { integerValue: '2' } } } as unknown as FirestoreDocument)
  assert.deepEqual(value.snapshot!.posts.map(post => [post.id, post.text, post.commentCount]), [['shared', 'shared', 0], ['a1', '고친 글', 2], ['a2', 'a2', 0]])
  // Gone from the server: out of the organic timeline and the boosted row alike.
  refreshed('b', 'shared', null)
  assert.deepEqual(value.snapshot!.posts.map(post => post.id), ['a1', 'a2'])
  // A copy this account may no longer read (now for subscribers, read as public) leaves too; another post is untouched.
  state.boosted = [{ ...feedPost('b', 'b9', 50, true), scope: 'public' }]
  refreshed('b', 'b9', { name: `${documents}/channels/b/posts/b9`, fields: {
    channelId: { stringValue: 'b' }, authorId: { stringValue: 'someone' }, visibility: { stringValue: 'subscribers' }, text: { stringValue: 'x' },
    createdAt: { timestampValue: { seconds: '50', nanos: 0 } } } } as unknown as FirestoreDocument)
  assert.deepEqual(value.snapshot!.posts.map(post => post.id), ['a1', 'a2'])
})
