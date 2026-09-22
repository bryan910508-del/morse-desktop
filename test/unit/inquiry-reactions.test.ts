import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { decodeInquiryMessage } from '../../src/main/accounts/channel-inquiries'
import { documents, type FirestoreDocument, type WireObject } from '../../src/main/network/firestore-values'
import { inquiryChatMessage, inquiryReactionRequest } from '../../src/shared/channel-inquiries'

// ChannelInquiryService.toggleReaction: an inquiry's message keeps its reactions as a chat's does, and the whole
// selection of this account goes to setMorseMessageReaction with the inquiry.
const at = (ms: number): WireObject => ({ timestampValue: { seconds: String(Math.floor(ms / 1000)), nanos: 0 } })
const users = (...ids: string[]): WireObject => ({ arrayValue: { values: ids.map(id => ({ stringValue: id })) } })
const doc = (fields: Record<string, WireObject>): FirestoreDocument => ({
  name: `${documents}/channelInquiries/inq1/messages/m1`, updateTime: { seconds: '5', nanos: 0 },
  fields: { createdAt: at(Date.now() - 60_000), senderId: { stringValue: 'peer1' }, text: { stringValue: '안녕' }, ...fields }
} as unknown as FirestoreDocument)

test('an inquiry message carries its reactions to the bubble, mine marked', () => {
  const item = decodeInquiryMessage(doc({ reactions: { mapValue: { fields: { '❤️': users('me1', 'peer1'), '👍': users('peer1') } } } }), { id: 'inq1', cutoff: null }, 'me1')!
  assert.deepEqual(item.reactions?.map(reaction => [reaction.emoji, reaction.count, reaction.selected]), [['❤️', 2, true], ['👍', 1, false]])
  assert.deepEqual(inquiryChatMessage(item, 'inq1').reactions.map(reaction => reaction.emoji), ['❤️', '👍'])
  const bare = decodeInquiryMessage(doc({}), { id: 'inq1', cutoff: null }, 'me1')!
  assert.equal(bare.reactions, undefined)
  assert.deepEqual(inquiryChatMessage(bare, 'inq1').reactions, [])
})

test('a reaction request is the sorted selection, twenty at most', () => {
  const requestId = randomUUID()
  const request = inquiryReactionRequest({ requestId, inquiryId: 'ch1_sub1', messageId: 'm1', reactions: ['👍', '❤️', '👍'] })
  assert.deepEqual(request.reactions, ['❤️', '👍'].sort())
  assert.deepEqual(inquiryReactionRequest({ requestId, inquiryId: 'ch1_sub1', messageId: 'm1', reactions: [] }).reactions, [], 'taking every reaction back')
  assert.throws(() => inquiryReactionRequest({ requestId, inquiryId: 'ch1_sub1', messageId: 'm1', reactions: Array.from({ length: 21 }, (_, i) => `e${i}`) }))
  assert.throws(() => inquiryReactionRequest({ requestId, inquiryId: 'ch1_sub1', messageId: 'm1', reactions: [''] }))
  assert.throws(() => inquiryReactionRequest({ requestId, inquiryId: 'ch1_sub1', messageId: 'm1', reactions: ['❤️'], extra: 1 }))
})
