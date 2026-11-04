import assert from 'node:assert/strict'
import { test } from 'node:test'
import { accountBadgeState, appBadgeState } from '../../src/shared/app-badge'
import { defaultPreferences, type DialogSummary } from '../../src/shared/model'
import { preferencePatch } from '../../src/shared/validation'

// F-AC-005: tdesktop «Include muted chats» (includeMutedCounter, on by default): off, a muted chat adds nothing — its
// messages, its chat in «채팅 수», its mark — and the count is never grey (data_session.cpp:3716-3733).
const dialog = (id: string, unreadCount: number, extra: Partial<DialogSummary> = {}): DialogSummary =>
  ({ id, kind: 'direct', unreadCount, markedUnread: false, muted: false, archived: false, service: false, participantUids: ['me', 'peer'], ...extra } as unknown as DialogSummary)
const me = (dialogs: DialogSummary[]) => [{ uid: 'me', dialogs }]
const prefs = (badgeIncludeMuted: boolean, badgeMode: 'messages' | 'chats' = 'messages') => ({ showUnreadBadge: true, badgeMode, badgeIncludeMuted })
const mixed = [dialog('a', 3), dialog('b', 2, { muted: true }), dialog('m', 0, { markedUnread: true, muted: true })]

test('on by default, so the count stays what it was', () => {
  assert.equal(defaultPreferences.badgeIncludeMuted, true)
  assert.deepEqual(appBadgeState(prefs(true), me(mixed), true), { count: 6, muted: false })
  assert.deepEqual(appBadgeState(prefs(true), me([dialog('b', 2, { muted: true })]), true), { count: 2, muted: true })
})

test('off, muted chats and their marks add nothing, in either count', () => {
  assert.deepEqual(appBadgeState(prefs(false), me(mixed), true), { count: 3, muted: false })
  assert.deepEqual(appBadgeState(prefs(false, 'chats'), me(mixed), true), { count: 1, muted: false })
  assert.deepEqual(appBadgeState(prefs(false), me([dialog('b', 2, { muted: true })]), true), { count: 0, muted: false }, 'nothing left, nothing grey')
})

test('the accounts list counts the same way', () => {
  assert.deepEqual(accountBadgeState('me', mixed, 'messages', false), { count: 3, muted: false })
  assert.deepEqual(accountBadgeState('me', mixed, 'messages'), { count: 6, muted: false })
})

test('the switch is a saved boolean preference', () => {
  assert.deepEqual(preferencePatch({ badgeIncludeMuted: false }), { badgeIncludeMuted: false })
  assert.throws(() => preferencePatch({ badgeIncludeMuted: 'no' }))
})
