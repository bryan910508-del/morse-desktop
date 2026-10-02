import assert from 'node:assert/strict'
import { test } from 'node:test'
import { foldOwnedDiscussions, ownedChannelDiscussion, ownerRowId, type DiscussionFold, type InquiryRow } from '../../src/shared/channel-inquiries'
import type { DialogSummary } from '../../src/shared/model'

const me = 'me'
const group = (fields: Partial<DialogSummary>): Pick<DialogSummary, 'id' | 'kind' | 'discussion' | 'channelId' | 'createdBy'> =>
  ({ id: 'channel_discuss_ch-a', kind: 'group', discussion: true, channelId: 'ch-a', createdBy: me, ...fields })

test('a discussion room belongs to its channel only when this account owns the channel', () => {
  assert.equal(ownedChannelDiscussion(group({}), me), 'ch-a')
  assert.equal(ownedChannelDiscussion(group({ createdBy: 'somebody-else' }), me), '', 'a channel I only subscribe to keeps its own row')
  assert.equal(ownedChannelDiscussion(group({ kind: 'direct' }), me), '')
  assert.equal(ownedChannelDiscussion(group({}), ''), '')
  // An older room that carries no channelId is still named by its own id.
  assert.equal(ownedChannelDiscussion(group({ discussion: undefined, channelId: undefined }), me), 'ch-a')
  assert.equal(ownedChannelDiscussion(group({ id: 'plain-group', discussion: undefined, channelId: undefined }), me), '')
})

const ownerRow = (channelId: string, fields: Partial<InquiryRow> = {}): InquiryRow =>
  ({ id: ownerRowId(channelId), kind: 'ownerFolder', channelId, inquiryId: null, title: '내 채널', preview: '문의 드립니다', lastMessageAt: 100, unread: 2, rooms: 1, ...fields })
const fold = (fields: Partial<DiscussionFold> = {}): DiscussionFold =>
  ({ channelId: 'ch-a', title: '내 채널', preview: '토론방 메시지', at: 200, unread: 3, ...fields })

test('the channel row counts the discussion room and shows its message when it is the newer one', () => {
  const [row] = foldOwnedDiscussions([ownerRow('ch-a')], [fold()])
  assert.equal(row!.unread, 5)
  assert.equal(row!.preview, '토론방 메시지')
  assert.equal(row!.lastMessageAt, 200)
})

test('an older discussion room is counted but does not replace the newest inquiry', () => {
  const [row] = foldOwnedDiscussions([ownerRow('ch-a')], [fold({ at: 50 })])
  assert.equal(row!.unread, 5)
  assert.equal(row!.preview, '문의 드립니다')
  assert.equal(row!.lastMessageAt, 100)
})

// iOS ownerInquirySummariesMerged: a channel of mine that nobody has written to still has its row, which is
// the only place its discussion room can be reached from the chat list.
test('a channel with no inquiry at all still has a row', () => {
  const rows = foldOwnedDiscussions([], [fold()])
  assert.equal(rows.length, 1)
  assert.deepEqual({ id: rows[0]!.id, kind: rows[0]!.kind, rooms: rows[0]!.rooms, unread: rows[0]!.unread, preview: rows[0]!.preview }, {
    id: 'own_inq_ch-a', kind: 'ownerFolder', rooms: 0, unread: 3, preview: '토론방 메시지'
  })
})

test('rows stay ordered by their newest message, and other channels are left alone', () => {
  const rows = foldOwnedDiscussions(
    [ownerRow('ch-a', { lastMessageAt: 10, unread: 1 }), { ...ownerRow('ch-b'), kind: 'subscriber', id: 'sub_inq_x', inquiryId: 'x', lastMessageAt: 300, unread: 4 }],
    [fold({ at: 20 }), fold({ channelId: 'ch-c', at: 400, unread: 1, title: '두 번째 채널', preview: '새 글' })]
  )
  assert.deepEqual(rows.map(row => row.id), ['own_inq_ch-c', 'sub_inq_x', 'own_inq_ch-a'])
  assert.equal(rows.find(row => row.id === 'sub_inq_x')!.unread, 4, 'a subscriber row is not touched')
})

test('nothing is copied or reordered when this account owns no channel', () => {
  const rows = [ownerRow('ch-a')]
  assert.deepEqual(foldOwnedDiscussions(rows, []), rows)
})
