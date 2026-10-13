import assert from 'node:assert/strict'
import { test } from 'node:test'
import { accountBadgeState, appBadgeState } from '../../src/shared/app-badge'
import type { DialogSummary } from '../../src/shared/model'

// B353 (review 10-13 20:4x): the accounts list's number was a third copy of the count, without muted chats and without
// «채팅 수». It is now each account's tdesktop unreadWithMentionsBadge + Muted (settings_information.cpp:138-148,
// data_session.cpp:3648-3664 — v7.3.1 6fed91ff), the same count the Dock adds up (main_domain.cpp:302-314).
const dialog = (id: string, unreadCount: number, extra: Partial<DialogSummary> = {}): DialogSummary =>
  ({ id, kind: 'direct', unreadCount, markedUnread: false, muted: false, archived: false, service: false, participantUids: ['me', 'peer'], ...extra } as unknown as DialogSummary)

test('one account\'s number: marks + messages (or chats), muted chats too, grey only when all of it is muted', () => {
  const rows: [DialogSummary[], 'messages' | 'chats', { count: number; muted: boolean }][] = [
    [[dialog('a', 3), dialog('b', 2, { muted: true })], 'messages', { count: 5, muted: false }],
    [[dialog('b', 2, { muted: true }), dialog('c', 0, { markedUnread: true, muted: true })], 'messages', { count: 3, muted: true }],
    [[dialog('a', 3), dialog('b', 2, { muted: true })], 'chats', { count: 2, muted: false }],
    [[dialog('m', 4, { markedUnread: true })], 'messages', { count: 4, muted: false }],
    [[dialog('r', 1, { archived: true }), dialog('s', 1, { kind: 'secret' } as Partial<DialogSummary>), dialog('n', 1, { service: true } as Partial<DialogSummary>), dialog('o', 1, { participantUids: ['x', 'y'] })], 'messages', { count: 0, muted: false }],
    [[], 'messages', { count: 0, muted: false }]
  ]
  for (const [dialogs, mode, expected] of rows) assert.deepEqual(accountBadgeState('me', dialogs, mode), expected, JSON.stringify([dialogs.map(d => d.id), mode]))
})

test('the Dock is the sum of the accounts\' numbers, grey only when every account with a number is grey', () => {
  const muted = [dialog('b', 2, { muted: true })], loud = [dialog('a', 1)]
  const accounts = [{ uid: 'me', dialogs: muted }, { uid: 'me2', dialogs: loud.map(d => ({ ...d, participantUids: ['me2', 'p'] })) }]
  const each = accounts.map(a => accountBadgeState(a.uid, a.dialogs, 'messages'))
  assert.deepEqual(each, [{ count: 2, muted: true }, { count: 1, muted: false }])
  assert.deepEqual(appBadgeState({ showUnreadBadge: true, badgeMode: 'messages' }, accounts, true), { count: 3, muted: false })
  assert.deepEqual(appBadgeState({ showUnreadBadge: true, badgeMode: 'messages' }, [accounts[0]!, { uid: 'me3', dialogs: [] }], true), { count: 2, muted: true }, 'an account with nothing does not make it loud')
  assert.equal(accountBadgeState('me', muted, 'messages').count, 2, '«배지 표시» is the Dock\'s switch: the accounts list keeps its number')
})
