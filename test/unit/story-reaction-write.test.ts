import assert from 'node:assert/strict'
import { test } from 'node:test'
import { status } from '@grpc/grpc-js'
import { writeStoryReaction, StoryReactionWriteFailure } from '../../src/main/network/story-reaction-write'
import { database, documents, type FirestoreDocument, type WireObject } from '../../src/main/network/firestore-values'
import type { StoryReactionChangeRequest } from '../../src/shared/story-reaction-change'

// iOS StoryService.setReaction writes one map key and nothing else. The desktop proves what it
// replaces from a plain read, then commits the same single write — no transaction, no rollback.
const owner = 'owner1', viewer = 'viewer1'
const storyPath = `${documents}/users/${owner}/publicStories/story1`
const expiresSeconds = Math.floor(Date.now() / 1000) + 3600, expiresAt = expiresSeconds * 1000
const story = (fields: Record<string, WireObject> = {}): FirestoreDocument => ({
  name: storyPath,
  updateTime: { seconds: '100', nanos: 0 },
  fields: {
    authorId: { stringValue: owner },
    createdAt: { timestampValue: { seconds: String(expiresSeconds - 86400), nanos: 0 } },
    expiresAt: { timestampValue: { seconds: String(expiresSeconds), nanos: 0 } },
    mediaType: { stringValue: 'image' },
    ...fields,
  },
})
const request = (extra: Partial<StoryReactionChangeRequest> = {}): StoryReactionChangeRequest => ({
  id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301', viewerId: viewer, ownerId: owner, ownerName: 'Owner', storyId: 'story1',
  privacy: 'everyone', version: '100:0', expiresAt, captionPreview: '', original: null, desired: '❤️', ...extra,
})
const answered = (response: WireObject | Error): { commit: (request: WireObject, auth: unknown, options: unknown, callback: (error: unknown, response?: WireObject) => void) => { cancel(): void }; sent: WireObject[] } => {
  const sent: WireObject[] = []
  return { sent, commit: (body, _auth, _options, callback) => { sent.push(body); setImmediate(() => response instanceof Error ? callback(response) : callback(null, response)); return { cancel: () => {} } } }
}
const ok: WireObject = { writeResults: [{ updateTime: { seconds: '101', nanos: 0 } }], commitTime: { seconds: '101', nanos: 0 } }
const auth = {} as never

test('a chosen reaction is one update of the viewer’s own key on the story that exists', async () => {
  const client = answered(ok)
  await writeStoryReaction(client as never, auth, viewer, request(), story(), AbortSignal.timeout(5000), () => {})
  assert.equal(client.sent.length, 1)
  const body = client.sent[0]! as { database: string; transaction?: unknown; writes: { update: { name: string; fields: Record<string, unknown> }; updateMask: { fieldPaths: string[] }; currentDocument: Record<string, unknown> }[] }
  assert.equal(body.database, database)
  assert.equal(body.transaction, undefined, 'no transaction is begun, so none of its reads can be refused')
  assert.equal(body.writes.length, 1)
  assert.equal(body.writes[0]!.update.name, storyPath)
  assert.deepEqual(body.writes[0]!.updateMask.fieldPaths, ['reactionByUid.`viewer1`'])
  assert.deepEqual(body.writes[0]!.currentDocument, { exists: true }, 'the story must exist; its other fields may have moved on')
  assert.deepEqual(body.writes[0]!.update.fields, { reactionByUid: { mapValue: { fields: { viewer1: { stringValue: '❤️' } } } } })
})

test('taking a reaction back writes the key away, as FieldValue.delete() does', async () => {
  const client = answered(ok)
  const stored = story({ reactionByUid: { mapValue: { fields: { viewer1: { stringValue: '👍' } } } } })
  await writeStoryReaction(client as never, auth, viewer, request({ original: '👍', desired: null }), stored, AbortSignal.timeout(5000), () => {})
  const body = client.sent[0]! as { writes: { update: { fields: Record<string, unknown> }; updateMask: { fieldPaths: string[] } }[] }
  assert.deepEqual(body.writes[0]!.update.fields, {})
  assert.deepEqual(body.writes[0]!.updateMask.fieldPaths, ['reactionByUid.`viewer1`'])
})

test('another viewer’s reaction or receipt is not a conflict, but this viewer’s own change is', async () => {
  const moved = story({
    viewerIds: { arrayValue: { values: [{ stringValue: 'someone-else' }] } },
    reactionByUid: { mapValue: { fields: { other: { stringValue: '🔥' } } } },
  })
  const client = answered(ok)
  await writeStoryReaction(client as never, auth, viewer, request(), moved, AbortSignal.timeout(5000), () => {})
  assert.equal(client.sent.length, 1, 'the story document having moved on does not stop the write')

  const mine = story({ reactionByUid: { mapValue: { fields: { viewer1: { stringValue: '😂' } } } } })
  const refused = answered(ok)
  await assert.rejects(writeStoryReaction(refused as never, auth, viewer, request(), mine, AbortSignal.timeout(5000), () => {}),
    (error: unknown) => error instanceof StoryReactionWriteFailure && !error.uncertain)
  assert.equal(refused.sent.length, 0, 'the reaction being replaced is no longer the one that was reviewed')
})

test('a hidden viewer, an expired story and the wrong story never reach the server', async () => {
  const hidden = answered(ok)
  await assert.rejects(writeStoryReaction(hidden as never, auth, viewer, request(), story({ hiddenFrom: { arrayValue: { values: [{ stringValue: viewer }] } } }), AbortSignal.timeout(5000), () => {}),
    (error: unknown) => error instanceof StoryReactionWriteFailure && !error.uncertain)
  const stale = answered(ok)
  await assert.rejects(writeStoryReaction(stale as never, auth, viewer, request({ expiresAt: expiresAt - 1000 }), story(), AbortSignal.timeout(5000), () => {}),
    (error: unknown) => error instanceof StoryReactionWriteFailure && !error.uncertain)
  const elsewhere = answered(ok)
  await assert.rejects(writeStoryReaction(elsewhere as never, auth, viewer, request(), { ...story(), name: `${documents}/users/${owner}/publicStories/story2` }, AbortSignal.timeout(5000), () => {}),
    (error: unknown) => error instanceof StoryReactionWriteFailure && !error.uncertain)
  assert.equal(hidden.sent.length + stale.sent.length + elsewhere.sent.length, 0)
})

test('a refusal is final, a lost answer is not', async () => {
  const denied = answered(Object.assign(new Error('7 PERMISSION_DENIED'), { code: status.PERMISSION_DENIED }))
  await assert.rejects(writeStoryReaction(denied as never, auth, viewer, request(), story(), AbortSignal.timeout(5000), () => {}),
    (error: unknown) => error instanceof StoryReactionWriteFailure && !error.uncertain)
  const lost = answered(Object.assign(new Error('14 UNAVAILABLE'), { code: status.UNAVAILABLE }))
  await assert.rejects(writeStoryReaction(lost as never, auth, viewer, request(), story(), AbortSignal.timeout(5000), () => {}),
    (error: unknown) => error instanceof StoryReactionWriteFailure && error.uncertain)
})
