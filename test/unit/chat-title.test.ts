import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { clampChatTitle, maxChatTitle, validChatTitle } from '../../src/shared/chat-title'
import { groupCreateRequest } from '../../src/shared/group-create'
import { groupNameEdit } from '../../src/shared/group-name'
import { channelNameEdit } from '../../src/shared/channel-name'
import { channelCreationPrepare } from '../../src/shared/channel-creation'
import { decodeDialog, documents, type FirestoreDocument } from '../../src/main/network/firestore-values'
import { decodeChannelSummary } from '../../src/main/accounts/channels'

// User decision 10 (2026-09-27): a group's or a channel's title is 1–128 characters, as Telegram has it
// (tdesktop kMaxGroupChannelTitle = 128, TDLib setChatTitle «1-128 characters»), counted in UTF-16 units.
const units = (count: number): string => 'a'.repeat(count)
const emoji = '😀' // two UTF-16 units

test('a title is 1 to 128 units and never only spaces', () => {
  assert.equal(maxChatTitle, 128)
  assert.equal(validChatTitle('a'), true)
  assert.equal(validChatTitle(units(128)), true)
  assert.equal(validChatTitle(units(129)), false)
  assert.equal(validChatTitle(emoji.repeat(64)), true, '64 emoji are 128 units')
  assert.equal(validChatTitle(emoji.repeat(65)), false, '65 emoji are 130 units')
  assert.equal(validChatTitle(''), false)
  assert.equal(validChatTitle('   '), false, 'only spaces is no title (tdesktop trimmed().isEmpty())')
  assert.equal(validChatTitle(42), false)
})

test('what is typed or pasted is kept to 128 units, never ending in half a character', () => {
  assert.equal(clampChatTitle('short'), 'short')
  assert.equal(clampChatTitle(units(200)).length, 128)
  const straddling = units(127) + emoji // the emoji's second half would be unit 129
  assert.equal(clampChatTitle(straddling), units(127), 'the emoji is left out whole, not split')
  assert.equal(clampChatTitle(units(126) + emoji + 'b'), units(126) + emoji, 'an emoji that fits is kept')
})

// The four places that check a title before it is written: creating a group or a channel, and renaming either.
test('creating and renaming a group or a channel take up to 128 units, and refuse more or only spaces', () => {
  const group = (name: string) => groupCreateRequest({ chatId: randomUUID(), name, participantUids: ['peer'] })
  const rename = (name: string) => groupNameEdit({ id: randomUUID(), requestId: randomUUID(), chatId: 'g1', version: '1:0', name })
  const channel = (name: string) => channelCreationPrepare({ id: randomUUID(), name, description: '' })
  const channelRename = (name: string) => channelNameEdit({ id: randomUUID(), requestId: randomUUID(), channelId: 'c1', version: '1:0', name })
  for (const check of [group, rename, channel, channelRename]) {
    assert.doesNotThrow(() => check(units(51)), `${check.name}: longer than the old 50`)
    assert.doesNotThrow(() => check(units(128)))
    assert.throws(() => check(units(129)))
    assert.throws(() => check('   '))
  }
})

// §E-4: the Desktop already released (0.240.1) must read a 51–128 character title without trouble. It reads every
// stored title with a 512 limit (checked in 30899df); these are the same readers on this branch.
test('a title of up to 128 units is read in the chat list and in a channel\'s summary', () => {
  const title = units(100) + emoji.repeat(14) // 128 units
  const chat = { name: `${documents}/chats/g1`, updateTime: { seconds: '1', nanos: 0 }, createTime: { seconds: '1', nanos: 0 },
    fields: { type: { stringValue: 'group' }, participantUids: { arrayValue: { values: [{ stringValue: 'me' }, { stringValue: 'peer' }] } }, name: { stringValue: title } } } as unknown as FirestoreDocument
  assert.equal(decodeDialog(chat, 'me').summary.title, title)
  const channel = { name: `${documents}/channels/c1`, updateTime: { seconds: '1', nanos: 0 }, createTime: { seconds: '1', nanos: 0 },
    fields: { name: { stringValue: title }, ownerId: { stringValue: 'owner' }, createdAt: { timestampValue: { seconds: '1', nanos: 0 } } } } as unknown as FirestoreDocument
  assert.equal(decodeChannelSummary(channel, 'me', true).name, title)
})
