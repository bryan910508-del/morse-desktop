import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { DesktopShell, type OverlayDrawRequest, type TrayLike } from '../../src/main/platform/desktop-shell'
import { badgeLine, type BadgeDetail } from '../../src/main/platform/badge-diagnostics'
import type { DialogSummary, Preferences } from '../../src/shared/model'

// B348 (review 10-14 17:4x): on a person's Windows PC the taskbar and tray count never showed. badge-check.log writes
// every step the count takes — numbers and fixed words only — so one file from that PC tells where it stops.
const dialog = (unreadCount: number) => ({ id: 'c', kind: 'direct', unreadCount, markedUnread: false, muted: false, archived: false, service: false, participantUids: ['me', 'p'] } as unknown as DialogSummary)
const prefs = { showUnreadBadge: true, badgeMode: 'messages' } as Preferences
function shell(withWindow = true) {
  const steps: [string, BadgeDetail][] = [], requests: OverlayDrawRequest[] = []
  const fake = { setImage: () => {}, setToolTip: () => {}, setContextMenu: () => {}, on: () => fake, destroy: () => {}, isDestroyed: () => false } as unknown as TrayLike
  const desktop = new DesktopShell(() => {}, () => {}, () => withWindow ? { setOverlayIcon: () => {}, scaleFactor: () => 1 } : null, request => requests.push(request),
    'win32', () => 0, () => fake, undefined, (step, detail) => steps.push([step, detail]))
  desktop.initialize()
  return { desktop, steps, requests }
}

test('each step is written: the tray, the count, the request, the picture, what the system took', () => {
  const { desktop, steps, requests } = shell()
  desktop.update(prefs, [{ uid: 'me', dialogs: [dialog(3)] }], true)
  const taskbar = requests.find(r => r.target === 'taskbar')!, tray = requests.find(r => r.target === 'tray')!
  desktop.overlayDrawn(taskbar.key, 'data:image/png;base64,AAAA')
  desktop.overlayFailed(tray.key, 'EncodingError')
  const names = steps.map(([step]) => step)
  assert.deepEqual(names.slice(0, 2), ['tray', 'update'])
  assert.deepEqual(steps[0]![1], { made: true, pixels: 32 })
  assert.deepEqual(steps[1]![1], { count: 3, muted: false, available: true, shown: true, accounts: 1 })
  assert.ok(steps.some(([step, detail]) => step === 'tooltip' && detail.count === 3 && detail.result === 'ok'))
  assert.ok(steps.some(([step, detail]) => step === 'request' && detail.target === 'taskbar' && detail.count === 3))
  assert.ok(steps.some(([step, detail]) => step === 'drawn' && detail.target === 'taskbar' && detail.result === 'ok'))
  assert.ok(steps.some(([step, detail]) => step === 'apply' && detail.target === 'taskbar' && detail.result === 'ok'))
  assert.ok(steps.some(([step, detail]) => step === 'drawn' && detail.target === 'tray' && detail.result === 'failed' && detail.name === 'EncodingError'), 'a failed picture is written, not dropped')
  // Nothing but numbers, booleans and fixed words.
  for (const [, detail] of steps) for (const value of Object.values(detail)) assert.ok(typeof value !== 'string' || /^[a-z0-9-]{0,40}$/i.test(value), String(value))
})

test('no count, no window and an unavailable count are written as such', () => {
  const none = shell(false)
  none.desktop.update(prefs, [{ uid: 'me', dialogs: [dialog(2)] }], true)
  assert.ok(none.steps.some(([step, detail]) => step === 'request' && detail.result === 'no-window'))
  const locked = shell()
  locked.desktop.update(prefs, [{ uid: 'me', dialogs: [dialog(2)] }], false)
  assert.deepEqual(locked.steps.find(([step]) => step === 'update')![1], { count: 0, muted: false, available: false, shown: true, accounts: 1 })
})

test('a line that repeats its step\'s last line is not written again', () => {
  assert.notEqual(badgeLine('t-step', { count: 1 }), null)
  assert.equal(badgeLine('t-step', { count: 1 }), null)
  assert.notEqual(badgeLine('t-step', { count: 2 }), null)
})

test('the window reports a picture it could not draw, and main writes which accounts the count saw', () => {
  const renderer = readFileSync('src/renderer/src/main.tsx', 'utf8'), main = readFileSync('src/main/index.ts', 'utf8')
  assert.match(renderer, /reason => window\.morse\.appBadgeFailed\(event\.key, reason instanceof Error \? reason\.name : typeof reason\)/)
  assert.match(main, /handle\('app-badge-failed'/)
  assert.match(main, /recordBadgeStep\('accounts', \{ all: accounts\.all\.length, states: accounts\.all\.map\(session => `\$\{session\.state\}\/\$\{session\.readStatus\}`\)/)
})

// Windows PC 10-14 17:3x: the tray tooltip said «Morse» with unread messages — the count was 0. Both counts took only
// accounts whose socket was «ready»; a chat list on screen counts whatever the socket does (tdesktop counts the chats it
// has, main_domain.cpp:302-314).
test('the badge and the accounts list count every account whose chat list is here, socket or not', () => {
  const main = readFileSync('src/main/index.ts', 'utf8')
  assert.match(main, /function countsInBadge\(session: \{ readStatus: string \}\): boolean \{ return session\.readStatus === 'ready' \}/)
  assert.match(main, /desktopShell\.update\(settings\.preferences, accounts\.all\.filter\(countsInBadge\)/)
  assert.match(main, /const badge = session && countsInBadge\(session\) \? accountBadgeState\(/)
  assert.doesNotMatch(main, /session\.state === 'ready' && session\.readStatus === 'ready'/)
})
