import assert from 'node:assert/strict'
import { test } from 'node:test'
import { appSmallCounterLayer } from '../../src/shared/app-badge'
import { DesktopShell, type OverlayDrawRequest, type TrayLike } from '../../src/main/platform/desktop-shell'
import type { DialogSummary, Preferences } from '../../src/shared/model'

// B348b (reports/desktop/2026-10-14-b348b-tray-small-icon-plan.md, review 10-14 01:0x): the Windows tray icon carries the
// count as tdesktop's does — Tray::updateIcon (tray_win.cpp:209-233) → WithSmallCounter (window/main_window.cpp:350-391),
// tooltip «AppName (n)» (tray.cpp:22-27); the same count and grey as the overlay. The small window icon is left (B348c).
test('the small counter: the number below 100, «..N» from 100 on; half-size font, padding and corners by length', () => {
  const row = (size: number, count: number) => { const l = appSmallCounterLayer(size, count); return [l.text, l.font, l.delta, l.radius] }
  assert.deepEqual([row(16, 7), row(16, 42), row(16, 99), row(16, 100), row(16, 105)], [['7', 8, 2, 4], ['42', 8, 1, 3], ['99', 8, 1, 3], ['..0', 8, 1, 3], ['..5', 8, 1, 3]])
  assert.deepEqual([row(32, 7), row(32, 42), row(24, 7), row(20, 42)], [['7', 16, 4, 8], ['42', 16, 2, 6], ['7', 12, 3, 6], ['42', 10, 1, 4]])
})

const dialog = (unreadCount: number, muted = false) => ({ id: 'c', kind: 'direct', unreadCount, markedUnread: false, muted, archived: false, service: false, participantUids: ['me', 'p'] } as unknown as DialogSummary)
const prefs = { showUnreadBadge: true, badgeMode: 'messages' } as Preferences
function windowsShell() {
  const requests: OverlayDrawRequest[] = [], overlays: unknown[] = [], tray = { images: [] as string[], tooltips: [] as string[] }
  let now = 0
  const fake = { setImage: (image: { url: string }) => tray.images.push(image.url), setToolTip: (text: string) => tray.tooltips.push(text),
    setContextMenu: () => {}, on: () => fake, destroy: () => {}, isDestroyed: () => false } as unknown as TrayLike
  const shell = new DesktopShell(() => {}, () => {}, () => ({ setOverlayIcon: (image, description) => overlays.push([image ? (image as unknown as { url: string }).url : null, description]), scaleFactor: () => 1 }),
    request => requests.push(request), 'win32', () => now, () => fake)
  shell.initialize()
  return { shell, requests, overlays, tray, tick: (ms: number) => { now += ms } }
}

test('Windows: a count asks for the tray picture beside the overlay, the tray shows it with «Morse (n)», none brings the logo back', () => {
  const { shell, requests, overlays, tray, tick } = windowsShell()
  assert.deepEqual(tray.tooltips, ['Morse'])
  shell.update(prefs, [{ uid: 'me', dialogs: [dialog(3)] }], true)
  assert.deepEqual(requests.map(r => [r.target, r.count, r.muted, r.pixels]), [['taskbar', 3, false, 16], ['tray', 3, false, 16]])
  assert.deepEqual(tray.tooltips.at(-1), 'Morse (3)')
  const trayKey = requests.find(r => r.target === 'tray')!.key, taskbarKey = requests.find(r => r.target === 'taskbar')!.key
  assert.notEqual(trayKey, taskbarKey)
  shell.overlayDrawn(trayKey, 'data:image/png;base64,TRAY')
  shell.overlayDrawn(taskbarKey, 'data:image/png;base64,BAR')
  assert.deepEqual([tray.images, overlays], [['data:image/png;base64,TRAY'], [['data:image/png;base64,BAR', '읽지 않은 메시지 3개']]])
  tick(5000); shell.update(prefs, [{ uid: 'me', dialogs: [dialog(3)] }], true)
  assert.equal(requests.length, 2, 'drawn: not asked again')
  shell.update(prefs, [{ uid: 'me', dialogs: [dialog(3, true)] }], true)
  assert.deepEqual(requests.slice(2).map(r => [r.target, r.muted]), [['taskbar', true], ['tray', true]], 'grey on both, the one muted rule')
  shell.update(prefs, [{ uid: 'me', dialogs: [dialog(0)] }], true)
  shell.update(prefs, [{ uid: 'me', dialogs: [dialog(0)] }], true)
  assert.deepEqual([tray.images.at(-1), tray.tooltips.at(-1)], ['file:' + process.cwd() + '/resources/brand/morse.png', 'Morse'], 'the logo alone, once')
  assert.equal(tray.images.filter(url => url.startsWith('file:')).length, 1)
})

test('macOS makes no tray', () => {
  let made = 0
  const mac = new DesktopShell(() => {}, () => {}, () => null, () => {}, 'darwin', Date.now, () => { made++; return null as never })
  mac.initialize()
  assert.equal(made, 0)
})
