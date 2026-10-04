import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { DialogSummary } from '../../src/shared/model'
import type { ManualUnreadSnapshot } from '../../src/shared/manual-unread'

// B104 (b, user rule «텔레그램 구조»): the list's «읽음으로 표시» shows at once, as tdesktop applies
// changeDialogUnreadMark before the request goes, but the server's copy of the chat is what the row shows once the
// server has answered and a newer copy has come (data_histories.cpp:516-527) — never a count the server does not hold.
let lastRequest = ''
;(globalThis as unknown as { window: unknown }).window = { morse: {
  setManualUnread: async (_uid: string, request: { id: string }) => { lastRequest = request.id },
  setDialogPin: async (_uid: string, request: { id: string }) => { lastRequest = request.id },
  checkManualUnread: async () => {}, checkDialogPin: async () => {}
} }

const dialog = (id: string, version: string, unreadCount: number, markedUnread = false, pinned = false, pinVersion = ''): DialogSummary =>
  ({ id, version, kind: 'direct', unreadCount, markedUnread, pinned, pinVersion } as unknown as DialogSummary)
const saved = (chatId: string, id: string, markedUnread: boolean): ManualUnreadSnapshot =>
  ({ id, chatId, markedUnread, state: 'saved', checking: false, message: '' })

async function requested(before: DialogSummary, markedUnread: boolean): Promise<string> {
  const { setUnread } = await import('../../src/renderer/src/dialogs/dialog-overrides')
  await setUnread('me', before, markedUnread)
  return lastRequest
}

test('B104 (b): «읽음으로 표시» shows 0 at once, before the server answers', async () => {
  const { dialogFlags } = await import('../../src/renderer/src/dialogs/dialog-overrides')
  const before = dialog('c1', '100:0', 4)
  await requested(before, false)
  assert.equal(dialogFlags(before).unread, 0)
  assert.equal(dialogFlags(dialog('c1', '101:0', 5)).unread, 0, 'a newer copy before the answer (a new message) does not undo the request')
})

test('B104 (b): once answered, a newer server copy rules — the count it holds is shown even when it did not move', async () => {
  const { dialogFlags, reconcileUnread, reconcileDialogs } = await import('../../src/renderer/src/dialogs/dialog-overrides')
  const before = dialog('c2', '200:0', 4)
  const id = await requested(before, false)
  reconcileUnread('me', saved('c2', id, false))
  assert.equal(dialogFlags(dialog('c2', '200:0', 4)).unread, 0, 'answered, but no newer copy yet: the request still shows')
  const after = dialog('c2', '200:5', 4)
  assert.equal(dialogFlags(after).unread, 4, 'the server wrote the chat and kept 4: the row says 4, as the server does')
  reconcileDialogs([after])
  assert.equal(dialogFlags(dialog('c2', '200:5', 4)).unread, 4, 'the request is spent')
})

test('B104 (b): a newer copy that agrees ends the request as before', async () => {
  const { dialogFlags, reconcileDialogs } = await import('../../src/renderer/src/dialogs/dialog-overrides')
  const before = dialog('c3', '300:0', 0)
  await requested(before, true)
  assert.deepEqual(dialogFlags(before), { pinned: false, unread: 0, marked: true })
  const after = dialog('c3', '301:0', 1, true)
  reconcileDialogs([after])
  assert.deepEqual(dialogFlags(after), { pinned: false, unread: 1, marked: false }, 'the server copy: count 1, which the badge shows')
})

test('B104 (b): a refused request goes back to the server copy at once', async () => {
  const { dialogFlags, reconcileUnread } = await import('../../src/renderer/src/dialogs/dialog-overrides')
  const before = dialog('c4', '400:0', 3)
  const id = await requested(before, false)
  reconcileUnread('me', { id, chatId: 'c4', markedUnread: false, state: 'rejected', checking: false, message: 'x' })
  assert.equal(dialogFlags(before).unread, 3)
})

test('B104 (b): a pin follows the same rule — answered, its newer dialogStates copy rules', async () => {
  const { dialogFlags, setPinned, reconcilePin } = await import('../../src/renderer/src/dialogs/dialog-overrides')
  const before = dialog('c5', '500:0', 0, false, false, '')
  await setPinned('me', before, true)
  const id = lastRequest
  assert.equal(dialogFlags(before).pinned, true, 'pinned at once')
  reconcilePin('me', { id, chatId: 'c5', pinned: true, state: 'saved', checking: false, message: '' })
  assert.equal(dialogFlags(dialog('c5', '500:0', 0, false, false, '')).pinned, true, 'answered, no newer pin copy yet')
  assert.equal(dialogFlags(dialog('c5', '501:0', 0, false, false, '')).pinned, true, 'a newer chat copy is not the pin copy')
  assert.equal(dialogFlags(dialog('c5', '501:0', 0, false, false, '600:0')).pinned, false, 'the newer pin copy says unpinned (another device): it rules')
})

test('versionNewer compares «seconds:nanoseconds», an empty version being the oldest', async () => {
  const { versionNewer } = await import('../../src/shared/model')
  assert.equal(versionNewer('10:1', '10:0'), true)
  assert.equal(versionNewer('10:0', '9:999999999'), true)
  assert.equal(versionNewer('10:0', '10:0'), false)
  assert.equal(versionNewer('1:0', ''), true)
  assert.equal(versionNewer('', '1:0'), false)
})
