import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { app } from 'electron'
import { alerting, notificationAlerts, toggledNotifications } from '../../src/shared/notification-alerts'
import { defaultPreferences, type Preferences } from '../../src/shared/model'
import { preferencePatch } from '../../src/shared/validation'
import { DesktopShell, type TrayLike } from '../../src/main/platform/desktop-shell'
import { SettingsStore } from '../../src/main/platform/settings'
import { autostartArgument, autostartSkipped, launchedAtLogin, startHidden, toggleAutostart, type LaunchState, type LoginItems } from '../../src/main/platform/autostart'
import { InquiryNotifications, type InquiryNotice } from '../../src/main/accounts/inquiry-notifications'

// B378 (reports/desktop/2026-10-30-b378-plan.md §3-1·§3-2, tdesktop 2de685f/5ff6157): ① the notifications line of the
// tray (Windows) and the Dock menu (Mac), ② a taskbar flash or Dock bounce for a new message, ③ start with Windows.
const prefs = (patch: Partial<Preferences> = {}): Preferences => ({ ...defaultPreferences, ...patch })

test('the flash is on by default and apart from notifications; both, either or neither look at a message', () => {
  assert.equal(defaultPreferences.flashOnNotification, true, 'core_settings.h:1092 _flashBounceNotify = true')
  assert.deepEqual([defaultPreferences.autoStart, defaultPreferences.startMinimized], [false, false])
  assert.deepEqual(preferencePatch({ flashOnNotification: false, autoStart: true, startMinimized: true }), { flashOnNotification: false, autoStart: true, startMinimized: true })
  assert.deepEqual(notificationAlerts(prefs({ notifications: false })), { show: false, flash: true })
  assert.equal(alerting(prefs({ notifications: false })), true)
  assert.equal(alerting(prefs({ notifications: false, flashOnNotification: false })), false)
})

test('the tray line turns the flash off with the notifications and gives it back with them; the Dock line flips notifications alone', () => {
  const off = toggledNotifications(prefs(), false, 'tray')
  assert.deepEqual(off, { update: { notifications: false, flashOnNotification: false }, flashRemembered: true })
  assert.deepEqual(toggledNotifications(prefs({ notifications: false, flashOnNotification: false }), true, 'tray'), { update: { notifications: true, flashOnNotification: true }, flashRemembered: false })
  assert.deepEqual(toggledNotifications(prefs({ flashOnNotification: false }), true, 'tray'), { update: { notifications: false }, flashRemembered: false }, 'a flash already off is not remembered')
  assert.deepEqual(toggledNotifications(prefs({ notifications: false }), false, 'tray'), { update: { notifications: true }, flashRemembered: false })
  assert.deepEqual(toggledNotifications(prefs(), true, 'dock'), { update: { notifications: false }, flashRemembered: true })
})

test('the remembered flash is kept with the settings file and goes with the tray line\'s one write', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'b378-'))
  try {
    const store = new SettingsStore(directory)
    await store.load()
    await store.updateFromTray({ notifications: false, flashOnNotification: false }, true)
    const again = new SettingsStore(directory); await again.load()
    assert.deepEqual([again.preferences.notifications, again.preferences.flashOnNotification, again.trayFlashRemembered], [false, false, true])
    await again.updateFromTray({ notifications: true, flashOnNotification: true }, false)
    const third = new SettingsStore(directory); await third.load()
    assert.equal(third.trayFlashRemembered, false)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

type Item = { label?: string; type?: string; click?: () => void }
function windowsShell() {
  const menus: Item[][] = [], toggles: string[] = [], flashes: boolean[] = []
  let focused = false
  const tray = { setImage: () => {}, setToolTip: () => {}, setContextMenu: (menu: unknown) => menus.push(menu as Item[]), destroy: () => {}, isDestroyed: () => false,
    on: () => tray, displayBalloon: () => {} } as unknown as TrayLike
  const window = { setOverlayIcon: () => {}, scaleFactor: () => 1, setTitle: () => {}, focused: () => focused, flash: (on: boolean) => { flashes.push(on) } }
  const shell = new DesktopShell(() => {}, () => {}, () => window, () => {}, 'win32', Date.now, () => tray, undefined, () => {}, from => toggles.push(from))
  shell.initialize()
  return { shell, menus, toggles, flashes, setFocused: (value: boolean) => { focused = value } }
}
const labels = (menu: Item[]) => menu.map(item => item.type === 'separator' ? '—' : item.label)

test('the tray menu: open, the notifications line unless the local passcode is locked, quit (tray.cpp:80-112)', () => {
  const { shell, menus, toggles } = windowsShell()
  assert.deepEqual(labels(menus.at(-1)!), ['Morse 열기', '데스크톱 알림 끄기', '—', 'Morse 종료'])
  shell.update(prefs({ notifications: false }), [], true)
  assert.deepEqual(labels(menus.at(-1)!), ['Morse 열기', '데스크톱 알림 켜기', '—', 'Morse 종료'])
  menus.at(-1)!.find(item => item.label === '데스크톱 알림 켜기')!.click!()
  assert.deepEqual(toggles, ['tray'])
  const made = menus.length
  shell.update(prefs({ notifications: false }), [], true)
  assert.equal(menus.length, made, 'the same state makes no new menu')
  shell.update(prefs({ notifications: false }), [], false, true)
  assert.deepEqual(labels(menus.at(-1)!), ['Morse 열기', '—', 'Morse 종료'])
})

test('the Dock menu keeps its notifications line while locked (menu_dock.cpp:32, :53-60)', () => {
  const dock = { menus: [] as Item[][], bounces: [] as string[], cancelled: [] as number[], setBadge: () => {}, setMenu(menu: unknown) { this.menus.push(menu as Item[]) },
    bounce(kind: string) { this.bounces.push(kind); return 7 }, cancelBounce(id: number) { this.cancelled.push(id) } }
  const target = app as unknown as { dock?: typeof dock }
  target.dock = dock
  try {
    const toggles: string[] = []
    let focused = false
    const shell = new DesktopShell(() => {}, () => {}, () => ({ setOverlayIcon: () => {}, scaleFactor: () => 1, setTitle: () => {}, focused: () => focused }), () => {}, 'darwin', Date.now,
      undefined, undefined, () => {}, from => toggles.push(from))
    shell.initialize()
    assert.deepEqual(labels(dock.menus.at(-1)!), ['데스크톱 알림 끄기', '—', 'Morse 열기'])
    shell.update(prefs(), [], false, true)
    assert.deepEqual(labels(dock.menus.at(-1)!), ['데스크톱 알림 끄기', '—', 'Morse 열기'])
    dock.menus.at(-1)![0]!.click!()
    assert.deepEqual(toggles, ['dock'])
    // ② a Mac bounces the Dock icon once, informational, for a second; a window in front is not alerted.
    shell.alert(); shell.alert()
    assert.deepEqual(dock.bounces, ['informational'], 'one bounce at a time')
    shell.windowFocused()
    assert.deepEqual(dock.cancelled, [7])
    focused = true; shell.alert()
    assert.equal(dock.bounces.length, 1)
    shell.close()
  } finally { delete target.dock }
})

test('Windows flashes the taskbar button for a window not in front, until it comes in front', () => {
  const { shell, flashes, setFocused } = windowsShell()
  setFocused(true); shell.alert()
  assert.deepEqual(flashes, [])
  setFocused(false); shell.alert()
  assert.deepEqual(flashes, [true])
  shell.windowFocused()
  assert.deepEqual(flashes, [true, false])
})

test('an inquiry flashes by its own switch and shows by the notifications\' (notifications_manager.cpp:753-789)', () => {
  const run = (patch: Partial<Preferences>, foreground = false) => {
    const shown: string[] = [], alerts: number[] = []
    let now = 1000
    const notices = new InquiryNotifications({ preferences: () => prefs(patch), locked: () => false, appActive: () => false, foreground: () => foreground,
      show: content => { shown.push(content.chatId); return () => {} }, alert: () => alerts.push(1), open: () => {} }, () => now)
    const room = (at: number): InquiryNotice => ({ inquiryId: 'q1', channelId: 'c1', title: 'test', preview: 'hi', at, unread: 1, fromMe: false })
    notices.observe([room(500)]); now = 2000; notices.observe([room(1500)])
    return { shown: shown.length, alerts: alerts.length }
  }
  assert.deepEqual(run({}), { shown: 1, alerts: 1 })
  assert.deepEqual(run({ notifications: false }), { shown: 0, alerts: 1 })
  assert.deepEqual(run({ flashOnNotification: false }), { shown: 1, alerts: 0 })
  assert.deepEqual(run({ notifications: false, flashOnNotification: false }), { shown: 0, alerts: 0 })
  assert.deepEqual(run({}, true), { shown: 0, alerts: 0 }, 'the room being read alerts nothing')
})

test('a chat\'s message: the flash before the toast, and a shown toast goes when the notifications go (notifications.ts)', () => {
  const source = readFileSync('src/main/messaging/notifications.ts', 'utf8')
  assert.match(source, /if \(alerts\.flash\) this\.host\.alert\?\.\(\)\n\s*if \(!alerts\.show\) return\n\s*this\.remove\(hint\.chatId, 'replaced'\)/)
  assert.equal((source.match(/alerting\(this\.host\.preferences\(\)\)/g) ?? []).length, 2, 'receive and active look while either is on')
  assert.match(source, /!notificationAlerts\(this\.host\.preferences\(\)\)\.show\) \{ this\.remove\(chatId, `resume:\$\{cause\}:inactive`\)/)
})

test('start with Windows: the login item carries the argument and is read back; a start the setting no longer wants ends', () => {
  const calls: unknown[] = []
  let open = false
  const items = { setLoginItemSettings: (settings: { openAtLogin: boolean }) => { calls.push(settings); open = settings.openAtLogin }, getLoginItemSettings: () => ({ openAtLogin: open }) } as unknown as LoginItems
  assert.equal(toggleAutostart(true, items), true)
  assert.deepEqual(calls, [{ openAtLogin: true, args: [autostartArgument] }])
  assert.equal(toggleAutostart(false, items), false)
  assert.equal(toggleAutostart(true, { setLoginItemSettings: () => { throw new Error('denied') }, getLoginItemSettings: () => ({ openAtLogin: false }) } as unknown as LoginItems), false)
  assert.equal(launchedAtLogin(['Morse.exe', '--autostart']), true)
  const state = (patch: Partial<LaunchState>): LaunchState => ({ platform: 'win32', atLogin: true, autoStart: true, startMinimized: true, passcodeLocked: false, trayAvailable: true, ...patch })
  assert.equal(autostartSkipped(state({ autoStart: false })), true)
  assert.equal(autostartSkipped(state({})), false)
  assert.equal(autostartSkipped(state({ platform: 'darwin', autoStart: false })), false)
  assert.equal(startHidden(state({})), true)
  for (const patch of [{ atLogin: false }, { startMinimized: false }, { passcodeLocked: true }, { trayAvailable: false }, { platform: 'darwin' as const }]) assert.equal(startHidden(state(patch)), false, JSON.stringify(patch))
})

test('index.ts: the menus\' line, the refusals and the hidden first window', () => {
  const index = readFileSync('src/main/index.ts', 'utf8')
  assert.match(index, /if \(update\.startMinimized === true && appLock\?\.enabled\) throw/)
  assert.match(index, /if \(!enabled\) update\.startMinimized = false/)
  assert.match(index, /'notifications' in update \|\| 'flashOnNotification' in update/)
  assert.match(index, /if \(autostartSkipped\(launch\)\) \{ toggleAutostart\(false\); app\.exit\(0\); return \}/)
  assert.match(index, /const hidden = startedHidden; startedHidden = false; if \(shutdown === 'running' && !hidden\) windowState\.show\(\)/)
  assert.match(index, /window\.on\('focus', \(\) => desktopShell\.windowFocused\(\)\)/)
  assert.match(index, /alert: \(\) => desktopShell\.alert\(\)/)
  assert.match(index, /Boolean\(appLock\?\.locked\)\)\n\}/)
})
