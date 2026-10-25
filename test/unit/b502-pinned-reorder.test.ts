import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { status } from '@grpc/grpc-js'
import type { DialogSummary } from '../../src/shared/model'
import { dialogPinOrderRequest, pinOrderLimit } from '../../src/shared/dialog-pins'
import { DialogPinWriteFailure, writeDialogPinOrder } from '../../src/main/network/dialog-pin-write'
import { documents, type FirestoreDocument } from '../../src/main/network/firestore-values'
import { DialogPins } from '../../src/main/accounts/dialog-pins'
import { droppedRanks, moved, pinRanks, reorderShift, reorderSlot, reorderThreshold } from '../../src/renderer/src/dialogs/pinned-reorder'

// B502: pinned chats are dragged into a new order the way Telegram Desktop does it — a 30 px threshold, the row follows
// the pointer while the others step aside, and the order is saved once, when let go (dialogs_inner_widget.cpp:110,
// :2706-2724, :2851-2919, :2786-2790). The order is the pins' ranks, top first (iOS handleTablePinnedReorder: now − i).

const orders: { id: string; chats: { chatId: string; rank: number }[] }[] = []
let refuse: Error | null = null
;(globalThis as unknown as { window: unknown }).window = { morse: {
  setDialogPinOrder: async (_uid: string, request: { id: string; chats: { chatId: string; rank: number }[] }) => { orders.push(request); if (refuse) throw refuse },
  setDialogPin: async () => {}, checkDialogPin: async () => {}, setManualUnread: async () => {}, checkManualUnread: async () => {}
} }

test('the drag: 30 px before it starts, a neighbour passed at its half, the others step aside, one row moves', () => {
  assert.equal(reorderThreshold, 30)
  const range = { start: 2, end: 6 }
  assert.equal(reorderSlot(3, 30, 62, range), 3, 'under half a row it keeps its place')
  assert.equal(reorderSlot(3, 31, 62, range), 4, 'half over the row below: they change places')
  assert.equal(reorderSlot(3, -31, 62, range), 2)
  assert.equal(reorderSlot(3, 62 * 9, 62, range), 5, 'never below the last pinned row')
  assert.equal(reorderSlot(3, -62 * 9, 62, range), 2, 'never above the first')
  // Dragged from 2 to 4: rows 3 and 4 move up one place; dragged from 4 to 2: rows 2 and 3 move down.
  assert.deepEqual([2, 3, 4, 5].map(index => reorderShift(index, 2, 4, 62)), [0, -62, -62, 0])
  assert.deepEqual([2, 3, 4, 5].map(index => reorderShift(index, 4, 2, 62)), [62, 62, 0, 0])
  assert.deepEqual(moved(['a', 'b', 'c', 'd'], 0, 2), ['b', 'c', 'a', 'd'])
  assert.deepEqual(moved(['a', 'b', 'c', 'd'], 3, 1), ['a', 'd', 'b', 'c'])
  assert.deepEqual(pinRanks(3, 1000), [1000, 999, 998], 'top first, one second apart from the drop')
  // The rows a tab shows keep their places among themselves, so pinned chats not shown stay where they were.
  assert.deepEqual(droppedRanks([700, 900, 500], 1000), [900, 700, 500])
  assert.deepEqual(droppedRanks([700, 700, 500], 1000), [1000, 999, 998], 'places that cannot be told apart: fresh ranks')
  assert.deepEqual(droppedRanks([700, 0], 1000), [1000, 999], 'a row with no time yet: fresh ranks')
})

test('an order is checked before it goes: pinned copies, ranks falling, no chat twice, a bounded count', () => {
  const chat = (chatId: string, rank: number, version = '10:0') => ({ chatId, version, rank })
  const ok = dialogPinOrderRequest({ id: 'op1', chats: [chat('a', 3), chat('b', 2)] })
  assert.deepEqual(ok.chats.map(item => item.chatId), ['a', 'b'])
  for (const chats of [[], [chat('a', 2), chat('b', 2)], [chat('a', 2), chat('b', 3)], [chat('a', 3), chat('a', 2)], [chat('a', 3, '')], [chat('a', 0)], [chat('a', 2e12)],
    Array.from({ length: pinOrderLimit + 1 }, (_, index) => chat(`c${index}`, 1e6 - index))]) {
    assert.throws(() => dialogPinOrderRequest({ id: 'op1', chats }), undefined, JSON.stringify(chats).slice(0, 60))
  }
})

const at = (seconds: number) => ({ seconds: String(seconds), nanos: 0 })
const pinDoc = (chatId: string, pinned = true, seconds = 100): FirestoreDocument => ({ name: `${documents}/users/me/dialogStates/${chatId}`, updateTime: at(seconds), createTime: at(1),
  fields: { isPinned: { booleanValue: pinned }, rank: { doubleValue: 5 }, operationId: { stringValue: 'old' } } } as unknown as FirestoreDocument)
function client(error: { code: number } | null = null) {
  const sent: { writes: { update: { name: string; fields: Record<string, Record<string, unknown>> }; currentDocument: unknown }[] }[] = []
  return { sent, commit(request: never, _metadata: unknown, _options: unknown, callback: (error: unknown, response: unknown) => void) {
    sent.push(request)
    const writes = (request as { writes: unknown[] }).writes
    queueMicrotask(() => error ? callback(error, {}) : callback(null, { writeResults: writes.map(() => ({})), commitTime: at(200) }))
    return { cancel() {} }
  } }
}

test('the order is one commit: each pin keeps isPinned, takes its rank and its own operation, from the copy it was read on', async () => {
  const fake = client(), docs = [pinDoc('a'), pinDoc('b')]
  const version = (doc: FirestoreDocument) => `${(doc.updateTime as { seconds: string }).seconds}:0`
  const request = { id: 'op1', chats: [{ chatId: 'a', version: version(docs[0]!), rank: 1000 }, { chatId: 'b', version: version(docs[1]!), rank: 999 }] }
  await writeDialogPinOrder(fake as never, {} as never, 'me', request, docs, new AbortController().signal)
  assert.equal(fake.sent.length, 1, 'one commit for the whole order')
  const writes = fake.sent[0]!.writes
  assert.deepEqual(writes.map(write => [write.update.name.split('/').at(-1), write.update.fields.isPinned!.booleanValue, write.update.fields.rank!.doubleValue, write.update.fields.operationId!.stringValue]),
    [['a', true, 1000, 'op1:0'], ['b', true, 999, 'op1:1']])
  assert.deepEqual(writes.map(write => write.currentDocument), [{ updateTime: docs[0]!.updateTime }, { updateTime: docs[1]!.updateTime }])
  // A pin read on another copy, or no longer pinned, stops the order before anything is sent.
  const stale = client()
  await assert.rejects(writeDialogPinOrder(stale as never, {} as never, 'me', { ...request, chats: [{ ...request.chats[0]!, version: '1:0' }, request.chats[1]!] }, docs, new AbortController().signal), DialogPinWriteFailure)
  await assert.rejects(writeDialogPinOrder(stale as never, {} as never, 'me', request, [pinDoc('a', false), docs[1]!], new AbortController().signal), DialogPinWriteFailure)
  assert.equal(stale.sent.length, 0)
  // A copy changed meanwhile is a definite refusal; a lost answer is not.
  const refused = await writeDialogPinOrder(client({ code: status.FAILED_PRECONDITION }) as never, {} as never, 'me', request, docs, new AbortController().signal).catch(error => error)
  assert.equal((refused as DialogPinWriteFailure).uncertain, false)
  const lost = await writeDialogPinOrder(client({ code: status.UNAVAILABLE }) as never, {} as never, 'me', request, docs, new AbortController().signal).catch(error => error)
  assert.equal((lost as DialogPinWriteFailure).uncertain, true)
})

test('an order runs alone: no pin starts under it, and a pin whose answer is unknown keeps it from starting', async () => {
  const credentials = { signal: new AbortController().signal, authorize: async () => { throw new Error('offline') } }
  let sourced = 0
  const pins = new DialogPins('me', credentials as never, () => undefined, () => {}, () => { sourced++; return [pinDoc('a'), pinDoc('b')] })
  const request = { id: 'op1', chats: [{ chatId: 'a', version: '100:0', rank: 2 }, { chatId: 'b', version: '100:0', rank: 1 }] }
  const task = pins.reorder(request)
  assert.equal(pins.canChange('a'), false, 'no pin while the order is saving')
  assert.equal(pins.reorder(request), task, 'the same order asked again is the same task')
  assert.throws(() => pins.reorder({ ...request, id: 'op2' }), 'a second order waits for the first')
  await assert.rejects(task, DialogPinWriteFailure)
  assert.ok(sourced >= 1)
  assert.equal(pins.canChange('a'), true, 'after it, pins go again')
  const refusing = new DialogPins('me', credentials as never, () => undefined, () => {}, () => { throw new Error('changed') })
  assert.throws(() => refusing.reorder(request), /changed/, 'an order whose chats changed does not start')
})

const dialog = (id: string, pinRank: number, pinVersion = '100:0', pinned = true): DialogSummary =>
  ({ id, version: '1:0', kind: 'direct', unreadCount: 0, markedUnread: false, pinned, pinVersion, pinRank } as unknown as DialogSummary)

test('a dropped order shows at once, stays until a newer pin copy has come after the answer, and goes back on a refusal', async () => {
  const { pinRank, pinUnsettled, reconcileDialogs, setPinOrder } = await import('../../src/renderer/src/dialogs/dialog-overrides')
  const a = dialog('pa', 10), b = dialog('pb', 9)
  const saving = setPinOrder('me', [{ dialog: b, rank: 50 }, { dialog: a, rank: 49 }])
  assert.deepEqual([pinRank(b), pinRank(a)], [50, 49], 'the new order before the answer')
  assert.equal(pinUnsettled(a), true, 'no second drag over an order not settled')
  await saving
  assert.deepEqual(orders.at(-1)!.chats.map(chat => [chat.chatId, chat.rank]), [['pb', 50], ['pa', 49]])
  reconcileDialogs([dialog('pa', 10), dialog('pb', 9)])
  assert.equal(pinRank(dialog('pa', 10)), 49, 'answered, but the same copy: the order still shows')
  reconcileDialogs([dialog('pa', 49, '101:0'), dialog('pb', 50, '101:0')])
  assert.equal(pinRank(dialog('pa', 49, '101:0')), 49, 'the newer copy is what shows now')
  assert.equal(pinUnsettled(dialog('pa', 49, '101:0')), false)
  refuse = new Error('고정 상태가 변경되었습니다.')
  await setPinOrder('me', [{ dialog: dialog('pc', 3), rank: 70 }, { dialog: dialog('pd', 2), rank: 69 }])
  refuse = null
  assert.deepEqual([pinRank(dialog('pc', 3)), pinRank(dialog('pd', 2))], [3, 2], 'refused: back to the server order')
})

test('an inquiry row pinned now takes the time on the chats\' clock; a drag sets it; let go, it keeps none', async () => {
  const { inquiryRowState, setInquiryRowState } = await import('../../src/renderer/src/dialogs/inquiry-row-state')
  const before = Date.now() / 1000
  setInquiryRowState('me', 'room1', { pinned: true })
  const pinned = inquiryRowState('me', 'room1').pinnedAt
  assert.ok(pinned >= before && pinned <= Date.now() / 1000 + 1)
  setInquiryRowState('me', 'room1', { pinnedAt: 42 })
  assert.equal(inquiryRowState('me', 'room1').pinnedAt, 42, 'the rank a drag gave it')
  setInquiryRowState('me', 'room1', { muted: true })
  assert.equal(inquiryRowState('me', 'room1').pinnedAt, 42, 'another change keeps it')
  setInquiryRowState('me', 'room1', { pinned: false })
  assert.equal(inquiryRowState('me', 'room1').pinnedAt, 0)
})

test('the list: one clock for pinned chats and inquiry rows, the drag on the pinned rows only, saved by scope', () => {
  const read = (path: string) => readFileSync(join(__dirname, '../../src', path), 'utf8')
  const widget = read('renderer/src/dialogs/dialogs-widget.tsx'), session = read('main/accounts/session.ts')
  assert.match(widget, /pinnedChats\.sort\(\(a, b\) => \{ const x = pinRankOf\(a\), y = pinRankOf\(b\); return x === y \? 0 : x > y \? -1 : 1 \}\)/)
  // B503 put the notes row's device place on the same clock (b503-notes-row.test.ts).
  assert.match(widget, /const pinRankOf = \(row: Row\): number => row\.kind === 'dialog' \? pinRank\(row\.dialog\) : row\.kind === 'inquiry' \? rowState\(row\.inquiry\.id\)\.pinnedAt\n/)
  assert.match(widget, /let pinnedRange: PinnedRange \| null = needle \? null :/, 'no drag while searching')
  assert.match(widget, /const draggable = !query && status === 'ready' && pinned\.every\(row => row\.kind !== 'dialog' \|\| inFolderPins \|\| \(row\.dialog\.kind !== 'secret' && !pinUnsettled\(row\.dialog\)\)\)/)
  assert.match(widget, /pinnedChatIds: \[\.\.\.ids, \.\.\.custom\.pinnedChatIds\.filter\(id => !ids\.includes\(id\)\)\]/, 'a folder keeps its pinned list')
  assert.match(widget, /void setPinOrder\(accountUid, chats\)/)
  assert.match(widget, /const ranks = droppedRanks\(next\.map\(row => row\.kind === 'dialog' \? pinRank\(row\.dialog\) :/)
  assert.match(widget, /className=\{`dialogs-virtual\$\{drag \? ' reordering' : ''\}`\} style=\{\{ height: virtual\.getTotalSize\(\) \}\} onPointerDown=\{onPointerDown\}/)
  assert.match(widget, /style: CSSProperties = rowStyle\(item\.index, item\.start\)/)
  assert.match(session, /value\.summary\.pinRank = value\.summary\.pinned \? pins\.get\(value\.summary\.id\)\?\.rank \?\? 0 : 0/)
  assert.match(session, /request => this\.pinOrderSource\(request\)/)
})
