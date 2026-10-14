import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { closeToTrayEffective, migrateCloseToTray } from '../../src/shared/close-to-tray'
import { SettingsStore } from '../../src/main/platform/settings'
import { activeForTrayClick, DesktopShell, type TrayLike, type TrayWindow } from '../../src/main/platform/desktop-shell'
import { defaultPreferences, type Preferences } from '../../src/shared/model'
import { preferencePatch } from '../../src/shared/validation'

// B374 (reports/desktop/2026-10-14-0.241.30-plan.md, review 10-14 07:3x): on Windows a closed window keeps Morse running
// in the notification area, as tdesktop's default WorkMode::WindowAndTray does (core_settings.h:1170, main_window.cpp:491-504,
// v7.3.1 6fed91ff); a tray click shows or hides it (tray.cpp:67-77); the first time, one balloon says so (tray_win.cpp:268-280).
test('what closing does: Windows goes to the tray until the person chooses; macOS is not this setting', () => {
  assert.deepEqual([null, true, false].map(choice => closeToTrayEffective({ closeToTrayChoice: choice }, 'win32')), [true, true, false])
  assert.deepEqual([null, true, false].map(choice => closeToTrayEffective({ closeToTrayChoice: choice }, 'darwin')), [false, false, false])
  assert.equal(defaultPreferences.closeToTrayChoice, null)
  assert.deepEqual(preferencePatch({ closeToTrayChoice: null }), { closeToTrayChoice: null })
  assert.throws(() => preferencePatch({ closeToTrayChoice: 'yes' }))
  assert.throws(() => preferencePatch({ closeToTray: true }), 'the old key is no longer a setting')
})

test('a settings file from 0.241.29 or before: one turned on stays on, anything else is «not chosen»', () => {
  assert.deepEqual(migrateCloseToTray({ closeToTray: true, theme: 'dark' }), { closeToTrayChoice: true, theme: 'dark' })
  assert.deepEqual(migrateCloseToTray({ closeToTray: false, theme: 'dark' }), { theme: 'dark' }, 'false was written with every change: it cannot be told from the default')
  assert.deepEqual(migrateCloseToTray({ theme: 'dark' }), { theme: 'dark' })
  assert.deepEqual(migrateCloseToTray({ closeToTrayChoice: false, closeToTray: true }), { closeToTrayChoice: false, closeToTray: true }, 'a file of this version is read as it is')
})

async function stored(preferences: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'morse-b374-'))
  await writeFile(join(dir, 'preferences.json'), JSON.stringify({ version: 1, preferences, ...extra }))
  const store = new SettingsStore(dir); await store.load()
  return { store, dir, done: () => rm(dir, { recursive: true, force: true }) }
}

test('the store moves an old file over once, keeps the balloon as seen, and writes no old key again', async () => {
  const on = await stored({ closeToTray: true }), off = await stored({ closeToTray: false, enterToSend: false }), none = await stored({})
  try {
    assert.equal(on.store.preferences.closeToTrayChoice, true)
    assert.equal(off.store.preferences.closeToTrayChoice, null)
    assert.equal(off.store.preferences.enterToSend, false, 'the rest of the file as it was')
    assert.equal(none.store.preferences.closeToTrayChoice, null)
    assert.equal(off.store.trayHintSeen, false)
    await off.store.update({ closeToTrayChoice: false })
    await off.store.markTrayHintSeen()
    const written = JSON.parse(await readFile(join(off.dir, 'preferences.json'), 'utf8'))
    assert.equal(written.preferences.closeToTrayChoice, false)
    assert.equal('closeToTray' in written.preferences, false)
    assert.equal(written.trayHintSeen, true)
    const again = new SettingsStore(off.dir); await again.load()
    assert.equal(again.preferences.closeToTrayChoice, false, 'a choice made in this version is kept')
    assert.equal(again.trayHintSeen, true)
  } finally { await on.done(); await off.done(); await none.done() }
})

function windowsShell(platform: NodeJS.Platform = 'win32', trayMade = true) {
  let now = 1000, shown = 0, hidden = 0, active = false
  const balloons: unknown[] = []
  const fake = { setImage: () => {}, setToolTip: () => {}, setContextMenu: () => {}, destroy: () => {}, isDestroyed: () => false,
    on: (_: string, listener: () => void) => { clicks.push(listener); return fake }, displayBalloon: (options: unknown) => balloons.push(options) } as unknown as TrayLike
  const clicks: (() => void)[] = []
  const window: TrayWindow = { active: () => active, hide: () => { hidden++; active = false } }
  const shell = new DesktopShell(() => { shown++; active = true }, () => {}, () => null, () => {}, platform, () => now,
    () => { if (!trayMade) throw new Error('no tray'); return fake }, window)
  shell.initialize()
  return { shell, balloons, click: () => clicks.forEach(listener => listener()), tick: (ms: number) => { now += ms },
    counts: () => ({ shown, hidden }), setActive: (value: boolean) => { active = value } }
}
const prefs = (closeToTrayChoice: boolean | null) => ({ ...defaultPreferences, closeToTrayChoice }) as Preferences

test('the shell closes to the tray by the one rule, and only when there is a tray', () => {
  const windows = windowsShell()
  assert.deepEqual([null, true, false].map(choice => windows.shell.canCloseToTray(prefs(choice))), [true, true, false])
  assert.equal(windowsShell('win32', false).shell.canCloseToTray(prefs(null)), false, 'no tray: closing quits, as before')
  assert.equal(windowsShell('darwin').shell.canCloseToTray(prefs(null)), false)
})

test('a tray click shows a hidden window and hides an active one; the second click of a double-click does nothing', () => {
  const { click, tick, counts, setActive } = windowsShell()
  click(); assert.deepEqual(counts(), { shown: 1, hidden: 0 })
  tick(200); click(); assert.deepEqual(counts(), { shown: 1, hidden: 0 }, 'within the double-click time')
  tick(600); click(); assert.deepEqual(counts(), { shown: 1, hidden: 1 }, 'shown and active: hidden')
  tick(600); setActive(false); click(); assert.deepEqual(counts(), { shown: 2, hidden: 1 })
})

test('active for a tray click: shown, and focused or focus lost within half a second', () => {
  assert.equal(activeForTrayClick(true, true, 0, 5000), true)
  assert.equal(activeForTrayClick(true, false, 4600, 5000), true, 'the tray took the focus just before the click')
  assert.equal(activeForTrayClick(true, false, 4000, 5000), false)
  assert.equal(activeForTrayClick(true, false, 0, 5000), false)
  assert.equal(activeForTrayClick(false, true, 0, 5000), false)
})

test('the balloon: Windows with a tray shows it; the caller keeps that it was shown, and the close path goes through one place', () => {
  const windows = windowsShell()
  assert.equal(windows.shell.showTrayHint(), true)
  assert.deepEqual(windows.balloons.map(b => (b as { title: string }).title), ['Morse'])
  assert.match((windows.balloons[0] as { content: string }).content, /계속 실행 중/)
  assert.equal(windowsShell('darwin').shell.showTrayHint(), false)
  assert.equal(windowsShell('win32', false).shell.showTrayHint(), false)
  const main = readFileSync('src/main/index.ts', 'utf8')
  assert.match(main, /desktopShell\.canCloseToTray\(settings\.preferences\)\) hideToTray\(window\)\n\s+else app\.quit\(\)/)
  assert.match(main, /function hideToTray\(window: BrowserWindow\): void \{\n\s+void windowState\.save\(\); window\.hide\(\)\n\s+if \(!settings\.trayHintSeen && desktopShell\.showTrayHint\(\)\) void settings\.markTrayHintSeen\(\)/)
  assert.match(main, /window\.on\('blur', \(\) => \{ windowBlurredAt = Date\.now\(\) \}\)/)
})
