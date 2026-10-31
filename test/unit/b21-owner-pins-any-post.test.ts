import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { documents, type FirestoreDocument } from '../../src/main/network/firestore-values'
import { channelPostRevision } from '../../src/main/media/channel-post-media-document'
import { ChannelPostPinFailure, writeChannelPostPin } from '../../src/main/network/channel-post-pin-write'
import { writeChannelPostPinResolution } from '../../src/main/network/channel-post-pin-resolution-write'
import { writeChannelPostExtraPin } from '../../src/main/network/channel-post-extra-pin-write'
import { postPinBase, postPinRequestCurrent, preparePostPin } from '../../src/renderer/src/channels/channel-post-pin-state'
import { canClearExtraPin, referencedUnpinnedPost } from '../../src/renderer/src/channels/channel-post-pin-extra-state'
import type { ChannelPostsSnapshot, ChannelPostText } from '../../src/shared/channel-posts'
import type { ChannelPostPinInfo } from '../../src/shared/channel-post-pins'

// B21 (rules v4.8.43, firestore.rules:1794-1810): the channel's owner, or an admin holding canPinMessages, changes a
// post's isPinned alone, whoever wrote it; pinnedPostId stays on the channel document, which only the owner writes. So
// pinning stays the owner's (iOS 422f66dd mayPin), and the post's author no longer matters.
const me = 'owner', admin = 'admin', channelId = 'c1'
const at = (seconds: number) => ({ seconds: String(seconds), nanos: 0 })
const channelDoc = (owner: string, pinned: string | null): FirestoreDocument => ({ name: `${documents}/channels/${channelId}`, updateTime: at(100),
  fields: { ownerId: { stringValue: owner }, ...(pinned ? { pinnedPostId: { stringValue: pinned } } : {}) } } as unknown as FirestoreDocument)
const postDoc = (id: string, author: string, pinned: boolean): FirestoreDocument => ({ name: `${documents}/channels/${channelId}/posts/${id}`, updateTime: at(90),
  fields: { channelId: { stringValue: channelId }, authorId: { stringValue: author }, text: { stringValue: 'post' }, isPinned: { booleanValue: pinned } } } as unknown as FirestoreDocument)
function client() {
  const sent: { writes: { update: { name: string; fields: Record<string, unknown> }; updateMask: { fieldPaths: string[] } }[] }[] = []
  return { sent, commit(request: never, _metadata: unknown, _options: unknown, callback: (error: unknown, response: unknown) => void) {
    sent.push(request)
    const writes = (request as { writes: unknown[] }).writes
    queueMicrotask(() => callback(null, { writeResults: writes.map(() => ({ updateTime: at(200) })), commitTime: at(200) }))
    return { cancel() {} }
  } }
}
const auth = {} as never
const signal = () => new AbortController().signal

test('the owner pins an admin\'s post: the channel names it and the post alone gets isPinned', async () => {
  const fake = client(), next = postDoc('p2', admin, false)
  await writeChannelPostPin(fake as never, auth, me, { id: crypto.randomUUID(), requestId: 'r1', channelId, channelVersion: '100:0', previous: null,
    next: { postId: 'p2', revision: channelPostRevision(next) } }, { channel: channelDoc(me, null), previous: null, next }, signal())
  const writes = fake.sent[0]!.writes
  assert.deepEqual(writes.map(write => write.updateMask.fieldPaths), [['pinnedPostId'], ['isPinned']])
  assert.deepEqual(writes[1]!.update.fields, { isPinned: { booleanValue: true } })
})

test('the owner swaps a pinned admin post for another one: the old mark goes and the new one comes in the same commit', async () => {
  const fake = client(), previous = postDoc('p1', admin, true), next = postDoc('p2', 'someone', false)
  await writeChannelPostPin(fake as never, auth, me, { id: crypto.randomUUID(), requestId: 'r1', channelId, channelVersion: '100:0',
    previous: { postId: 'p1', revision: channelPostRevision(previous) }, next: { postId: 'p2', revision: channelPostRevision(next) } }, { channel: channelDoc(me, 'p1'), previous, next }, signal())
  assert.deepEqual(fake.sent[0]!.writes.slice(1).map(write => [write.update.name.split('/').pop(), write.update.fields]), [['p1', { isPinned: { booleanValue: false } }], ['p2', { isPinned: { booleanValue: true } }]])
})

test('anyone but the owner is refused before any write, author or not', async () => {
  const fake = client(), next = postDoc('p2', me, false)
  await assert.rejects(writeChannelPostPin(fake as never, auth, me, { id: crypto.randomUUID(), requestId: 'r1', channelId, channelVersion: '100:0', previous: null,
    next: { postId: 'p2', revision: channelPostRevision(next) } }, { channel: channelDoc(admin, null), previous: null, next }, signal()), ChannelPostPinFailure)
  assert.equal(fake.sent.length, 0)
})

test('the owner also restores or clears the mark of an admin\'s post, and clears an admin post\'s extra mark', async () => {
  const resolved = client(), named = postDoc('p1', admin, false)
  await writeChannelPostPinResolution(resolved as never, auth, me, { id: crypto.randomUUID(), requestId: 'r1', channelId, channelVersion: '100:0', postId: 'p1',
    revision: channelPostRevision(named), action: 'restore' }, { channel: channelDoc(me, 'p1'), post: named }, signal())
  assert.deepEqual(resolved.sent[0]!.writes[1]!.update.fields, { isPinned: { booleanValue: true } })
  const extra = client(), marked = postDoc('p3', admin, true)
  await writeChannelPostExtraPin(extra as never, auth, me, { id: crypto.randomUUID(), requestId: 'r1', channelId, channelVersion: '100:0', referenceId: 'p1', referenceSource: 'value',
    postId: 'p3', revision: channelPostRevision(marked) }, { channel: channelDoc(me, 'p1'), post: marked }, signal())
  assert.deepEqual(extra.sent[0]!.writes.at(-1)!.update.fields, { isPinned: { booleanValue: false } })
})

const pins = (owned: boolean, pinned: string | null): ChannelPostPinInfo => ({ owned, channelVersion: '100:0', reference: pinned ? { status: 'known', postId: pinned, source: 'value' } : { status: 'none', postId: null, source: 'missing' },
  targetFlag: null, flaggedCount: 0, missingCount: 0, unknownCount: 0, comparison: 'compatible', message: '' })
const post = (id: string, own: boolean, pinFlag: ChannelPostText['pinFlag']): ChannelPostText => ({ id, own, pinFlag, editableText: 'post', revision: channelPostRevision(postDoc(id, own ? me : admin, pinFlag === 'pinned')) } as unknown as ChannelPostText)
const snapshot = (owned: boolean, pinned: string | null, posts: ChannelPostText[]): ChannelPostsSnapshot => ({ requestId: 'r1', channelId, status: 'ready', pins: pins(owned, pinned), posts } as unknown as ChannelPostsSnapshot)

test('the owner\'s menu offers pin and unpin on any post; a channel that is not the owner\'s offers none', () => {
  const owned = snapshot(true, 'p1', [post('p1', false, 'pinned'), post('p2', false, 'unpinned')])
  assert.equal(postPinBase(owned)?.previous?.id, 'p1', 'a pinned admin post can be unpinned')
  const request = preparePostPin(owned, 'p2')
  assert.deepEqual([request.previous?.postId, request.next?.postId], ['p1', 'p2'])
  assert.equal(postPinRequestCurrent(owned, request), true)
  assert.equal(postPinBase(snapshot(false, null, [post('p2', true, 'unpinned')])), null, 'an admin, even on their own post')
})

test('the extra-mark and named-but-unmarked repairs reach an admin\'s post too', () => {
  assert.equal(canClearExtraPin(snapshot(true, 'p1', [post('p1', false, 'pinned'), post('p3', false, 'pinned')]), 'p3'), true)
  assert.equal(referencedUnpinnedPost(snapshot(true, 'p1', [post('p1', false, 'unpinned')]))?.id, 'p1')
  assert.equal(canClearExtraPin(snapshot(false, 'p1', [post('p3', true, 'pinned')]), 'p3'), false)
})

test('only the pin paths drop the author: a post\'s text and its audience stay its author\'s', () => {
  const posts = readFileSync('src/main/accounts/channel-posts.ts', 'utf8')
  const body = (name: string) => posts.slice(posts.indexOf(`private ${name}(`), posts.indexOf('\n  }\n', posts.indexOf(`private ${name}(`)))
  for (const name of ['pinSource', 'pinResolutionSource', 'extraPinSource']) {
    assert.doesNotMatch(body(name), /'authorId'/, name)
    assert.match(body(name), /'ownerId', 160\) !== this\.uid\) throw/, name)
  }
  assert.match(body('visibilitySource'), /'authorId', 160\) !== this\.uid/)
  for (const file of ['channel-post-pin-write', 'channel-post-pin-resolution-write', 'channel-post-extra-pin-write']) assert.doesNotMatch(readFileSync(`src/main/network/${file}.ts`, 'utf8'), /'authorId'/, file)
  assert.match(readFileSync('src/renderer/src/channels/channel-section.tsx', 'utf8'), /const canPin = owner && Boolean\(base\)/)
})
