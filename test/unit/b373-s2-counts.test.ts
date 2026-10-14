import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { writeChannelPostLike } from '../../src/main/network/channel-post-like-write'
import { channelPostLikeState } from '../../src/main/accounts/channel-post-like-state'
import { writeChannelCommentCreation } from '../../src/main/network/channel-comment-creation-write'
import { writeChannelCommentRemoval } from '../../src/main/network/channel-comment-removal-write'
import { channelPostRevision } from '../../src/main/media/channel-post-media-document'
import { commentCreationRequest } from '../../src/shared/channel-comment-creation'
import { commentCountView, nudgeCommentCount } from '../../src/shared/channel-operations'
import { documents, type FirestoreDocument, type WireObject } from '../../src/main/network/firestore-values'

// B373 S2 (reports/server/2026-10-14-b373-plan.md §8, review 10-14 14:1x): since rules v4.8.37 and the recount functions
// (S1, 13:40), the server counts a post's likes from likedBy and its comments from the comment documents. Desktop writes
// the list and the comment only, and its screens show the server's count, moved by one right after this device's change.
const postPath = `${documents}/channels/ch1/posts/p1`
const stamp = { updateTime: { seconds: '1790121600', nanos: 0 }, createTime: { seconds: '1790121600', nanos: 0 } }
const post = (likedBy: string[], likeCount: number, commentCount = 2) => ({ name: postPath, ...stamp, fields: {
  likedBy: { arrayValue: { values: likedBy.map(stringValue => ({ stringValue })) } }, likeCount: { integerValue: String(likeCount) },
  commentCount: { integerValue: String(commentCount) }, authorId: { stringValue: 'owner' } } }) as unknown as FirestoreDocument
function client(sent: WireObject[][], withTransform = false) {
  return { commit: (request: WireObject, _metadata: unknown, _options: unknown, callback: (error: null, response: WireObject) => void) => {
    const writes = request.writes as WireObject[]; sent.push(writes)
    queueMicrotask(() => callback(null, { commitTime: { seconds: '1790121700', nanos: 0 }, writeResults: writes.map(() => ({ updateTime: { seconds: '1790121700', nanos: 0 },
      ...(withTransform ? { transformResults: [{ timestampValue: { seconds: '1790121700', nanos: 0 } }] } : {}) })) }))
    return {} as never
  } } as never
}

test('a like writes the list only, and a stored count that differs from the list no longer holds it back', async () => {
  const doc = post(['a', 'b'], 5)
  const state = channelPostLikeState(doc, 'me')
  assert.equal(state.info.status, 'ready', 'the list is the likes; the server corrects the count')
  assert.equal(state.info.count, 2)
  const sent: WireObject[][] = []
  await writeChannelPostLike(client(sent), {} as never, 'me', { id: 'op1', requestId: 'op1', channelId: 'ch1', postId: 'p1', revision: channelPostRevision(doc), selected: false, count: 2, desired: true }, doc, new AbortController().signal)
  const write = sent[0]![0] as { update: { fields: Record<string, unknown> }; updateMask: { fieldPaths: string[] } }
  assert.deepEqual(write.updateMask.fieldPaths, ['likedBy'])
  assert.deepEqual(Object.keys(write.update.fields), ['likedBy'])
})

const author = { authorId: 'me', authorName: '나', authorPhotoURL: null, profileVersion: '1:0' }
const draft = { channelId: 'ch1', postId: 'p1', id: '11111111-1111-4111-8111-111111111111', draftRevision: '22222222-2222-4222-8222-222222222222', text: '댓글' }
test('a comment is written alone — the post\'s count is the server\'s; one queued by an earlier version still reads', async () => {
  const doc = post([], 0, 7), sent: WireObject[][] = []
  const request = commentCreationRequest({ ...draft, ...author, postRevision: channelPostRevision(doc) })
  assert.equal('count' in request, false)
  await writeChannelCommentCreation(client(sent, true), {} as never, 'me', request, doc, new AbortController().signal)
  assert.equal(sent[0]!.length, 1)
  assert.match(JSON.stringify(sent[0]![0]), /\/comments\//)
  assert.ok(!JSON.stringify(sent[0]).includes('commentCount'))
  const legacy = commentCreationRequest({ ...draft, ...author, postRevision: channelPostRevision(doc), count: 7 })
  assert.equal('count' in legacy, false, 'a stored request of 0.241.29 is read and its count left behind')
  assert.throws(() => commentCreationRequest({ ...draft, ...author, postRevision: channelPostRevision(doc), count: -1 }))
})

test('a comment delete deletes the comment only', async () => {
  const doc = post([], 0, 1), sent: WireObject[][] = []
  const comment = { name: `${postPath}/comments/c1`, ...stamp, fields: { authorId: { stringValue: 'me' }, text: { stringValue: '댓글' }, channelId: { stringValue: 'ch1' }, postId: { stringValue: 'p1' } } } as unknown as FirestoreDocument
  await writeChannelCommentRemoval(client(sent), {} as never, 'me', { id: 'op1', selectionId: 'op1', requestId: 'op1', channelId: 'ch1', postId: 'p1',
    revision: channelPostRevision(doc), commentId: 'c1', commentRevision: channelPostRevision(comment), text: '댓글' }, { post: doc, comment }, new AbortController().signal)
  assert.deepEqual(sent[0]!.map(write => Object.keys(write)[0]), ['delete'])
})

test('the screen: the server\'s count, moved by this device\'s change until the server\'s moves, for 15 seconds at most', () => {
  assert.equal(commentCountView(4, null, 0), 4)
  const sent = nudgeCommentCount(null, 4, 1, 1000)
  assert.equal(commentCountView(4, sent, 1500), 5, 'sent: one more right away')
  assert.equal(commentCountView(5, sent, 2500), 5, 'the server counted it: its count')
  assert.equal(commentCountView(4, sent, 1000 + 15001), 4, 'never counted: the server\'s again')
  const two = nudgeCommentCount(sent, 4, 1, 1200)
  assert.equal(commentCountView(4, two, 1300), 6, 'two sent before the server moved')
  const removed = nudgeCommentCount(null, 1, -1, 0)
  assert.equal(commentCountView(1, removed, 10), 0)
  assert.equal(commentCountView(0, nudgeCommentCount(null, 0, -1, 0), 10), 0, 'never below none')
  assert.equal(commentCountView(null, sent, 1500), null)
})

test('sending and deleting a comment nudge the count, and the three screens draw it', () => {
  const panel = readFileSync('src/renderer/src/channels/channel-comments-panel.tsx', 'utf8')
  assert.match(panel, /nudgeComments\(accountUid, channelId, postId, count, 1\)/)
  assert.match(panel, /nudgeComments\(accountUid, channelId, postId, post\.commentCount, -1\)/)
  assert.match(panel, /const total = commentCountFor\(accountUid, channelId, postId, post\?\.commentCount \?\? null\) \?\? 0/)
  assert.match(readFileSync('src/renderer/src/channels/channel-section.tsx', 'utf8'), /comments=\{commentCountFor\(accountUid, channelId, post\.id, post\.commentCount\)\}/)
  assert.match(readFileSync('src/renderer/src/channels/channel-home.tsx', 'utf8'), /const comments = commentCountFor\(accountUid, post\.channelId, post\.id, post\.commentCount\)/)
})
