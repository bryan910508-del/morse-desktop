import assert from 'node:assert/strict'
import { test } from 'node:test'
import { InquiryRows } from '../../src/main/accounts/inquiry-rows'
import type { ReadCredentials } from '../../src/main/network/firestore-rpc'
import { documents, type FirestoreDocument } from '../../src/main/network/firestore-values'
import { ownerRowId, subscriberRowId } from '../../src/shared/channel-inquiries'

// B521: «읽음으로 표시» on an inquiry row with unread messages reads them to the newest message, as Telegram's «Mark as
// read» moves the read position to the end (TA DialogsActivity markAsRead :9573-9574 · markDialogsAsRead :9587-9601):
// the room for a subscriber row, each unread room of the channel for an owner's folder (Android 0c5c6aca).
const me = 'me'
const auth = { signal: new AbortController().signal, authorize: async () => ({ idToken: 'id', appCheckToken: 'check', expiresAt: Date.now() + 3600000 }) } as ReadCredentials
const room = (id: string, fields: Record<string, string | number>): FirestoreDocument => ({ name: `${documents}/channelInquiries/${id}`,
  fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, typeof value === 'number' ? { integerValue: String(value) } : { stringValue: value }])) } as unknown as FirestoreDocument)
function rows() {
  const list = new InquiryRows(me, auth, () => {}, () => {})
  const inner = list as unknown as { subscriber: Map<string, FirestoreDocument>; owner: Map<string, FirestoreDocument> }
  for (const doc of [room('s1', { subscriberId: me, channelId: 'cx', unreadForSubscriber: 2 }), room('s2', { subscriberId: me, channelId: 'cy', unreadForSubscriber: 0 })]) inner.subscriber.set(doc.name, doc)
  for (let n = 0; n < 7; n++) { const doc = room(`o${n}`, { channelOwnerId: me, channelId: 'c1', unreadForOwner: n % 2 ? 1 : 0 }); inner.owner.set(doc.name, doc) }
  const other = room('o9', { channelOwnerId: me, channelId: 'c2', unreadForOwner: 3 }); inner.owner.set(other.name, other)
  return list
}

test('B521: a subscriber row reads its room; an owner folder reads only the unread rooms of that channel', () => {
  const list = rows()
  assert.deepEqual(list.unreadRooms(subscriberRowId('s1')), ['s1'])
  assert.deepEqual(list.unreadRooms(subscriberRowId('s2')), [], 'nothing unread: nothing to read')
  assert.deepEqual(list.unreadRooms(ownerRowId('c1')).sort(), ['o1', 'o3', 'o5'])
  list.close()
})

test('B521: each room is read to its newest message (no message named), four at a time', async () => {
  const list = rows(), calls: Record<string, unknown>[] = []
  let running = 0, most = 0
  const call = (async (_auth: unknown, name: string, data: Record<string, unknown>) => {
    assert.equal(name, 'markMorseInquiryRead'); calls.push(data); running++; most = Math.max(most, running)
    await new Promise(resolve => setTimeout(resolve, 5)); running--; return {}
  }) as never
  const inner = list as unknown as { owner: Map<string, FirestoreDocument> }
  for (let n = 10; n < 20; n++) { const doc = room(`o${n}`, { channelOwnerId: me, channelId: 'c1', unreadForOwner: 1 }); inner.owner.set(doc.name, doc) }
  assert.equal(await list.readRow(ownerRowId('c1'), call), 13)
  assert.ok(calls.every(data => data.expectedUid === me && !('messageId' in data)))
  assert.ok(most <= 4)
  list.close()
})

test('B521: a room that could not be read says so', async () => {
  const list = rows()
  await assert.rejects(list.readRow(subscriberRowId('s1'), (async () => { throw new Error('offline') }) as never))
  list.close()
})
