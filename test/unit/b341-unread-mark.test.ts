import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { DialogSummary } from '../../src/shared/model'
import { effectiveUnreadCount } from '../../src/shared/manual-unread'

// B341 (contracts/B341-manual-unread-mark.md §3-3, §6): «읽지 않음으로 표시» is drawn apart from the count, as tdesktop's
// History::computeUnreadState marks a chat only when it has no count (history.cpp:2885-2890, v7.3.1 6fed91ff) and the
// row paints a badge with no number for it (dialogs_layout.cpp:181 PaintUnreadBadge(QString())). The app's badge counts
// the mark, once and only with no count (data_session.cpp:3716-3721 computeUnreadBadge: marks + messages or chats).
;(globalThis as unknown as { window: unknown }).window = { morse: { setManualUnread: async () => {}, setDialogPin: async () => {}, checkManualUnread: async () => {}, checkDialogPin: async () => {} } }
const dialog = (id: string, unreadCount: number, markedUnread: boolean): DialogSummary =>
  ({ id, version: '100:0', kind: 'direct', unreadCount, markedUnread, pinned: false, pinVersion: '' } as unknown as DialogSummary)

test('a row: a count shows its number, a mark with no count shows a badge with none, neither shows nothing', async () => {
  const { dialogFlags } = await import('../../src/renderer/src/dialogs/dialog-overrides')
  assert.deepEqual(pick(dialogFlags(dialog('a', 3, false))), { unread: 3, marked: false })
  assert.deepEqual(pick(dialogFlags(dialog('b', 3, true))), { unread: 3, marked: false }, 'a count wins over the mark (history.cpp:2887 mark = !count && unreadMark())')
  assert.deepEqual(pick(dialogFlags(dialog('c', 0, true))), { unread: 0, marked: true }, 'the mark alone: no number')
  assert.deepEqual(pick(dialogFlags(dialog('d', 0, false))), { unread: 0, marked: false })
})

test('marking from the list shows the badge with no number at once, before the server answers', async () => {
  const { dialogFlags, setUnread } = await import('../../src/renderer/src/dialogs/dialog-overrides')
  const before = dialog('e', 0, false)
  await setUnread('me', before, true)
  assert.deepEqual(pick(dialogFlags(before)), { unread: 0, marked: true })
})

test('the dock counts a mark once, and only for a chat with no count (tdesktop computeUnreadBadge)', () => {
  // messages mode: marks + messages — the per-chat value is max(count, mark ? 1 : 0)
  assert.equal(effectiveUnreadCount({ unreadCount: 0, markedUnread: true }), 1)
  assert.equal(effectiveUnreadCount({ unreadCount: 4, markedUnread: true }), 4, 'not 5: a chat with a count is not a mark (marks = !count && unreadMark())')
  assert.equal(effectiveUnreadCount({ unreadCount: 4, markedUnread: false }), 4)
  assert.equal(effectiveUnreadCount({ unreadCount: 0, markedUnread: false }), 0)
})

function pick(flags: { unread: number; marked: boolean }): { unread: number; marked: boolean } { return { unread: flags.unread, marked: flags.marked } }
