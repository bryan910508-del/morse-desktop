import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decodeDialog, decodeMessage, documents, messagesQuery, type FirestoreDocument } from '../../src/main/network/firestore-values'
import { emptyRevokedDirect } from '../../src/main/accounts/hidden-chats'
import { ChannelDiscussionHistory, laterPosition } from '../../src/main/accounts/channel-discussion-history'
import type { MessagePosition } from '../../src/shared/model'

// «기록 모두 지우기» writes chats/{id}.historyRevokedAt and then removes the messages in pages
// (functions morse-release-authority.js clearHistory). Until the pages are gone, the boundary is what hides them.
const boundary = 5_000_000
const time = (milliseconds: number) => ({ timestampValue: { seconds: String(Math.floor(milliseconds / 1000)), nanos: (milliseconds % 1000) * 1_000_000 } })
const members = { arrayValue: { values: [{ stringValue: 'me' }, { stringValue: 'peer' }] } }
const chat = (id: string, kind: string, fields: Record<string, unknown> = {}): FirestoreDocument => ({
  name: `${documents}/chats/${id}`, updateTime: { seconds: '1', nanos: 0 }, createTime: { seconds: '1', nanos: 0 },
  fields: { type: { stringValue: kind }, participantUids: members, historyRevokedAt: time(boundary), lastMessageAt: time(4_000_000),
    lastMessage: { stringValue: '지운 뒤에도 보이면 안 되는 말' }, ...fields }
} as unknown as FirestoreDocument)
const message = (chatId: string, id: string, milliseconds: number): FirestoreDocument => ({ name: `${documents}/chats/${chatId}/messages/${id}`, fields: {
  createdAt: time(milliseconds), senderId: { stringValue: 'peer' }, type: { stringValue: 'text' }, text: { stringValue: id } } } as unknown as FirestoreDocument)

// F-SY-002 / T-A-10: the boundary was read for private chats only, so a group cleared for everyone went on showing
// what was cleared until the server's cleanup reached it. Android and Telegram (messages.deleteHistory with revoke)
// hold it for every kind of room.
test('a group cleared for everyone shows nothing from before the boundary, in the list or in the room', () => {
  const group = decodeDialog(chat('g1', 'group', { name: { stringValue: '그룹' } }), 'me')
  assert.equal(group.cutoff?.seconds, boundary / 1000)
  assert.equal(group.summary.preview, '', 'the list line from before the boundary is not shown')
  assert.equal(decodeMessage(message('g1', 'older', 4_000_000), group), null)
  assert.equal(decodeMessage(message('g1', 'after', boundary + 500), group)?.text, 'after')
  // A message stamped at the very instant of the boundary is read as a private chat reads it: the rule for the
  // boundary itself is unchanged, only the kinds of room it holds for.
  const direct = decodeDialog(chat('d1', 'direct'), 'me')
  assert.equal(Boolean(decodeMessage(message('g1', 'same-instant', boundary), group)), Boolean(decodeMessage(message('d1', 'same-instant', boundary), direct)))
})

// A4 contract §3-3 / §4 Desktop: the server deletes `createdAt <= boundary`, and the boundary is now the exact time of
// the last message the person had when they pressed. Compared with the message id, a message at exactly the boundary
// sorted after it and stayed on this device alone.
test('a message at exactly the boundary is gone, in the room, the list line and the query', () => {
  for (const kind of ['direct', 'group']) {
    const room = decodeDialog(chat(`${kind}1`, kind, { lastMessageAt: time(boundary), lastMessage: { stringValue: '누른 순간의 마지막' } }), 'me')
    assert.equal(decodeMessage(message(`${kind}1`, 'last-when-pressed', boundary), room), null, kind)
    assert.equal(decodeMessage(message(`${kind}1`, 'one-after', boundary + 1), room)?.text, 'one-after', kind)
    assert.equal(room.summary.preview, '', `${kind}: the list line at the boundary is gone too`)
  }
  const direct = decodeDialog(chat('d2', 'direct', { lastMessageAt: time(boundary) }), 'me')
  assert.equal(emptyRevokedDirect(direct.summary, direct.cutoff), true, 'a private chat whose last message is the boundary is empty')
})

test('a group\'s history is read from the boundary on, not from the beginning', () => {
  const group = decodeDialog(chat('g1', 'group'), 'me')
  const where = (messagesQuery(group) as { where?: { fieldFilter?: { field: { fieldPath: string }; op: string } } }).where
  assert.equal(where?.fieldFilter?.field.fieldPath, 'createdAt')
  assert.equal(where?.fieldFilter?.op, 'GREATER_THAN', 'strictly after the boundary: the message at it was deleted')
})

test('a group whose newest message came after the boundary keeps its list line', () => {
  const group = decodeDialog(chat('g1', 'group', { lastMessageAt: time(boundary + 1000), lastMessage: { stringValue: '새 메시지' } }), 'me')
  assert.equal(group.summary.preview, '새 메시지')
})

// A channel's discussion room is a group too, and its owner can clear it for everyone. The channel's own history
// policy used to replace the room's boundary outright — harmless only while groups had none.
test('a discussion room keeps its boundary whatever the channel\'s history policy says', () => {
  const doc = chat('channel_discuss_ch1', 'group', { isChannelDiscussion: { booleanValue: true }, channelId: { stringValue: 'ch1' }, createdBy: { stringValue: 'peer' } })
  const room = decodeDialog(doc, 'me')
  new ChannelDiscussionHistory('me', new AbortController().signal, () => {}).apply(doc, room)
  assert.equal(room.cutoff?.seconds, boundary / 1000, 'a policy that is not known yet does not bring cleared messages back')
  assert.equal(room.summary.moderates, false, 'nor lets anyone delete others\' messages there (A1 §3-6)')
  const at = (seconds: number): MessagePosition => ({ seconds, nanoseconds: 0, id: '' })
  assert.equal(laterPosition(at(5), at(9))?.seconds, 9)
  assert.equal(laterPosition(at(9), at(5))?.seconds, 9)
  assert.equal(laterPosition(null, at(5))?.seconds, 5)
  assert.equal(laterPosition(at(5), null)?.seconds, 5)
  assert.equal(laterPosition(null, null), null)
})

// Leaving an emptied room out of the list is Telegram's rule for private chats (History::shouldBeInChatList); a group
// that was cleared stays where it is, empty.
test('only a private chat that was emptied leaves the list; a cleared group stays', () => {
  const direct = decodeDialog(chat('d1', 'direct'), 'me'), group = decodeDialog(chat('g1', 'group'), 'me')
  assert.equal(emptyRevokedDirect(direct.summary, direct.cutoff), true)
  assert.equal(emptyRevokedDirect(group.summary, group.cutoff), false)
  assert.equal(decodeMessage(message('d1', 'older', 4_000_000), direct), null, 'a private chat behaves as before')
})
