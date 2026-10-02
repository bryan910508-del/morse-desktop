import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decodeDialog, displayField, readDialogs, type FirestoreDocument } from '../../src/main/network/firestore-values'
import { participantSnapshot, roomContactFields } from '../../src/main/accounts/participants'

const root = 'projects/talky-a38c3/databases/(default)/documents/chats'
const chat = (id: string, fields: Record<string, unknown>): FirestoreDocument => ({
  name: `${root}/${id}`, updateTime: { seconds: '1', nanos: 0 }, createTime: { seconds: '1', nanos: 0 }, fields
} as unknown as FirestoreDocument)
const members = (...uids: string[]) => ({ arrayValue: { values: uids.map(uid => ({ stringValue: uid })) } })
const info = (entries: Record<string, string>) => ({ mapValue: { fields: Object.fromEntries(Object.entries(entries).map(([uid, name]) =>
  [uid, { mapValue: { fields: { displayName: { stringValue: name } } } }])) } })

// iOS wrote group names with no length check (GroupProfileView.swift updateData(["name": trimmed])); this build read
// anything past 512 characters as a broken document.
const longName = '가'.repeat(600)
const group = chat('g1', { type: { stringValue: 'group' }, participantUids: members('me', 'peer'), name: { stringValue: longName },
  participantInfo: info({ me: '나', peer: '상대'.repeat(400) }) })
const direct = chat('d1', { type: { stringValue: 'direct' }, participantUids: members('me', 'peer'), participantInfo: info({ peer: '상대' }) })

test('a name longer than this build expects is cut, not refused', () => {
  const read = decodeDialog(group, 'me')
  assert.equal(read.summary.title, '가'.repeat(512))
  assert.equal(read.participantNames.peer, '상대'.repeat(256), 'a participant\'s name is cut the same way')
})

// F-ST-002 / T-H-11: one such group emptied the list and stopped sending, read marks and notifications for every chat.
test('a group with a very long name and an ordinary chat are both listed, and the name is cut', () => {
  const read = readDialogs([group, direct], 'me')
  assert.equal(read.skipped, 0)
  assert.deepEqual(read.dialogs.map(item => item.value.summary.id), ['g1', 'd1'])
  assert.equal(read.dialogs[0]!.value.summary.title.length, 512)
})

// Telegram replaces the entry it cannot read and keeps the list.
test('a room that cannot be read is left out, and only that room', () => {
  const broken = [
    chat('x1', { type: { stringValue: 'channel' }, participantUids: members('me') }),
    chat('x2', { type: { stringValue: 'group' }, participantUids: { arrayValue: { values: [{ stringValue: 'not an id!' }] } } }),
    chat('x3', { type: { stringValue: 'direct' }, participantUids: members('someone', 'else') })
  ]
  const read = readDialogs([broken[0]!, group, broken[1]!, direct, broken[2]!], 'me')
  assert.deepEqual(read.dialogs.map(item => item.value.summary.id), ['g1', 'd1'])
  assert.equal(read.skipped, 3)
})

// Only what is shown is cut. The checks that keep a document honest are not loosened.
test('the fields that are checked for integrity are still refused when they are wrong', () => {
  assert.throws(() => decodeDialog(chat('y1', { type: { stringValue: 'g'.repeat(40) }, participantUids: members('me') }), 'me'))
  assert.throws(() => decodeDialog(chat('y2', { type: { stringValue: 'group' }, participantUids: members('me'), createdBy: { stringValue: 'u'.repeat(200) } }), 'me'))
})

test('a shown value is cut by whole characters, and one that is not text is none', () => {
  const fields = { plain: { stringValue: 'abc' }, emoji: { stringValue: '😀😀😀' }, number: { integerValue: '5' } } as unknown as Parameters<typeof displayField>[0]
  assert.equal(displayField(fields, 'plain', 5), 'abc')
  assert.equal(displayField(fields, 'emoji', 2), '😀😀', 'an emoji at the edge is not split in two')
  assert.equal(displayField(fields, 'number', 5), '')
  assert.equal(displayField(fields, 'missing', 5), '')
})

// 11_phase1-work §E-1: two more places still read a participant's name strictly — the group's member list and
// «연락처에 추가» from it — so the same long name failed them after the chat list itself was fixed.
test('the member list shows a participant with a very long name, cut, instead of failing', () => {
  const read = decodeDialog(group, 'me')
  const members = participantSnapshot('r1', group, read, () => false, true).members
  const peer = members.find(member => member.uid === 'peer')!
  assert.equal(peer.displayName, '상대'.repeat(256))
  assert.equal(peer.withdrawn, false)
  assert.equal(peer.canAddContact, true, 'somebody with a long name can still be added')
})

test('a participant with a very long name can be added as a contact, under the name cut to what is shown', () => {
  const room = chat('g2', { type: { stringValue: 'group' }, participantUids: members('me', 'peer'), name: { stringValue: '그룹' },
    participantInfo: { mapValue: { fields: { peer: { mapValue: { fields: {
      displayName: { stringValue: '상대'.repeat(400) }, userId: { stringValue: 'abcd2345' }, photoURL: { stringValue: '' } } } } } } } })
  const fields = roomContactFields(room, 'peer')
  assert.equal(fields.displayName, '상대'.repeat(256))
  assert.equal(fields.userId, 'abcd2345')
  // The Morse ID and the picture's address are not display text, and are still refused when they are wrong.
  const broken = chat('g3', { type: { stringValue: 'group' }, participantUids: members('me', 'peer'),
    participantInfo: { mapValue: { fields: { peer: { mapValue: { fields: { displayName: { stringValue: '상대' }, userId: { stringValue: 'u'.repeat(200) } } } } } } } })
  assert.throws(() => roomContactFields(broken, 'peer'))
  assert.throws(() => roomContactFields(chat('g4', { participantInfo: { mapValue: { fields: {} } } }), 'peer'), 'nobody to add without a name')
})
