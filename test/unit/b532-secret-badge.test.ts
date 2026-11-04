import assert from 'node:assert/strict'
import { test } from 'node:test'
import { accountBadgeState, appBadgeState } from '../../src/shared/app-badge'
import type { DialogSummary } from '../../src/shared/model'

// B532 (review 11-03 10:5x): a secret chat (v1, a chats/{id} room of type secret) counts like a 1:1, as Telegram-Android
// and Telegram-iOS count it; its unreadCount is the server's own, raised and recounted as a 1:1's.
const dialog = (id: string, kind: 'direct' | 'group' | 'secret', unreadCount: number, extra: Partial<DialogSummary> = {}): DialogSummary =>
  ({ id, kind, unreadCount, markedUnread: false, muted: false, archived: false, service: false, participantUids: ['me', 'peer'], ...extra } as unknown as DialogSummary)
const prefs = (patch: Record<string, unknown> = {}) => ({ showUnreadBadge: true, badgeMode: 'messages' as const, badgeIncludeMuted: true, notifyPersonal: true, notifyGroup: true, ...patch })
const me = (dialogs: DialogSummary[]) => [{ uid: 'me', dialogs }]
const secret = (unread: number, extra: Partial<DialogSummary> = {}) => dialog('s', 'secret', unread, extra)

test('a secret chat counts, by messages or as one chat, and a mark counts once', () => {
  const rows: [Record<string, unknown>, DialogSummary[], { count: number; muted: boolean }][] = [
    [{}, [secret(2)], { count: 2, muted: false }],
    [{}, [dialog('d', 'direct', 1), secret(2)], { count: 3, muted: false }],
    [{ badgeMode: 'chats' }, [dialog('d', 'direct', 1), secret(2)], { count: 2, muted: false }],
    [{}, [secret(0, { markedUnread: true })], { count: 1, muted: false }],
    [{}, [secret(0)], { count: 0, muted: false }]
  ]
  for (const [patch, dialogs, expected] of rows) assert.deepEqual(appBadgeState(prefs(patch), me(dialogs), true), expected, JSON.stringify([patch, dialogs.map(d => d.id)]))
})

test('a secret chat is muted by its own switch or by «개인 채팅», as a 1:1', () => {
  assert.deepEqual(appBadgeState(prefs(), me([secret(2, { muted: true })]), true), { count: 2, muted: true })
  assert.deepEqual(appBadgeState(prefs({ badgeIncludeMuted: false }), me([secret(2, { muted: true })]), true), { count: 0, muted: false })
  assert.deepEqual(appBadgeState(prefs({ notifyPersonal: false }), me([secret(2)]), true), { count: 2, muted: true })
  assert.deepEqual(appBadgeState(prefs({ notifyGroup: false }), me([secret(2)]), true), { count: 2, muted: false })
  assert.deepEqual(appBadgeState(prefs({ notifyPersonal: false, badgeIncludeMuted: false }), me([secret(2), dialog('g', 'group', 1)]), true), { count: 1, muted: false })
})

test('archived or not this account\'s, it stays out as any chat does; the accounts list counts the same', () => {
  assert.deepEqual(appBadgeState(prefs(), me([secret(2, { archived: true }), dialog('t', 'secret', 3, { participantUids: ['a', 'b'] })]), true), { count: 0, muted: false })
  assert.deepEqual(accountBadgeState('me', [secret(2), dialog('d', 'direct', 1)], 'messages'), { count: 3, muted: false })
})
