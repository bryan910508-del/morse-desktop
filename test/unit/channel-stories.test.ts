import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fromJSON } from '@grpc/proto-loader'
import { channelStoriesQuery, channelStoryCreateWrite, channelStoryFields, channelStoryReactionWrite, channelStoryViewedWrite } from '../../src/main/network/channel-story-write'
import { ChannelStories, decodeChannelStory } from '../../src/main/accounts/channel-stories'
import { channelStoryObject } from '../../src/main/network/channel-story-media'
import { documents, type FirestoreDocument } from '../../src/main/network/firestore-values'
import type { ReadCredentials } from '../../src/main/network/firestore-rpc'

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

test('a channel story is read with its media under the channel folder, its views and my reaction', () => {
  const row = decodeChannelStory(story('S1'), 'ch1', 'me', now)!
  assert.ok(row)
  assert.equal(row.mediaPath, 'stories/channel/ch1/S1.jpg')
  assert.equal(row.thumbnailPath, 'stories/channel/ch1/S1_thumb.jpg')
  assert.deepEqual({ viewed: row.story.viewed, reaction: row.story.reaction, viewCount: row.story.viewCount, hasThumbnail: row.story.hasThumbnail, audio: row.story.audio },
    { viewed: false, reaction: '🔥', viewCount: 2, hasThumbnail: true, audio: false })
  assert.equal(decodeChannelStory(story('S1', { viewerIds: { arrayValue: { values: [{ stringValue: 'me' }] } } }), 'ch1', 'me', now)!.story.viewed, true)
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
  const viewed = roundTrip('commit', { database, writes: [channelStoryViewedWrite('ch1', 'S1', '0abc')] }).writes[0]
  assert.deepEqual(viewed.transform.fieldTransforms.map((item: any) => item.fieldPath), ['viewerIds', 'viewedAtByUid.`0abc`'])
  const reacted = roundTrip('commit', { database, writes: [channelStoryReactionWrite('ch1', 'S1', 'me', '🔥')] }).writes[0]
  assert.deepEqual(reacted.updateMask.fieldPaths, ['reactionByUid.`me`'])
  assert.equal(reacted.update.fields.reactionByUid.mapValue.fields.me.stringValue, '🔥')
  const cleared = roundTrip('commit', { database, writes: [channelStoryReactionWrite('ch1', 'S1', 'me', null)] }).writes[0]
  assert.deepEqual(cleared.updateMask.fieldPaths, ['reactionByUid.`me`'])
  assert.equal(cleared.update.fields?.reactionByUid, undefined)
})
