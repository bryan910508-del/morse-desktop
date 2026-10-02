import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { channelDeleteRole } from '../../src/main/accounts/channel-delete-authority'
import { writeChannelPostRemoval, ChannelPostRemovalFailure } from '../../src/main/network/channel-post-removal-write'
import { writeChannelCommentRemoval, ChannelCommentRemovalFailure } from '../../src/main/network/channel-comment-removal-write'
import { channelPostRevision } from '../../src/main/media/channel-post-media-document'
import { documents, documentVersion, type FirestoreDocument, type WireObject } from '../../src/main/network/firestore-values'

// A1 contract §3-5 (user decision 2026-09-30, Telegram's rule, telegram-refs R-1/R-2): the channel's owner or an admin
// whose canDeleteMessages is stored true deletes any post or comment; an author their own; no one else.
const me = 'me', channelPath = `${documents}/channels/ch1`, postPath = `${channelPath}/posts/p1`
const stamp = { updateTime: { seconds: '1790121600', nanos: 0 }, createTime: { seconds: '1790121600', nanos: 0 } }
const channel = (owner: string): FirestoreDocument => ({ name: channelPath, ...stamp, fields: { ownerId: { stringValue: owner } } }) as unknown as FirestoreDocument
const admin = (fields: Record<string, unknown>, uid = me): FirestoreDocument => ({ name: `${channelPath}/admins/${uid}`, ...stamp, fields }) as unknown as FirestoreDocument
const flag = (value: boolean): Record<string, unknown> => ({ permissions: { mapValue: { fields: { canDeleteMessages: { booleanValue: value } } } } })

test('who may delete a channel post or comment', () => {
  assert.equal(channelDeleteRole(me, channel(me), undefined, 'someone'), 'owner')
  assert.equal(channelDeleteRole(me, channel('boss'), admin(flag(true)), 'someone'), 'moderator')
  assert.equal(channelDeleteRole(me, channel('boss'), admin(flag(false)), 'someone'), 'none')
  assert.equal(channelDeleteRole(me, channel('boss'), admin({}), 'someone'), 'none', 'a missing flag is off')
  assert.equal(channelDeleteRole(me, channel('boss'), admin(flag(true), 'other'), 'someone'), 'none', 'another person\'s admin document')
  assert.equal(channelDeleteRole(me, channel('boss'), admin({ userId: { stringValue: 'other' }, ...flag(true) }), 'someone'), 'none')
  assert.equal(channelDeleteRole(me, channel('boss'), undefined, me), 'author')
  assert.equal(channelDeleteRole(me, channel('boss'), undefined, 'someone'), 'none')
})

function client(sent: WireObject[][]) {
  return { commit: (request: WireObject, _metadata: unknown, _options: unknown, callback: (error: null, response: WireObject) => void) => {
    const writes = request.writes as WireObject[]
    sent.push(writes)
    queueMicrotask(() => callback(null, { commitTime: { seconds: '1790121700', nanos: 0 }, writeResults: writes.map(() => ({ updateTime: { seconds: '1790121700', nanos: 0 } })) }))
    return { cancel: () => {} }
  } } as never
}
const postDoc = (author: string): FirestoreDocument => ({ name: postPath, ...stamp, fields: { channelId: { stringValue: 'ch1' }, authorId: { stringValue: author }, commentCount: { integerValue: '1' } } }) as unknown as FirestoreDocument

test('the owner\'s post delete keeps the pin pointer in the same commit; an admin\'s deletes the post alone', async () => {
  for (const [owner, adminDoc, writes] of [[me, undefined, 2], ['boss', admin(flag(true)), 1]] as const) {
    const sent: WireObject[][] = [], ch = channel(owner), post = postDoc('someone')
    const op = randomUUID(), target = { id: op, requestId: op, channelId: 'ch1', channelVersion: documentVersion(ch), postId: 'p1', revision: channelPostRevision(post) }
    await writeChannelPostRemoval(client(sent), {} as never, me, target, { channel: ch, post, admin: adminDoc }, new AbortController().signal)
    assert.equal(sent[0]!.length, writes, owner === me ? 'owner' : 'admin')
    assert.ok(sent[0]!.every(write => !JSON.stringify(write).includes('/chats/')), 'never the discussion room\'s copy')
  }
  const ch = channel('boss'), post = postDoc('someone')
  const op = randomUUID()
  await assert.rejects(writeChannelPostRemoval(client([]), {} as never, me, { id: op, requestId: op, channelId: 'ch1', channelVersion: documentVersion(ch), postId: 'p1', revision: channelPostRevision(post) },
    { channel: ch, post }, new AbortController().signal), (error: unknown) => error instanceof ChannelPostRemovalFailure && !error.uncertain)
})

test('another person\'s comment is deleted only by a moderator', async () => {
  const post = postDoc('someone')
  const comment = { name: `${postPath}/comments/c1`, ...stamp, fields: { authorId: { stringValue: 'someone' }, text: { stringValue: '댓글' }, channelId: { stringValue: 'ch1' }, postId: { stringValue: 'p1' } } } as unknown as FirestoreDocument
  const removal = { id: 'op1', selectionId: 'op1', requestId: 'op1', channelId: 'ch1', postId: 'p1', revision: channelPostRevision(post), commentId: 'c1', commentRevision: channelPostRevision(comment), text: '댓글', count: 1 }
  await assert.rejects(writeChannelCommentRemoval(client([]), {} as never, me, removal, { post, comment }, new AbortController().signal), (error: unknown) => error instanceof ChannelCommentRemovalFailure)
  const sent: WireObject[][] = []
  await writeChannelCommentRemoval(client(sent), {} as never, me, removal, { post, comment, moderator: true }, new AbortController().signal)
  assert.equal(sent[0]!.length, 2, 'the comment and its post\'s count')
})
