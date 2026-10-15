import assert from 'node:assert/strict'
import { mock, test } from 'node:test'
import { PeerStories, failureCode, type PeerStoryFeed } from '../../src/main/accounts/peer-stories'
import { PeerStoryPhoto } from '../../src/main/accounts/peer-story-media'
import { StoryMediaCache } from '../../src/main/accounts/story-media-cache'
import { DocumentWriteFailure, FirestoreReader, type ReadCredentials } from '../../src/main/network/firestore-rpc'
import { documents, ReadFailure, type FirestoreDocument, type WireObject } from '../../src/main/network/firestore-values'
import { laterMark, type FeedStory, type StoryReadMark } from '../../src/main/network/story-feed-document'
import { callableStories } from '../../src/main/network/story-views'
import { replyCurrentSource } from '../../src/main/network/story-reply-current-source'
import { storyReplyDraftPrepare } from '../../src/shared/story-reply-draft'
import { peerStoryReaction } from '../../src/shared/peer-stories'

// B408 S2 (contracts/B408-stories-access.md §14): a person's stories open from this account's feed, else from
// getMorsePeerStories; seeing one moves the read mark and writes views/{me}.viewedAt once (not while viewing unseen);
// a reaction is that record's field; media come only from the addresses named; a reply is checked by the feed copy.
const now = 1_800_000_000_000
const story = (id: string, created: number, extra: Partial<FeedStory> = {}): FeedStory => ({
  ownerType: 'user', ownerId: 'ann', storyId: id, authorId: 'ann', collection: 'publicStories', privacy: 'everyone',
  storyPath: `${documents}/users/ann/publicStories/${id}`, source: 'audience', createdAt: created, expiresAt: created + 86400000,
  caption: 'hi', mediaType: 'image', hasThumbnail: false, audio: 'none', mediaURL: 'https://firebasestorage.googleapis.com/v0/b/x/o/stories%2Fann%2Fa.jpg?alt=media',
  thumbnailURL: null, audioURL: null, version: '1:0', ...extra
})
function feed(stories: FeedStory[], readMark?: StoryReadMark): PeerStoryFeed & { marks: StoryReadMark[] } {
  let current = readMark
  const marks: StoryReadMark[] = []
  return {
    marks,
    feedStories: (_type, owner) => stories.filter(item => item.ownerId === owner),
    mark: () => current,
    noteRead: item => { if (!laterMark(current, item)) return false; current = { ownerType: 'user', ownerId: item.ownerId, maxReadCreatedAt: item.createdAt, maxReadStoryId: item.storyId }; marks.push(current); return true },
    inFeed: path => stories.some(item => item.storyPath === path)
  }
}
const auth = (): ReadCredentials => ({ signal: new AbortController().signal } as unknown as ReadCredentials)
function writes(views: Record<string, FirestoreDocument | null> = {}) {
  const log: WireObject[] = [], reads: string[] = []
  mock.method(FirestoreReader.prototype, 'commitStoryWrite', async (write: WireObject) => { log.push(write) })
  mock.method(FirestoreReader.prototype, 'getDocument', async (path: string) => { reads.push(path); return views[path] ?? null })
  return { log, reads }
}
const path = (write: WireObject): string => (write.update as { name: string }).name

test('a person is opened from the feed; getMorsePeerStories only when the feed has none of theirs', async () => {
  writes()
  let asked = 0
  const fromFeed = new PeerStories('me', auth(), feed([story('s1', now - 1000), story('old', now - 90000000)]), () => {}, () => false, async () => { asked++; return { stories: [] } }, () => now)
  const opened = await fromFeed.open({ id: 'r1', ownerId: 'ann' })
  assert.equal(asked, 0)
  assert.deepEqual(opened.rows.map(row => row.id), ['s1'], 'an ended copy is not shown')
  assert.equal(opened.outcome, 'ready')
  const asking = new PeerStories('me', auth(), feed([]), () => {}, () => false, async owner => { asked++; assert.equal(owner, 'bob'); return { stories: [{ id: 'p1', collection: 'publicStories', authorId: 'bob', mediaURL: 'https://x/a.jpg', mediaType: 'image', createdAt: { _ms: now - 5000 }, expiresAt: { _ms: now + 5000 } }] } }, () => now)
  const fetched = await asking.open({ id: 'r2', ownerId: 'bob' })
  assert.equal(asked, 1)
  assert.deepEqual(fetched.rows.map(row => [row.id, row.privacy]), [['p1', 'everyone']])
  await assert.rejects(asking.open({ id: 'r3', ownerId: 'me' }), 'my own stories are not opened as someone else\'s')
  mock.restoreAll()
})

test('seeing a story moves the read mark and writes viewedAt once; viewing unseen writes the mark only', async () => {
  const items = [story('s1', now - 2000), story('s2', now - 1000)]
  const { log } = writes()
  const marks = feed(items)
  const peer = new PeerStories('me', auth(), marks, () => {}, () => false, undefined, () => now)
  await peer.open({ id: 'r1', ownerId: 'ann' })
  await peer.seen({ requestId: 'r1', storyId: 's1', version: '1:0' })
  await peer.seen({ requestId: 'r1', storyId: 's1', version: '1:0' })
  assert.deepEqual(log.map(path), [`${documents}/users/me/storyReadMarks/user_ann`, `${documents}/users/ann/publicStories/s1/views/me`], 'the second showing writes nothing')
  assert.deepEqual(log[1]!.updateTransforms, [{ fieldPath: 'viewedAt', setToServerValue: 'REQUEST_TIME' }])
  log.length = 0
  const quiet = new PeerStories('me', auth(), feed(items), () => {}, () => true, undefined, () => now)
  await quiet.open({ id: 'r2', ownerId: 'ann' })
  await quiet.seen({ requestId: 'r2', storyId: 's2', version: '1:0' })
  assert.deepEqual(log.map(path), [`${documents}/users/me/storyReadMarks/user_ann`])
  await assert.rejects(quiet.seen({ requestId: 'r2', storyId: 's2', version: '2:0' }), 'a story that changed is not written')
  mock.restoreAll()
})

test('a view already on the server is not written again; a reaction is set, changed and taken back on views/{me}', async () => {
  const items = [story('s1', now - 2000)]
  const mine = `${documents}/users/ann/publicStories/s1/views/me`
  const { log, reads } = writes({ [mine]: { name: mine, fields: { viewedAt: { timestampValue: { seconds: '1', nanos: 0 } }, reaction: { stringValue: '🔥' } } } as unknown as FirestoreDocument })
  const peer = new PeerStories('me', auth(), feed(items, { ownerType: 'user', ownerId: 'ann', maxReadCreatedAt: now, maxReadStoryId: 'z' }), () => {}, () => false, undefined, () => now)
  await peer.open({ id: 'r1', ownerId: 'ann' })
  await peer.seen({ requestId: 'r1', storyId: 's1', version: '1:0' })
  assert.deepEqual(log, [], 'read already, viewed already')
  assert.equal(await peer.reaction({ requestId: 'r1', storyId: 's1', version: '1:0' }), '🔥')
  assert.equal(await peer.react({ requestId: 'r1', storyId: 's1', version: '1:0', emoji: '❤️' }), '❤️')
  assert.equal(await peer.react({ requestId: 'r1', storyId: 's1', version: '1:0', emoji: null }), null)
  assert.deepEqual(log.map(write => [path(write), (write.update as { fields: Record<string, unknown> }).fields, write.currentDocument]), [
    [mine, { reaction: { stringValue: '❤️' } }, undefined],
    [mine, {}, { exists: true }]
  ])
  assert.equal(reads.length, 1, 'this account\'s record is read once')
  assert.throws(() => peerStoryReaction({ requestId: 'r1', storyId: 's1', version: '1:0', emoji: '🙂' }), 'only the shared reactions')
  mock.restoreAll()
})

test('a story the callable gave keeps its addresses; media come only from them', async () => {
  writes()
  const [given] = callableStories({ stories: [{ id: 'p1', collection: 'closeFriendStories', authorId: 'bob', mediaURL: 'https://x/a.mp4', mediaType: 'video', createdAt: { _ms: now - 1500 }, expiresAt: { _ms: now + 5000 } }] }, 'user', 'bob')
  assert.equal(given!.version, `${Math.floor((now - 1500) / 1000)}:${500 * 1e6}`)
  assert.equal(given!.privacy, 'closeFriends')
  assert.equal(given!.storyPath, `${documents}/users/bob/closeFriendStories/p1`)
  const peer = new PeerStories('me', auth(), feed([story('s1', now - 2000, { mediaURL: 'https://elsewhere.example/a.jpg' })]), () => {}, () => false, undefined, () => now)
  await peer.open({ id: 'r1', ownerId: 'ann' })
  assert.equal(peer.detail({ requestId: 'r1', storyId: 's1', version: '1:0' }).image, null, 'an address outside the owner\'s files is not one')
  const photo = new PeerStoryPhoto('me', auth(), target => peer.detail(target), new StoryMediaCache(), () => {})
  assert.throws(() => photo.open({ selectionId: '00000000-0000-4000-8000-000000000001', requestId: 'r1', storyId: 's1', version: '1:0', presentation: 'image' }), 'no address, nothing read')
  await photo.close(); peer.dispose()
  mock.restoreAll()
})

test('a reply is prepared from the open story and checked by this account\'s copy of it', () => {
  assert.deepEqual(storyReplyDraftPrepare({ id: '00000000-0000-4000-8000-000000000002', requestId: 'r1', storyId: 's1', version: '1:0' }), { id: '00000000-0000-4000-8000-000000000002', requestId: 'r1', storyId: 's1', version: '1:0' })
  assert.throws(() => storyReplyDraftPrepare({ id: '00000000-0000-4000-8000-000000000002', requestId: 'r1', storyId: 's1', version: '1:0', privacy: 'everyone' }))
  const iso = (ms: number) => ({ seconds: String(Math.floor(ms / 1000)), nanos: (ms % 1000) * 1e6 })
  const copy = (owner: string, collection: string): FirestoreDocument => ({
    name: `${documents}/users/me/storyFeed/${owner}_s1`, updateTime: { seconds: '9', nanos: 0 },
    fields: { ownerType: { stringValue: 'user' }, ownerId: { stringValue: owner }, storyId: { stringValue: 's1' }, collection: { stringValue: collection },
      storyPath: { stringValue: `users/${owner}/${collection}/s1` }, authorId: { stringValue: owner }, mediaURL: { stringValue: 'https://x/a.jpg' }, mediaType: { stringValue: 'image' },
      caption: { stringValue: 'new words' }, createdAt: { timestampValue: iso(now - 1000) }, expiresAt: { timestampValue: iso(now + 5000) } }
  } as unknown as FirestoreDocument)
  const pending = { id: 'x', viewerId: 'me', ownerId: 'ann', ownerName: 'Ann', storyId: 's1', privacy: 'contacts' as const, version: '1:0', expiresAt: now + 5000, captionPreview: 'hi' }
  assert.deepEqual(replyCurrentSource(pending, copy('ann', 'stories')), { version: '9:0', expiresAt: now + 5000, captionPreview: 'new words' })
  assert.throws(() => replyCurrentSource(pending, copy('ann', 'publicStories')), 'moved to another audience')
  assert.throws(() => replyCurrentSource(pending, copy('bob', 'stories')), 'another person\'s copy')
})

test('B416: a failed view is logged by its class and status only, never its message', () => {
  assert.equal(failureCode(new DocumentWriteFailure(false, 7, 'users/ann/stories/s1/views/me denied')), 'DocumentWriteFailure PERMISSION_DENIED')
  assert.equal(failureCode(new DocumentWriteFailure(true)), 'DocumentWriteFailure uncertain')
  assert.equal(failureCode(new ReadFailure('permission', 'projects/x/databases/(default)/documents/users/ann')), 'ReadFailure permission')
  assert.equal(failureCode(new Error('users/ann/publicStories/s1')), 'Error')
  assert.equal(failureCode('nope'), 'unknown')
})
