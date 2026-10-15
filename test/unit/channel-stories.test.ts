import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fromJSON } from '@grpc/proto-loader'
import { channelStoriesQuery, channelStoryCreateWrite, channelStoryFields } from '../../src/main/network/channel-story-write'
import { ChannelStories, decodeChannelStory } from '../../src/main/accounts/channel-stories'
import { channelStoryObject } from '../../src/main/network/channel-story-media'
import { documents, type FirestoreDocument } from '../../src/main/network/firestore-values'
import type { ReadCredentials } from '../../src/main/network/firestore-rpc'
import { storyReactionWrite, storyReadMarkWrite, storyViewedWrite } from '../../src/main/network/story-views'

// channels/{channelId}/stories as iOS StoryService.commitUpload writes them for ownerType .channel.
const bucket = 'talky-a38c3.firebasestorage.app'
const now = Date.UTC(2026, 8, 17, 12)
const at = (ms: number) => ({ timestampValue: { seconds: String(Math.floor(ms / 1000)), nanos: 0 } })
const story = (id: string, fields: Record<string, unknown> = {}, channelId = 'ch1'): FirestoreDocument => ({
  name: `${documents}/channels/${channelId}/stories/${id}`,
  fields: {
    ownerType: { stringValue: 'channel' }, ownerId: { stringValue: channelId }, authorId: { stringValue: 'owner1' }, mediaType: { stringValue: 'image' },
    mediaURL: { stringValue: `gs://${bucket}/stories/channel/${channelId}/${id}.jpg` }, thumbnailURL: { stringValue: `gs://${bucket}/stories/channel/${channelId}/${id}_thumb.jpg` },
    createdAt: at(now - 3600000), expiresAt: at(now + 3600000), caption: { stringValue: '설명' }, privacy: { stringValue: 'everyone' },
    viewerIds: { arrayValue: { values: [{ stringValue: 'viewer1' }] } }, viewedAtByUid: { mapValue: { fields: { viewer2: at(now) } } }, reactionByUid: { mapValue: { fields: { me: { stringValue: '🔥' } } } },
    hiddenFrom: { arrayValue: { values: [] } }, ...fields
  }
} as unknown as FirestoreDocument)

// B408 S2: the document's viewer fields are not read — seen is the read mark, a reaction this account's views record, the
// count storyStats (channel-stories.ts).
test('a channel story is read with its media under the channel folder, and nothing from its viewer fields', () => {
  const row = decodeChannelStory(story('S1'), 'ch1', 'me', now)!
  assert.ok(row)
  assert.equal(row.mediaPath, 'stories/channel/ch1/S1.jpg')
  assert.equal(row.thumbnailPath, 'stories/channel/ch1/S1_thumb.jpg')
  assert.deepEqual({ viewed: row.story.viewed, reaction: row.story.reaction, viewCount: row.story.viewCount, hasThumbnail: row.story.hasThumbnail, audio: row.story.audio },
    { viewed: false, reaction: null, viewCount: null, hasThumbnail: true, audio: false })
  assert.equal(decodeChannelStory(story('S1', { viewerIds: { arrayValue: { values: [{ stringValue: 'me' }] } } }), 'ch1', 'me', now)!.story.viewed, false, 'the old viewer list says nothing')
  assert.equal(decodeChannelStory(story('S1'), 'ch1', 'me', now)!.storyPath, `${documents}/channels/ch1/stories/S1`)
  assert.equal(decodeChannelStory(story('S1'), 'ch1', 'owner1', now)!.story.viewed, true, 'the owner never has an unseen ring on their own story')
})

test('an expired, hidden, foreign or unreadable story is left out', () => {
  assert.equal(decodeChannelStory(story('S1', { expiresAt: at(now - 1) }), 'ch1', 'me', now), null)
  assert.equal(decodeChannelStory(story('S1', { hiddenFrom: { arrayValue: { values: [{ stringValue: 'me' }] } } }), 'ch1', 'me', now), null)
  assert.equal(decodeChannelStory(story('S1', { mediaURL: { stringValue: `gs://${bucket}/stories/channel/other/S1.jpg` } }), 'ch1', 'me', now), null)
  assert.equal(decodeChannelStory(story('S1', { mediaType: { stringValue: 'gif' } }), 'ch1', 'me', now), null)
  assert.equal(decodeChannelStory(story('S1', {}, 'ch2'), 'ch1', 'me', now), null)
  assert.equal(decodeChannelStory(story('S1', { reactionByUid: { mapValue: { fields: { me: { stringValue: '🍕' } } } } }), 'ch1', 'me', now)!.story.reaction, null)
})

test("only this project's channel story objects are followed", () => {
  assert.equal(channelStoryObject(`gs://${bucket}/stories/channel/ch1/S1.mp4`, 'ch1'), 'stories/channel/ch1/S1.mp4')
  assert.equal(channelStoryObject(`gs://other-bucket/stories/channel/ch1/S1.mp4`, 'ch1'), null)
  assert.equal(channelStoryObject(`gs://${bucket}/stories/user/ch1/S1.mp4`, 'ch1'), null)
  assert.equal(channelStoryObject(`gs://${bucket}/stories/channel/ch1/../x/S1.mp4`, 'ch1'), null)
})

test('before anything is read, and while locked, the rings say nothing', () => {
  let changes = 0
  const stories = new ChannelStories('me', { signal: new AbortController().signal } as unknown as ReadCredentials, () => false, () => { changes++ })
  stories.setVisible(['ch1'])
  assert.deepEqual(stories.snapshot(), {})
  stories.setLocked(true)
  assert.equal(stories.snapshot(), null)
  assert.equal(changes, 1)
  assert.equal(stories.response('A'.repeat(24), new Request('morse://app/__channel-story/x')).status, 404)
})

// The descriptor and options FirestoreReader loads: a request that does not serialize never reaches the server.
const definition = fromJSON(JSON.parse(readFileSync(join(process.cwd(), 'resources/firestore-v1.json'), 'utf8')), { longs: String, enums: String, bytes: Buffer, defaults: false, oneofs: true })
const service = definition['google.firestore.v1.Firestore'] as unknown as Record<string, { requestSerialize(value: unknown): Buffer; requestDeserialize(value: Buffer): any }>
const method = (name: string) => service[Object.keys(service).find(key => key.toLowerCase() === name)!]!
const roundTrip = (name: string, request: unknown): any => method(name).requestDeserialize(method(name).requestSerialize(request))

test('the story query reaches the server with its time and limit', () => {
  const sent = roundTrip('runquery', { parent: `${documents}/channels/ch1`, structuredQuery: channelStoriesQuery(now, 50) })
  assert.equal(sent.structuredQuery.limit.value, 50)
  assert.equal(sent.structuredQuery.where.fieldFilter.value.timestampValue.seconds, String(now / 1000))
  assert.deepEqual(sent.structuredQuery.orderBy.map((order: any) => order.field.fieldPath), ['expiresAt', 'createdAt'])
})

test('a new channel story, a receipt and a reaction serialize the way StoryService writes them', () => {
  const database = documents.slice(0, -'/documents'.length)
  const fields = channelStoryFields({ channelId: 'ch1', storyId: 'S1', uid: 'owner1', video: true, caption: '설명', durationSeconds: 7.5, now: now + 250 })
  const created = roundTrip('commit', { database, writes: [channelStoryCreateWrite('ch1', 'S1', fields)] }).writes[0]
  assert.equal(created.update.fields.expiresAt.timestampValue.seconds, String((now + 86400000) / 1000))
  assert.equal(created.update.fields.createdAt.timestampValue.nanos, 250_000_000)
  assert.equal(created.update.fields.mediaURL.stringValue, `gs://${bucket}/stories/channel/ch1/S1.mp4`)
  assert.equal(created.update.fields.durationSeconds.doubleValue, 7.5)
  assert.equal(created.currentDocument.exists, false)
  // B408 S2: a view, a reaction and a read mark are this account's own records (story-views.ts), never the story's fields.
  const path = `${documents}/channels/ch1/stories/S1`
  const viewed = roundTrip('commit', { database, writes: [storyViewedWrite(path, '0abc')] }).writes[0]
  assert.equal(viewed.update.name, `${path}/views/0abc`)
  assert.deepEqual(viewed.updateMask?.fieldPaths ?? [], [], 'nothing else in the record is touched')
  assert.deepEqual(viewed.updateTransforms.map((item: any) => [item.fieldPath, item.setToServerValue]), [['viewedAt', 'REQUEST_TIME']])
  assert.equal(viewed.currentDocument, undefined, 'made when it is not there')
  const reacted = roundTrip('commit', { database, writes: [storyReactionWrite(path, 'me', '🔥')] }).writes[0]
  assert.deepEqual([reacted.update.name, reacted.updateMask.fieldPaths, reacted.update.fields.reaction.stringValue], [`${path}/views/me`, ['reaction'], '🔥'])
  const cleared = roundTrip('commit', { database, writes: [storyReactionWrite(path, 'me', null)] }).writes[0]
  assert.deepEqual(cleared.updateMask.fieldPaths, ['reaction'])
  assert.equal(cleared.update.fields?.reaction, undefined)
  assert.equal(cleared.currentDocument.exists, true, 'taking a reaction back never makes an empty record')
  const marked = roundTrip('commit', { database, writes: [storyReadMarkWrite('me', { ownerType: 'channel', ownerId: 'ch1', maxReadCreatedAt: now + 1250, maxReadStoryId: 'S1' })] }).writes[0]
  assert.equal(marked.update.name, `${documents}/users/me/storyReadMarks/channel_ch1`)
  assert.deepEqual([marked.update.fields.ownerType.stringValue, marked.update.fields.ownerId.stringValue, marked.update.fields.maxReadStoryId.stringValue, marked.update.fields.maxReadCreatedAt.timestampValue.nanos], ['channel', 'ch1', 'S1', 250_000_000])
  assert.equal(marked.updateMask, undefined, 'the whole mark (iOS setData without merge)')
  assert.deepEqual(marked.updateTransforms.map((item: any) => item.fieldPath), ['updatedAt'])
})
