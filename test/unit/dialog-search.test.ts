import assert from 'node:assert/strict'
import { test } from 'node:test'
import { peopleWithoutRows } from '../../src/shared/dialog-search'

// B49 (Telegram data_session.cpp:5771-5775 contactsNoChatsList, dialogs_inner_widget.cpp:4335): searching the chat
// list also finds the people with no row — a 1:1 that left the list, contact or not, and a contact with no 1:1.
const matches = (needle: string) => (title: string) => title.includes(needle)
const base = { listedPeers: new Set<string>(), pendingPeers: new Set<string>(), unlisted: [], contacts: [], self: 'me' }

test('a 1:1 the other person emptied, with someone who is not a contact, is found and opens as that room', () => {
  const found = peopleWithoutRows({ ...base, matches: matches('민지'), unlisted: [{ chatId: 'c1', peerUid: 'stranger', title: '민지' }] })
  assert.deepEqual(found, [{ uid: 'stranger', title: '민지', chatId: 'c1' }])
})

test('a contact with no chat is found and opens as a new chat', () => {
  const found = peopleWithoutRows({ ...base, matches: matches('지'), contacts: [{ uid: 'u2', name: '지수' }] })
  assert.deepEqual(found, [{ uid: 'u2', title: '지수', chatId: null }])
})

test('each person once; a row of the list, a new chat already shown, or this account is not repeated', () => {
  const found = peopleWithoutRows({ matches: matches(''), self: 'me', listedPeers: new Set(['a']), pendingPeers: new Set(['b']),
    unlisted: [{ chatId: 'c', peerUid: 'c', title: 'C' }, { chatId: 'a1', peerUid: 'a', title: 'A' }],
    contacts: [{ uid: 'c', name: 'C' }, { uid: 'b', name: 'B' }, { uid: 'me', name: '나' }, { uid: 'd', name: 'D' }] })
  assert.deepEqual(found.map(item => [item.uid, item.chatId]), [['c', 'c'], ['d', null]])
})
