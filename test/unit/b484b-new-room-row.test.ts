import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildInquiryRows } from '../../src/main/accounts/inquiry-rows'
import { documents, type FirestoreDocument } from '../../src/main/network/firestore-values'

// B484b: this account's boundary for an inquiry room (users/{uid}/historyClears, removeRow) hid a room made again under
// the same id until its first message: a room with no message had no time, and no time counted as inside the boundary.
// A room with no message is now placed by when it was made (createdAt), so a room made after the boundary shows, as
// what comes after tdesktop's boundary shows (History::clearUpTill, history.cpp:4518-4540). A room the boundary was set
// on, with nothing new since, is still away (B327).

const at = (seconds: number) => ({ timestampValue: { seconds: String(seconds), nanos: 0 } })
const room = (id: string, side: 'subscriber' | 'owner', made: number, lastMessageAt?: number): FirestoreDocument => ({
  name: `${documents}/channelInquiries/${id}`,
  fields: { channelId: { stringValue: 'ch1' }, channelName: { stringValue: '검증용' }, createdAt: at(made),
    subscriberId: { stringValue: side === 'subscriber' ? 'me' : 'sub1' }, channelOwnerId: { stringValue: side === 'owner' ? 'me' : 'owner1' },
    ...(lastMessageAt ? { lastMessageAt: at(lastMessageAt) } : {}) }
} as unknown as FirestoreDocument)
const boundary = (seconds: number, removeRow = true) => (id: string) => id === 'ch1_x' ? { cutoff: seconds * 1000, removeRow } : null
const subscriberRows = (doc: FirestoreDocument, mine: ReturnType<typeof boundary>) => buildInquiryRows('me', [doc], [], () => null, mine).rows
const ownerRows = (doc: FirestoreDocument, mine: ReturnType<typeof boundary>) => buildInquiryRows('me', [], [doc], () => null, mine).rows

test('a room made after the boundary, with no message yet, has its row', () => {
  const rows = subscriberRows(room('ch1_x', 'subscriber', 2_000_000), boundary(1_000_000))
  assert.equal(rows.length, 1)
  assert.equal(rows[0]!.cleared, undefined, 'a new room, not a cleared one')
  // A cleared line (removeRow false) is not drawn on it either.
  assert.equal(subscriberRows(room('ch1_x', 'subscriber', 2_000_000), boundary(1_000_000, false))[0]!.cleared, undefined)
})

test('a room the boundary was set on, with nothing new since, stays away; a message after it brings it back (B327)', () => {
  assert.equal(subscriberRows(room('ch1_x', 'subscriber', 500_000), boundary(1_000_000)).length, 0, 'made before the boundary, no message: away')
  assert.equal(subscriberRows(room('ch1_x', 'subscriber', 500_000, 900_000), boundary(1_000_000)).length, 0, 'its last message is inside the boundary: away')
  assert.equal(subscriberRows(room('ch1_x', 'subscriber', 500_000, 1_100_000), boundary(1_000_000)).length, 1, 'a message after it: back')
  assert.equal(subscriberRows(room('ch1_x', 'subscriber', 500_000), boundary(1_000_000, false))[0]!.cleared, true, 'a cleared line stays cleared')
})

test('the owner\'s folder follows the same rule', () => {
  assert.equal(ownerRows(room('ch1_x', 'owner', 2_000_000), boundary(1_000_000)).length, 1, 'a room made after the boundary: its folder shows')
  assert.equal(ownerRows(room('ch1_x', 'owner', 500_000), boundary(1_000_000)).length, 0, 'the room the boundary was set on: away')
})
