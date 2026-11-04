import assert from 'node:assert/strict'
import { test } from 'node:test'
import { accountBadgeState, appBadgeState, badgeMuted } from '../../src/shared/app-badge'
import { defaultPreferences, type DialogSummary } from '../../src/shared/model'

// B532: tdesktop NotifySettings::isMuted (data_notify_settings.cpp:547-561) — a chat with no switch of its own follows
// its kind's default, so a 1:1 with «개인 채팅» off or a group with «그룹 채팅» off is muted for the count: counted and
// grey with «알림 끈 대화 포함» on (the default), left out with it off.
const dialog = (id: string, kind: 'direct' | 'group', unreadCount: number, extra: Partial<DialogSummary> = {}): DialogSummary =>
  ({ id, kind, unreadCount, markedUnread: false, muted: false, archived: false, service: false, participantUids: ['me', 'peer'], ...extra } as unknown as DialogSummary)
const direct = dialog('d', 'direct', 3), group = dialog('g', 'group', 2), mutedDirect = dialog('md', 'direct', 4, { muted: true })
const mark = dialog('k', 'direct', 0, { markedUnread: true })
const prefs = (badgeIncludeMuted: boolean, notifyPersonal: boolean, notifyGroup: boolean, badgeMode: 'messages' | 'chats' = 'messages') =>
  ({ showUnreadBadge: true, badgeMode, badgeIncludeMuted, notifyPersonal, notifyGroup })
const me = (dialogs: DialogSummary[]) => [{ uid: 'me', dialogs }]

test('a chat is muted by its own switch or by its kind\'s', () => {
  const rows: [Pick<DialogSummary, 'muted' | 'kind'>, { notifyPersonal?: boolean; notifyGroup?: boolean }, boolean][] = [
    [{ muted: false, kind: 'direct' }, {}, false],
    [{ muted: false, kind: 'direct' }, { notifyPersonal: true, notifyGroup: false }, false],
    [{ muted: false, kind: 'direct' }, { notifyPersonal: false, notifyGroup: true }, true],
    [{ muted: false, kind: 'secret' }, { notifyPersonal: false }, true],
    [{ muted: false, kind: 'group' }, { notifyPersonal: false, notifyGroup: true }, false],
    [{ muted: false, kind: 'group' }, { notifyPersonal: true, notifyGroup: false }, true],
    [{ muted: true, kind: 'direct' }, { notifyPersonal: true, notifyGroup: true }, true],
    [{ muted: true, kind: 'group' }, {}, true]
  ]
  for (const [chat, categories, expected] of rows) assert.equal(badgeMuted(chat, categories), expected, JSON.stringify([chat, categories]))
})

test('both kinds on, the count is what it was', () => {
  assert.equal(defaultPreferences.notifyPersonal, true)
  assert.equal(defaultPreferences.notifyGroup, true)
  assert.deepEqual(appBadgeState(prefs(true, true, true), me([direct, group, mutedDirect]), true), { count: 9, muted: false })
  assert.deepEqual(appBadgeState(prefs(false, true, true), me([direct, group, mutedDirect]), true), { count: 5, muted: false })
})

test('«알림 끈 대화 포함» on: a chat of a kind that is off still counts, and grey when nothing else is loud', () => {
  const table: [boolean, boolean, DialogSummary[], { count: number; muted: boolean }][] = [
    [false, true, [direct, group], { count: 5, muted: false }],
    [false, true, [direct], { count: 3, muted: true }],
    [true, false, [group], { count: 2, muted: true }],
    [false, false, [direct, group], { count: 5, muted: true }],
    [false, true, [direct, mark], { count: 4, muted: true }],
    [true, false, [direct, group, mutedDirect], { count: 9, muted: false }]
  ]
  for (const [personal, groups, dialogs, expected] of table)
    assert.deepEqual(appBadgeState(prefs(true, personal, groups), me(dialogs), true), expected, JSON.stringify([personal, groups, dialogs.map(d => d.id)]))
})

test('«알림 끈 대화 포함» off: a chat of a kind that is off adds nothing, its mark neither, in either count', () => {
  const table: [boolean, boolean, 'messages' | 'chats', DialogSummary[], { count: number; muted: boolean }][] = [
    [false, true, 'messages', [direct, group], { count: 2, muted: false }],
    [true, false, 'messages', [direct, group], { count: 3, muted: false }],
    [false, false, 'messages', [direct, group], { count: 0, muted: false }],
    [false, true, 'messages', [direct, mark, group], { count: 2, muted: false }],
    [false, true, 'chats', [direct, mark, group], { count: 1, muted: false }],
    [true, false, 'chats', [direct, mark, group, mutedDirect], { count: 2, muted: false }]
  ]
  for (const [personal, groups, mode, dialogs, expected] of table)
    assert.deepEqual(appBadgeState(prefs(false, personal, groups, mode), me(dialogs), true), expected, JSON.stringify([personal, groups, mode, dialogs.map(d => d.id)]))
})

test('the accounts list counts the same way, and left out the switches count as on', () => {
  assert.deepEqual(accountBadgeState('me', [direct, group], 'messages', false, { notifyPersonal: false, notifyGroup: true }), { count: 2, muted: false })
  assert.deepEqual(accountBadgeState('me', [direct, group], 'messages', true, { notifyPersonal: false, notifyGroup: true }), { count: 5, muted: false })
  assert.deepEqual(accountBadgeState('me', [direct, group], 'messages', true, { notifyPersonal: false, notifyGroup: false }), { count: 5, muted: true })
  assert.deepEqual(accountBadgeState('me', [direct, group], 'messages', false), { count: 5, muted: false })
})
