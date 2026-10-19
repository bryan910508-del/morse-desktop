import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { markClearedTop, withLocalDeletion } from '../../src/main/accounts/hidden-chats'
import { buildInquiryRows } from '../../src/main/accounts/inquiry-rows'
import { documents, type FirestoreDocument, type ReadDialog } from '../../src/main/network/firestore-values'
import { foldOwnedDiscussions, ownerRowId, type InquiryRow } from '../../src/shared/channel-inquiries'
import type { DialogSummary, MessagePosition } from '../../src/shared/model'

// B474: a row whose newest message a boundary covers keeps its place and draws no time. Telegram keeps the cleared
// chat's last message as an empty «history cleared» item at its own date (History::clear → applyEditionToHistoryCleared,
// tdesktop history.cpp:4480-4486, history_item.cpp:3008-3031), so its sort time (_timeId, set only by
// setChatListTimeId, dialogs_entry.cpp:418) stays, and the row paints a date only for a non-empty item
// (dialogs_layout.cpp:807).
const at = (seconds: number, id = ''): MessagePosition => ({ seconds, nanoseconds: 0, id })
const dialog = (top: MessagePosition | null, cutoff: MessagePosition | null = null): ReadDialog =>
  ({ summary: { id: 'c1', kind: 'direct', top, preview: 'hi' } as unknown as DialogSummary, cutoff, participantNames: {}, accountUid: 'me' })

test('a boundary over the newest message marks the row emptied; its top, and so its place, stays', () => {
  const mine = dialog(at(100, 'c1'))
  withLocalDeletion(mine, at(100)); markClearedTop(mine)
  assert.equal(mine.summary.topCleared, true, '«나에게만» clear at the newest message')
  assert.deepEqual(mine.summary.top, at(100, 'c1'), 'the row still sorts by the message it had')
  assert.equal(mine.summary.preview, '')
  // The room's own boundary (기록 모두 지우기) or a discussion's policy that withLocalDeletion leaves in place.
  const room = dialog(at(100, 'c1'), at(150)); markClearedTop(room)
  assert.equal(room.summary.topCleared, true)
  // A message after the boundary brings the time back.
  const after = dialog(at(200, 'c1')); withLocalDeletion(after, at(100)); markClearedTop(after)
  assert.equal(after.summary.topCleared, undefined)
  assert.equal(after.summary.preview, 'hi')
  // No boundary, or no message at all: nothing to mark.
  const plain = dialog(at(100, 'c1')); markClearedTop(plain); assert.equal(plain.summary.topCleared, undefined)
  const empty = dialog(null, at(100)); markClearedTop(empty); assert.equal(empty.summary.topCleared, undefined)
  // A summary read again without its boundary drops an old mark.
  const again = dialog(at(300, 'c1')); again.summary.topCleared = true; markClearedTop(again)
  assert.equal(again.summary.topCleared, undefined)
})

const ms = (value: number) => ({ timestampValue: { seconds: String(Math.floor(value / 1000)), nanos: (value % 1000) * 1e6 } })
const room = (id: string, role: 'subscriber' | 'owner', lastMs: number, channelId = 'ch1'): FirestoreDocument => ({
  name: `${documents}/channelInquiries/${id}`,
  fields: { channelId: { stringValue: channelId }, channelName: { stringValue: '채널' }, subscriberId: { stringValue: role === 'subscriber' ? 'me' : 'sub' },
    channelOwnerId: { stringValue: role === 'owner' ? 'me' : 'own' }, lastMessage: { stringValue: '마지막' }, lastMessageAt: ms(lastMs) }
} as unknown as FirestoreDocument)

test('an inquiry room cleared for me keeps its time for order, and says the line is emptied', () => {
  const mine = (id: string) => id === 'q1' ? { cutoff: 1790000000000, removeRow: false } : id === 'o1' ? { cutoff: 1791000000000, removeRow: false } : null
  const { rows } = buildInquiryRows('me', [room('q1', 'subscriber', 1790000000000), room('q2', 'subscriber', 1789000000000)],
    [room('o1', 'owner', 1791000000000, 'ch2'), room('o2', 'owner', 1790500000000, 'ch2')], () => null, mine)
  const byId = new Map(rows.map(row => [row.inquiryId ?? row.channelId, row]))
  assert.deepEqual([byId.get('q1')?.preview, byId.get('q1')?.cleared, byId.get('q1')?.lastMessageAt], ['', true, 1790000000000])
  assert.equal(byId.get('q2')?.cleared, undefined)
  // An owner folder shows its newest room: cleared, so is the folder's line.
  assert.deepEqual([byId.get('ch2')?.preview, byId.get('ch2')?.cleared, byId.get('ch2')?.lastMessageAt], ['', true, 1791000000000])
  assert.deepEqual(rows.map(row => row.inquiryId ?? row.channelId), ['ch2', 'q1', 'q2'], 'the order is the times kept')
  // The channel row takes the discussion room's line when that is newer, and with it whether it was emptied.
  const folder: InquiryRow = { id: ownerRowId('ch-a'), kind: 'ownerFolder', channelId: 'ch-a', inquiryId: null, title: '내 채널', preview: '문의', lastMessageAt: 100, unread: 0, rooms: 1 }
  assert.equal(foldOwnedDiscussions([folder], [{ channelId: 'ch-a', title: '내 채널', preview: '', at: 200, cleared: true, unread: 0 }])[0].cleared, true)
  assert.equal(foldOwnedDiscussions([{ ...folder, cleared: true }], [{ channelId: 'ch-a', title: '내 채널', preview: '새 글', at: 300, unread: 0 }])[0].cleared, undefined)
  assert.equal(foldOwnedDiscussions([], [{ channelId: 'ch-a', title: '내 채널', preview: '', at: 200, cleared: true, unread: 0 }])[0].cleared, true)
})

test('every row that draws a chat time leaves it out for an emptied line', () => {
  const read = (path: string) => readFileSync(join(__dirname, '../../src/renderer/src', path), 'utf8')
  const widget = read('dialogs/dialogs-widget.tsx'), panel = read('channels/channel-inquiry-panel.tsx')
  assert.match(widget, /dialog\.topCleared \? '' : dialogTime\(positionTime\(dialog\.top\)\)/, 'a chat row')
  assert.match(widget, /inquiry\.cleared \? '' : dialogTime\(inquiry\.lastMessageAt\)/, 'an inquiry row and a channel row')
  assert.match(widget, /at: positionTime\(dialog\.top\), \.\.\.\(dialog\.topCleared \? \{ cleared: true as const \} : \{\}\)/, 'a folded discussion')
  assert.match(panel, /discussion\.topCleared \? '' : dialogTime\(positionTime\(discussion\.top\)\)/, 'the discussion room in a channel\'s list')
  assert.match(panel, /item\.cleared \? '' : dialogTime\(item\.lastMessageAt\)/, 'a room in a channel\'s list')
  // No other chat-row time is drawn from a dialog's top or a room's time.
  assert.equal((widget.match(/dialogTime\(positionTime\(dialog\.top\)\)/g) ?? []).length, 1)
  assert.equal((panel.match(/dialogTime\((?:item|inquiry)\.lastMessageAt\)/g) ?? []).length, 1)
})
