import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HistoryReader } from '../../src/main/accounts/history-reader'
import type { FirestoreReader, WatchEvents } from '../../src/main/network/firestore-rpc'
import { decodeMessage, documents, roomMediaNames, roomNames, type FirestoreDocument, type ReadDialog } from '../../src/main/network/firestore-values'
import { storageBucket } from '../../src/main/media/media-document'

// A channel's discussion room. onChannelPostCreated mirrors every channel post into it as a system
// message (`chpost_{postId}`, isSystem, type channelPost) whose thumbnailUrl is the post's own
// picture, and iOS draws that picture in the card (MorseChatUIKitNativeChannelPostRow). The room can
// answer to two ids: `channel_discuss_{channelId}` for a room the function made, and the older id for
// a room that already existed (functions onChannelCreatedEnsureDiscussion).
const channelId = 'ch1', roomId = 'group_legacy_1', me = 'me', author = 'owner'
const postPicture = `https://firebasestorage.googleapis.com/v0/b/${storageBucket}/o/${encodeURIComponent(`channel_posts/${channelId}/p1.jpg`)}?alt=media`

function discussionRoom(id = roomId): ReadDialog {
  return {
    summary: { id, version: '1:0', kind: 'group', title: '토론방', participantUids: [me, author], preview: '', unreadCount: 0, markedUnread: false,
      readPositions: {}, readSync: { status: 'ready' }, pinned: false, pinVersion: '', muted: false, archived: false, top: null,
      discussion: true, channelId },
    cutoff: null, participantNames: { [me]: '나', [author]: '채널' }, accountUid: me
  } as unknown as ReadDialog
}
function card(overrides: { chatId?: string; id?: string } = {}): FirestoreDocument {
  const id = overrides.id ?? 'chpost_p1'
  return {
    name: `${documents}/chats/${roomId}/messages/${id}`, updateTime: { seconds: '1', nanos: 0 },
    fields: {
      createdAt: { timestampValue: { seconds: '1750000000', nanos: 0 } },
      senderId: { stringValue: author }, type: { stringValue: 'channelPost' }, isSystem: { booleanValue: true },
      channelId: { stringValue: channelId }, channelPostId: { stringValue: 'p1' }, channelName: { stringValue: '채널' },
      thumbnailUrl: { stringValue: postPicture }, text: { stringValue: '새 게시물' },
      ...(overrides.chatId === undefined ? {} : { chatId: { stringValue: overrides.chatId } })
    }
  } as unknown as FirestoreDocument
}

test('a discussion room answers to both of its ids, and to the name a message was written with', () => {
  assert.deepEqual(roomNames(discussionRoom()), [roomId, `channel_discuss_${channelId}`])
  assert.deepEqual(roomNames(discussionRoom(`channel_discuss_${channelId}`)), [`channel_discuss_${channelId}`])
  const plain = { summary: { id: 'g1', discussion: false }, participantNames: {}, accountUid: me } as unknown as ReadDialog
  assert.deepEqual(roomNames(plain), ['g1'])
  assert.deepEqual(roomMediaNames(card({ chatId: `channel_discuss_${channelId}` }), discussionRoom()),
    [roomId, `channel_discuss_${channelId}`])
  assert.deepEqual(roomMediaNames(card({ chatId: 'chat_from_another_name' }), discussionRoom()),
    [roomId, `channel_discuss_${channelId}`, 'chat_from_another_name'])
})

test('a post card written under the room’s other id is still this room’s message', () => {
  const written = decodeMessage(card({ chatId: `channel_discuss_${channelId}` }), discussionRoom())
  assert.ok(written)
  assert.equal(written.readEligible, true, 'the card may be read')
  assert.equal(written.attachments.length, 1)
  assert.equal(written.attachments[0]?.available, true)
  // A message that names a room this one does not answer to is left alone.
  const foreign = decodeMessage(card({ chatId: 'chat_somewhere_else' }), discussionRoom())
  assert.equal(foreign?.readEligible, false)
})

const tick = () => new Promise(resolve => setTimeout(resolve, 0))
function readerFor(rows: FirestoreDocument[]) {
  return {
    watch: (_target: unknown, _signal: AbortSignal, events: WatchEvents) => {
      queueMicrotask(() => { events.snapshot(new Map(rows.map(row => [row.name, row]))); events.state('ready') })
      return () => {}
    },
    query: async () => rows
  } as unknown as FirestoreReader
}

test('the picture of a channel post card can be read, though the card is a system message', async () => {
  const rows = [card({ chatId: `channel_discuss_${channelId}` })]
  const history = new HistoryReader(discussionRoom(), readerFor(rows), () => {}, () => 1)
  history.start(); await tick()
  assert.equal(history.snapshot.status, 'ready')
  const message = history.snapshot.messages.find(item => item.id === 'chpost_p1')
  assert.ok(message, 'the card is in the room')
  const resource = history.mediaResource({ requestId: 'r1', messageId: 'chpost_p1', version: message.version, index: 0 })
  assert.ok(resource, 'the card’s picture is a resource the preview can fetch')
  assert.equal(resource.path, `channel_posts/${channelId}/p1.jpg`)
  assert.equal(resource.grantPostId, 'p1', 'authorizeMorseMediaRead is asked for this post')
})

test('an ordinary system line still carries nothing to read', async () => {
  const notice: FirestoreDocument = {
    name: `${documents}/chats/${roomId}/messages/sys1`, updateTime: { seconds: '1', nanos: 0 },
    fields: { createdAt: { timestampValue: { seconds: '1750000001', nanos: 0 } }, senderId: { stringValue: author },
      type: { stringValue: 'text' }, isSystem: { booleanValue: true }, text: { stringValue: '참여했습니다' } }
  } as unknown as FirestoreDocument
  const history = new HistoryReader(discussionRoom(), readerFor([notice]), () => {}, () => 1)
  history.start(); await tick()
  const message = history.snapshot.messages.find(item => item.id === 'sys1')
  assert.ok(message)
  assert.equal(history.mediaResource({ requestId: 'r1', messageId: 'sys1', version: message.version, index: 0 }), null)
})
