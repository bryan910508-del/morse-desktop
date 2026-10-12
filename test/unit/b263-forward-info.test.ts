import assert from 'node:assert/strict'
import { test } from 'node:test'
import { forwardHeaderOf, forwardInfoFrom } from '../../src/shared/forward'
import { messageForward } from '../../src/main/network/firestore-values'
import { incomingMessage } from '../../src/main/network/contracts'
import { inquiryChatMessage } from '../../src/shared/channel-inquiries'

// B263 §2-2: forwardInfo as the server writes it — a Firestore map with a Timestamp, the socket's object with ms.
const at = Date.UTC(2026, 9, 10, 4, 30, 15, 250)
const firestore = { forwardInfo: { mapValue: { fields: {
  fromUid: { stringValue: 'uid_original_1' }, fromName: { stringValue: ' 전영찬 ' },
  date: { timestampValue: { seconds: String(Math.floor(at / 1000)), nanos: 250_000_000 } }, v: { integerValue: '1' } } } } }

test('a Firestore forwardInfo reads as the socket one does, its date in ms', () => {
  assert.deepEqual(messageForward(firestore), { forward: { fromUid: 'uid_original_1', fromName: '전영찬', date: at, hidden: false } })
  assert.deepEqual(messageForward({}), {})
  const socket = incomingMessage({ id: 'm1', chatId: 'c1', senderId: 's1', type: 'sticker', createdAt: at + 1,
    forwardInfo: { fromUid: 'uid_original_1', fromName: '전영찬', date: at, v: 1 } })
  assert.deepEqual(socket.forward, { fromUid: 'uid_original_1', fromName: '전영찬', date: at, hidden: false })
  assert.equal(incomingMessage({ id: 'm2', chatId: 'c1', senderId: 's1', createdAt: at }).forward, undefined)
})

test('hidden, channel and malformed forwardInfo', () => {
  assert.deepEqual(forwardInfoFrom({ fromUid: 'uid_x', fromName: '숨긴 사람', hidden: true, date: at }), { fromName: '숨긴 사람', date: at, hidden: true })
  assert.deepEqual(forwardInfoFrom({ hidden: true }), { fromName: '', date: null, hidden: true })
  assert.deepEqual(forwardInfoFrom({ fromName: '채널', fromChannelId: 'ch_1', channelPostId: 'post_1', date: at }),
    { fromName: '채널', fromChannelId: 'ch_1', channelPostId: 'post_1', date: at, hidden: false })
  assert.equal(forwardInfoFrom({ fromName: '이름', v: 2 }), null)
  assert.equal(forwardInfoFrom({ fromUid: '../x' }), null)
  assert.equal(forwardInfoFrom({ channelPostId: 'post_1' }), null)
  assert.equal(forwardInfoFrom('x'), null)
  assert.equal(forwardInfoFrom([]), null)
})

test('an inquiry message keeps its forwardInfo on the chat message it is drawn as', () => {
  const forward = { fromName: '전영찬', date: at, hidden: false }
  const message = inquiryChatMessage({ id: 'q1', own: false, senderType: 'subscriber', kind: 'text', text: 'hi', label: '', createdAt: at, edited: false, version: 'v', forward }, 'inq_1')
  assert.deepEqual(message.forward, forward)
})

test('the header names and leads as tdesktop HistoryMessageForwarded links it', () => {
  const none = { self: 'me', contactName: '' }
  const person = { fromUid: 'uid_p', fromName: '서버 이름', date: at, hidden: false }
  // B266: a person, contact or not, opens as a person (tdesktop showPeer → showPeerInfo for a user).
  assert.deepEqual(forwardHeaderOf(person, { ...none, contactName: '내 연락처 이름' }), { name: '내 연락처 이름', action: { kind: 'person', uid: 'uid_p' } })
  assert.deepEqual(forwardHeaderOf(person, none), { name: '서버 이름', action: { kind: 'person', uid: 'uid_p' } })
  assert.deepEqual(forwardHeaderOf({ ...person, fromUid: 'me' }, none), { name: '서버 이름', action: null })
  assert.deepEqual(forwardHeaderOf({ fromName: '숨긴 사람', date: at, hidden: true }, none), { name: '숨긴 사람', action: { kind: 'hidden' } })
  assert.equal(forwardHeaderOf({ fromName: '', date: null, hidden: true }, none).action, null)
  assert.deepEqual(forwardHeaderOf({ fromName: '채널', fromChannelId: 'ch_1', channelPostId: 'post_1', date: at, hidden: false }, none),
    { name: '채널', action: { kind: 'channel', channelId: 'ch_1', postId: 'post_1' } })
  assert.deepEqual(forwardHeaderOf({ fromName: '채널', fromChannelId: 'ch_1', date: at, hidden: false }, none).action, { kind: 'channel', channelId: 'ch_1', postId: null })
})
