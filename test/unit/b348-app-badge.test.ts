import assert from 'node:assert/strict'
import { test } from 'node:test'
import { app } from 'electron'
import { appBadgeBox, appBadgeFontHeight, appBadgeLayer, appBadgePixels, appBadgeState, dockBadgeText } from '../../src/shared/app-badge'
import { DesktopShell, type OverlayDrawRequest } from '../../src/main/platform/desktop-shell'
import type { DialogSummary, Preferences } from '../../src/shared/model'

// B348 (reports/desktop/2026-10-13-b348-taskbar-badge-plan.md, review 10-13 20:2x): the Dock and the Windows taskbar
// show one count, tdesktop's (data_session.cpp:3716-3733, main_domain.cpp:302-314, core_settings.h:1103 — v7.3.1
// 6fed91ff), and Windows draws it as an overlay the way updateTaskbarAndIconCounters does (main_window_win.cpp:645-660).
const dialog = (id: string, unreadCount: number, extra: Partial<DialogSummary> = {}): DialogSummary =>
  ({ id, kind: 'direct', unreadCount, markedUnread: false, muted: false, archived: false, service: false, participantUids: ['me', 'peer'], ...extra } as unknown as DialogSummary)
const on = { showUnreadBadge: true, badgeMode: 'messages' } as Pick<Preferences, 'showUnreadBadge' | 'badgeMode'>
const me = (dialogs: DialogSummary[]) => [{ uid: 'me', dialogs }]

test('one count: marks + messages over every account, muted chats too; grey only when all of it is muted', () => {
  assert.deepEqual(appBadgeState(on, me([dialog('a', 3), dialog('b', 2, { muted: true })]), true), { count: 5, muted: false }, 'includeMutedCounter = true by default')
  assert.deepEqual(appBadgeState(on, me([dialog('b', 2, { muted: true })]), true), { count: 2, muted: true }, 'computeUnreadBadgeMuted: everything counted is muted')
  assert.deepEqual(appBadgeState(on, me([dialog('m', 0, { markedUnread: true })]), true), { count: 1, muted: false }, 'a mark is one')
  assert.deepEqual(appBadgeState(on, me([dialog('m', 4, { markedUnread: true })]), true), { count: 4, muted: false }, 'not 5: a chat with a count is not a mark')
  assert.deepEqual(appBadgeState({ ...on, badgeMode: 'chats' }, me([dialog('a', 3), dialog('m', 0, { markedUnread: true })]), true), { count: 2, muted: false }, '«채팅 수»: marks + chats')
  assert.deepEqual(appBadgeState(on, [{ uid: 'me', dialogs: [dialog('a', 1, { muted: true })] }, { uid: 'two', dialogs: [dialog('x', 2, { participantUids: ['two', 'p'] })] }], true), { count: 3, muted: false }, 'every account, grey only if every account is (Domain::updateUnreadBadge)')
  assert.deepEqual(appBadgeState(on, me([dialog('r', 1, { archived: true }), dialog('s', 1, { kind: 'secret' } as Partial<DialogSummary>), dialog('n', 1, { service: true } as Partial<DialogSummary>), dialog('o', 1, { participantUids: ['a', 'b'] })]), true), { count: 0, muted: false }, 'archived, secret, the notice chat and a room this account is not in stay out, as before')
  assert.deepEqual(appBadgeState({ ...on, showUnreadBadge: false }, me([dialog('a', 3)]), true), { count: 0, muted: false })
  assert.deepEqual(appBadgeState(on, me([dialog('a', 3)]), false), { count: 0, muted: false }, 'locked or closing: nothing')
  assert.deepEqual(['', '1', '999', '999+'], [0, 1, 999, 1000].map(dockBadgeText), 'the Dock keeps «999+»')
})

test('the overlay picture follows GenerateCounterLayer: the size table, «..NN» from 1000, the box at the bottom right', () => {
  // window/main_window.cpp:287-318 — { font, delta, radius } for 1, 2 and 3+ characters.
  const row = (size: number, count: number) => { const l = appBadgeLayer(size, count); return [l.size, l.text, l.font, l.delta, l.radius] }
  assert.deepEqual([row(16, 7), row(16, 42), row(16, 512)], [[16, '7', 11, 5, 8], [16, '42', 11, 2, 7], [16, '512', 8, 1, 3]])
  assert.deepEqual([row(20, 7), row(20, 42), row(20, 512)], [[20, '7', 14, 6, 10], [20, '42', 13, 2, 9], [20, '512', 10, 1, 5]])
  assert.deepEqual([row(24, 7), row(24, 42), row(24, 512)], [[24, '7', 17, 7, 12], [24, '42', 16, 3, 11], [24, '512', 12, 1, 6]])
  assert.deepEqual([row(32, 7), row(32, 42), row(32, 512)], [[32, '7', 22, 9, 16], [32, '42', 20, 4, 14], [32, '512', 16, 2, 8]])
  assert.deepEqual([row(48, 7)], [[32, '7', 22, 9, 16]], 'any other size takes the switch\'s default row')
  assert.deepEqual([appBadgeLayer(16, 999).text, appBadgeLayer(16, 1000).text, appBadgeLayer(16, 1234).text, appBadgeLayer(16, 100005).text], ['999', '..00', '..34', '..05'], ':276-278')
  // :333-344 — box: (size - w - 2δ, size - h, w + 2δ, h), h = Open Sans's height for the size; text centred in it.
  assert.deepEqual([11, 14, 17, 22, 8].map(appBadgeFontHeight), [15, 19, 23, 30, 11])
  assert.deepEqual(appBadgeBox(appBadgeLayer(16, 7), 6.3, 10, 3), { x: 0, y: 1, width: 16, height: 15, textX: 4.85, textY: 12 }, 'one digit fills the 16 px picture, as Open Sans\'s does')
  assert.deepEqual(appBadgeBox(appBadgeLayer(16, 7), 7.03, 10, 3).width, 16, 'a wider font stays inside the picture')
  assert.deepEqual(appBadgeBox(appBadgeLayer(32, 42), 25.5, 19, 5), { x: 0, y: 5, width: 32, height: 27, textX: 3.25, textY: 25.5 }, 'two digits at 32 px: w + 2δ capped at the picture')
  // A small icon (SM_CXSMICON): 16 px at 100 %, from the table's sizes at the window's scale.
  assert.deepEqual([1, 1.25, 1.5, 1.75, 2, 3, 0, NaN].map(appBadgePixels), [16, 20, 24, 32, 32, 32, 16, 16])
})

function windowsShell() {
  const calls: [string | null, string][] = [], requests: OverlayDrawRequest[] = []
  let now = 0, scale = 1
  const shell = new DesktopShell(() => {}, () => {}, () => ({ setOverlayIcon: (image, description) => calls.push([image ? (image as unknown as { url: string }).url : null, description]), scaleFactor: () => scale }),
    request => requests.push(request), 'win32', () => now)
  return { shell, calls, requests, tick: (ms: number) => { now += ms }, setScale: (value: number) => { scale = value } }
}
const prefs = on as Preferences

test('Windows: a count asks the window to draw, the picture goes on the taskbar with its description, none takes it off', () => {
  const { shell, calls, requests, tick, setScale } = windowsShell()
  shell.update(prefs, me([dialog('a', 3)]), true)
  assert.deepEqual(requests.map(r => [r.count, r.muted, r.pixels]), [[3, false, 16]])
  assert.equal(calls.length, 0, 'nothing on the taskbar until the picture comes back')
  shell.update(prefs, me([dialog('a', 3)]), true)
  assert.equal(requests.length, 1, 'not asked again at once')
  tick(1200); shell.update(prefs, me([dialog('a', 3)]), true)
  assert.deepEqual(requests.map(r => r.key), [requests[0]!.key, requests[0]!.key], 'asked again a second later while undrawn')
  shell.overlayDrawn(requests[0]!.key, 'data:image/png;base64,AAA')
  assert.deepEqual(calls, [['data:image/png;base64,AAA', '읽지 않은 메시지 3개']])
  tick(5000); shell.update(prefs, me([dialog('a', 3)]), true)
  assert.equal(requests.length, 2, 'drawn: the same count is not drawn again')
  shell.update(prefs, me([dialog('a', 3, { muted: true })]), true)
  assert.deepEqual(requests.slice(2).map(r => [r.count, r.muted]), [[3, true]], 'grey is a new picture')
  shell.overlayDrawn(requests[0]!.key, 'data:image/png;base64,OLD')
  assert.equal(calls.length, 1, 'an older picture is dropped')
  setScale(1.5); shell.update(prefs, me([dialog('a', 3, { muted: true })]), true)
  assert.equal(requests.at(-1)!.pixels, 24, 'a window on a 150 % screen draws at 24 px')
  shell.update(prefs, me([dialog('a', 0)]), true)
  shell.update(prefs, me([dialog('a', 0)]), true)
  assert.deepEqual(calls.slice(1), [[null, '']], 'no count takes the overlay off, once')
  shell.overlayDrawn(requests.at(-1)!.key, 'data:image/png;base64,LATE')
  assert.equal(calls.length, 2, 'a picture for a count that is gone is dropped')
})

test('Windows: a reloaded window is drawn again, and closing takes the overlay off; macOS never touches it', () => {
  const { shell, calls, requests } = windowsShell()
  shell.update(prefs, me([dialog('a', 2)]), true)
  shell.overlayDrawn(requests[0]!.key, 'data:image/png;base64,AAA')
  shell.windowReset()
  shell.update(prefs, me([dialog('a', 2)]), true)
  assert.equal(requests.length, 2, 'a new page has no overlay')
  shell.close()
  assert.deepEqual(calls.at(-1), [null, ''])
  const badges: string[] = []
  ;(app as unknown as { dock: unknown }).dock = { setBadge: (text: string) => badges.push(text) }
  const overlays: unknown[] = [], draws: unknown[] = []
  const mac = new DesktopShell(() => {}, () => {}, () => ({ setOverlayIcon: (...args) => overlays.push(args), scaleFactor: () => 2 }), request => draws.push(request), 'darwin')
  mac.update(prefs, me([dialog('a', 2), dialog('b', 1, { muted: true })]), true)
  assert.deepEqual(badges, ['3'], 'the Dock now counts muted chats too')
  assert.deepEqual([overlays.length, draws.length], [0, 0])
})
