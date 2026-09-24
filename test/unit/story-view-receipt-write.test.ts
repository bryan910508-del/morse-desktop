import assert from 'node:assert/strict'
import { test } from 'node:test'
import { status } from '@grpc/grpc-js'
import { writeStoryViewReceipt, StoryViewReceiptWriteFailure } from '../../src/main/network/story-view-receipt-write'
import { database, documents, type FirestoreDocument, type WireObject } from '../../src/main/network/firestore-values'
import type { StoryViewReceiptRequest } from '../../src/shared/story-view-receipt'

// iOS StoryService.markViewed records a view with one write — arrayUnion on viewerIds and a server
// timestamp under this viewer's own key — which is the shape firestore.rules storyViewerMutation
// allows. This began as a transaction and never once succeeded: story-check.log carried
// `receipt-start-failed grpc-7` from every run, because a transaction's own reads are refused here.
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
const request = (extra: Partial<StoryViewReceiptRequest> = {}): StoryViewReceiptRequest => ({
  id: '3f2504e0-4f89-41d3-9a0c-0305e82c3302', viewerId: viewer, ownerId: owner, ownerName: 'Owner', storyId: 'story1',
  privacy: 'everyone', version: '100:0', expiresAt, captionPreview: '', viewerFieldPresent: false,
  originalTimeField: 'missing', originalViewedAt: null, ...extra,
})
const answered = (response: WireObject | Error): { commit: (request: WireObject, auth: unknown, options: unknown, callback: (error: unknown, response?: WireObject) => void) => { cancel(): void }; sent: WireObject[] } => {
  const sent: WireObject[] = []
  return { sent, commit: (body, _auth, _options, callback) => { sent.push(body); setImmediate(() => response instanceof Error ? callback(response) : callback(null, response)); return { cancel: () => {} } } }
}
const ok: WireObject = { writeResults: [{ updateTime: { seconds: '101', nanos: 0 }, transformResults: [{ nullValue: 'NULL_VALUE' }, { timestampValue: { seconds: '101', nanos: 0 } }] }], commitTime: { seconds: '101', nanos: 0 } }
const auth = {} as never

test('a view is one commit of the two transforms iOS writes, and begins no transaction', async () => {
  const client = answered(ok)
  await writeStoryViewReceipt(client as never, auth, viewer, request(), story(), AbortSignal.timeout(5000), () => {})
  assert.equal(client.sent.length, 1)
  const body = client.sent[0]! as { database: string; transaction?: unknown; writes: { transform: { document: string; fieldTransforms: unknown[] }; currentDocument: Record<string, unknown> }[] }
  assert.equal(body.database, database)
  assert.equal(body.transaction, undefined, 'no transaction is begun, so none of its reads can be refused')
  assert.equal(body.writes.length, 1)
  assert.equal(body.writes[0]!.transform.document, storyPath)
  assert.deepEqual(body.writes[0]!.transform.fieldTransforms, [
    { fieldPath: 'viewerIds', appendMissingElements: { values: [{ stringValue: viewer }] } },
    { fieldPath: 'viewedAtByUid.`viewer1`', setToServerValue: 'REQUEST_TIME' }
  ])
  assert.deepEqual(body.writes[0]!.currentDocument, { exists: true }, 'the story must exist; its other fields may have moved on')
})

test('another viewer arriving first is not a conflict, but this viewer already being listed is', async () => {
  const moved = story({
    viewerIds: { arrayValue: { values: [{ stringValue: 'someone-else' }] } },
    viewedAtByUid: { mapValue: { fields: { 'someone-else': { timestampValue: { seconds: '99', nanos: 0 } } } } },
  })
  const client = answered(ok)
  await writeStoryViewReceipt(client as never, auth, viewer, request({ viewerFieldPresent: true, originalTimeField: 'absent' }), moved, AbortSignal.timeout(5000), () => {})
  assert.equal(client.sent.length, 1, 'the story document having moved on does not stop the write')

  const already = story({ viewerIds: { arrayValue: { values: [{ stringValue: viewer }] } } })
  const refused = answered(ok)
  await assert.rejects(writeStoryViewReceipt(refused as never, auth, viewer, request({ viewerFieldPresent: true }), already, AbortSignal.timeout(5000), () => {}),
    (error: unknown) => error instanceof StoryViewReceiptWriteFailure && !error.uncertain)
  assert.equal(refused.sent.length, 0, 'a view already recorded is not recorded twice')
})

test('a hidden viewer, an expired story, the wrong version and the wrong story never reach the server', async () => {
  const hidden = answered(ok)
  await assert.rejects(writeStoryViewReceipt(hidden as never, auth, viewer, request(), story({ hiddenFrom: { arrayValue: { values: [{ stringValue: viewer }] } } }), AbortSignal.timeout(5000), () => {}),
    (error: unknown) => error instanceof StoryViewReceiptWriteFailure && !error.uncertain)
  const stale = answered(ok)
  await assert.rejects(writeStoryViewReceipt(stale as never, auth, viewer, request({ expiresAt: expiresAt - 1000 }), story(), AbortSignal.timeout(5000), () => {}),
    (error: unknown) => error instanceof StoryViewReceiptWriteFailure && !error.uncertain)
  const replaced = answered(ok)
  await assert.rejects(writeStoryViewReceipt(replaced as never, auth, viewer, request({ version: '101:0' }), story(), AbortSignal.timeout(5000), () => {}),
    (error: unknown) => error instanceof StoryViewReceiptWriteFailure && !error.uncertain)
  const elsewhere = answered(ok)
  await assert.rejects(writeStoryViewReceipt(elsewhere as never, auth, viewer, request(), { ...story(), name: `${documents}/users/${owner}/publicStories/story2` }, AbortSignal.timeout(5000), () => {}),
    (error: unknown) => error instanceof StoryViewReceiptWriteFailure && !error.uncertain)
  assert.equal(hidden.sent.length + stale.sent.length + replaced.sent.length + elsewhere.sent.length, 0)
})

test('a refusal is final, a lost answer is not', async () => {
  const denied = answered(Object.assign(new Error('7 PERMISSION_DENIED'), { code: status.PERMISSION_DENIED }))
  await assert.rejects(writeStoryViewReceipt(denied as never, auth, viewer, request(), story(), AbortSignal.timeout(5000), () => {}),
    (error: unknown) => error instanceof StoryViewReceiptWriteFailure && !error.uncertain)
  const lost = answered(Object.assign(new Error('14 UNAVAILABLE'), { code: status.UNAVAILABLE }))
  await assert.rejects(writeStoryViewReceipt(lost as never, auth, viewer, request(), story(), AbortSignal.timeout(5000), () => {}),
    (error: unknown) => error instanceof StoryViewReceiptWriteFailure && error.uncertain)
})
