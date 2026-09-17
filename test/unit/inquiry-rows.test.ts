import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildInquiryRows, InquiryRows } from '../../src/main/accounts/inquiry-rows'
import type { ReadCredentials } from '../../src/main/network/firestore-rpc'
import { documents, type FirestoreDocument } from '../../src/main/network/firestore-values'

// The chat list rows for 1:1 channel inquiries: a subscriber sees each room, an owner sees one
// folder per channel that gathers that channel's rooms (iOS ChannelInquirySummary).
const me = 'me'
const at = (seconds: number) => ({ timestampValue: { seconds: String(seconds), nanos: 0 } })
const photoURL = 'https://firebasestorage.googleapis.com/v0/b/bucket/o/channel_photos%2Fc1%2Fp.jpg?alt=media&token=t'
function inquiry(id: string, fields: Record<string, unknown>): FirestoreDocument {
  return { name: `${documents}/channelInquiries/${id}`, updateTime: { seconds: '1', nanos: 0 }, fields } as unknown as FirestoreDocument
}
const owned = (id: string, channelId: string, seconds: number, unread: number, last = '안녕하세요') => inquiry(id, {
  channelId: { stringValue: channelId }, channelOwnerId: { stringValue: me }, subscriberId: { stringValue: `sub-${id}` },
  channelName: { stringValue: '내 채널' }, channelPhotoURL: { stringValue: photoURL },
  lastMessage: { stringValue: last }, lastMessageAt: at(seconds), unreadForOwner: { integerValue: String(unread) }
})

// A publish reads this snapshot. If reading it announced a change, the publish would ask for
// another one without end, and the app answered that flood with "대화 목록을 읽지 못했습니다".
test('reading the rows never announces a change', () => {
  const credentials = { signal: new AbortController().signal, authorize: async () => ({ idToken: 'token', appCheckToken: 'check' }) } as unknown as ReadCredentials
  let changes = 0
  const rows = new InquiryRows('me', credentials, () => {}, () => { changes++ })
  for (let attempt = 0; attempt < 5; attempt++) assert.deepEqual(rows.snapshot(), [])
  assert.equal(changes, 0, 'a snapshot is read-only')
  rows.close()
})

test('a subscriber sees one row per room, newest first', () => {
  const rooms = [
    inquiry('c1_me', { channelId: { stringValue: 'c1' }, subscriberId: { stringValue: me }, channelName: { stringValue: '채널 하나' },
      lastMessage: { stringValue: '답장 왔어요' }, lastMessageAt: at(1_750_000_100), unreadForSubscriber: { integerValue: '3' } }),
    inquiry('c2_me', { channelId: { stringValue: 'c2' }, subscriberId: { stringValue: me }, channelName: { stringValue: '채널 둘' },
      lastMessage: { stringValue: '문의 드립니다' }, lastMessageAt: at(1_750_000_200) })
  ]
  const { rows } = buildInquiryRows(me, rooms, [])
  assert.deepEqual(rows.map(row => row.id), ['sub_inq_c2_me', 'sub_inq_c1_me'])
  assert.equal(rows[1]!.kind, 'subscriber')
  assert.equal(rows[1]!.inquiryId, 'c1_me', 'the row opens its own room')
  assert.equal(rows[1]!.unread, 3)
  assert.equal(rows[1]!.title, '채널 하나')
})

test("an owner's rooms gather into one folder per channel", () => {
  const { rows, addresses } = buildInquiryRows(me, [], [
    owned('c1_a', 'c1', 1_750_000_100, 2, '먼저 온 문의'),
    owned('c1_b', 'c1', 1_750_000_300, 5, '가장 최근 문의'),
    owned('c9_a', 'c9', 1_750_000_200, 0)
  ])
  assert.deepEqual(rows.map(row => row.id), ['own_inq_c1', 'own_inq_c9'])
  const folder = rows[0]!
  assert.equal(folder.kind, 'ownerFolder')
  assert.equal(folder.inquiryId, null, 'the folder opens the channel list, not a room')
  assert.equal(folder.rooms, 2)
  assert.equal(folder.unread, 7, 'unread counts add up across the channel')
  assert.equal(folder.preview, '가장 최근 문의', 'the newest room supplies the preview')
  assert.equal(addresses.get('c1'), photoURL)
})

test('a room of another account, and a photo message preview', () => {
  const others = [inquiry('c1_other', { channelId: { stringValue: 'c1' }, subscriberId: { stringValue: 'someone' },
    channelName: { stringValue: '채널' }, lastMessageAt: at(1_750_000_400) })]
  assert.deepEqual(buildInquiryRows(me, others, []).rows, [], 'only this account owns its rows')
  const photo = [inquiry('c1_me', { channelId: { stringValue: 'c1' }, subscriberId: { stringValue: me }, channelName: { stringValue: '채널' },
    lastMessage: { stringValue: photoURL }, lastMessageAt: at(1_750_000_500) })]
  assert.equal(buildInquiryRows(me, photo, []).rows[0]!.preview, '사진', 'a media address reads as 사진')
  const deleted = [inquiry('c1_me', { channelId: { stringValue: 'c1' }, subscriberId: { stringValue: me },
    channelName: { stringValue: '채널' }, channelDeleted: { booleanValue: true }, channelPhotoURL: { stringValue: photoURL }, lastMessageAt: at(1) })]
  const gone = buildInquiryRows(me, deleted, [])
  assert.equal(gone.rows[0]!.title, '알 수 없는 채널')
  assert.equal(gone.addresses.size, 0, 'a deleted channel keeps no picture')
})
