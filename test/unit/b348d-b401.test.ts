import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { countTitle, DesktopShell, type OverlayDrawRequest, type TrayLike } from '../../src/main/platform/desktop-shell'
import { readRecordAvailability, recordAvailabilityNow, recordAvailabilityOf, recordModeFor, recordTipAfterSwitch, showsRecordButton } from '../../src/renderer/src/history/record-availability'
import type { DialogSummary, Preferences } from '../../src/shared/model'

// B348d (reports/desktop/2026-10-14-b348d-b401-plan.md, review 10-14 20:2x): Electron sends the tray picture and tooltip
// apart and puts the icon back without its tooltip when Windows makes the taskbar again (Windows check 38553546580: Name
// '' after TaskbarCreated). tdesktop sends the tooltip after every picture (tray_win.cpp:231-232) and again on showFromTray
// and WM_SETTINGCHANGE; the window title carries the count too (main_window.cpp:887-917).
const dialog = (unreadCount: number, muted = false) => ({ id: 'c', kind: 'direct', unreadCount, markedUnread: false, muted, archived: false, service: false, participantUids: ['me', 'p'] } as unknown as DialogSummary)
const prefs = { showUnreadBadge: true, badgeMode: 'messages' } as Preferences
function shell(platform: NodeJS.Platform = 'win32') {
  const requests: OverlayDrawRequest[] = [], calls: string[] = [], titles: string[] = []
  let now = 0, windowOpen = true
  const fake = { setImage: (image: { url: string }) => calls.push(`image ${image.url.startsWith('file:') ? 'logo' : image.url.slice(-4)}`), setToolTip: (text: string) => calls.push(`tip ${text}`),
    setContextMenu: () => {}, on: () => fake, destroy: () => {}, isDestroyed: () => false } as unknown as TrayLike
  const desktop = new DesktopShell(() => {}, () => {}, () => windowOpen ? { setOverlayIcon: () => {}, scaleFactor: () => 1, setTitle: (title: string) => titles.push(title) } : null,
    request => requests.push(request), platform, () => now, () => fake)
  desktop.initialize()
  return { desktop, requests, calls, titles, tick: (ms: number) => { now += ms }, close: () => { windowOpen = false } }
}
const trayKey = (requests: OverlayDrawRequest[]) => requests.filter(r => r.target === 'tray').at(-1)!.key

test('B348d-1: every tray picture is followed by the tooltip, the same text again too', () => {
  const { desktop, requests, calls } = shell()
  assert.deepEqual(calls, ['tip Morse'])
  desktop.update(prefs, [{ uid: 'me', dialogs: [dialog(3)] }], true)
  desktop.overlayDrawn(trayKey(requests), 'data:image/png;base64,AAA3')
  // Muted: a new picture with the same number — the tooltip goes with it although its text is the same.
  desktop.update(prefs, [{ uid: 'me', dialogs: [dialog(3, true)] }], true)
  desktop.overlayDrawn(trayKey(requests), 'data:image/png;base64,MUT3')
  desktop.update(prefs, [{ uid: 'me', dialogs: [dialog(0)] }], true)
  assert.deepEqual(calls, ['tip Morse', 'tip Morse (3)', 'image AAA3', 'tip Morse (3)', 'image MUT3', 'tip Morse (3)', 'tip Morse', 'image logo', 'tip Morse'])
  assert.equal(countTitle(0), 'Morse'); assert.equal(countTitle(12), 'Morse (12)')
})

test('B348d-2: a refresh sends the pictures and the tooltip again (shown from the tray, theme or display changed)', () => {
  const { desktop, requests, calls } = shell()
  desktop.refresh()
  assert.deepEqual(calls, ['tip Morse'], 'nothing counted yet: nothing to send')
  desktop.update(prefs, [{ uid: 'me', dialogs: [dialog(5)] }], true)
  desktop.overlayDrawn(trayKey(requests), 'data:image/png;base64,AAA5')
  const asked = requests.length
  calls.length = 0
  desktop.refresh()
  assert.deepEqual(requests.slice(asked).map(r => [r.target, r.count]), [['taskbar', 5], ['tray', 5]], 'both pictures asked again')
  desktop.overlayDrawn(trayKey(requests), 'data:image/png;base64,AGN5')
  assert.deepEqual(calls, ['image AGN5', 'tip Morse (5)'])
  // With no count the logo and «Morse» go again, though they were the last ones sent.
  desktop.update(prefs, [{ uid: 'me', dialogs: [dialog(0)] }], true)
  calls.length = 0
  desktop.refresh()
  assert.deepEqual(calls, ['image logo', 'tip Morse'])
})

test('B348d-3: the window title is «Morse (n)» from the badge count, «Morse» with none or while locked, on both systems', () => {
  const { desktop, titles } = shell()
  desktop.update(prefs, [{ uid: 'me', dialogs: [dialog(2)] }], true)
  desktop.update(prefs, [{ uid: 'me', dialogs: [dialog(2)] }], true)
  desktop.update(prefs, [{ uid: 'me', dialogs: [dialog(2)] }], false)
  desktop.update(prefs, [{ uid: 'me', dialogs: [dialog(4)] }], true)
  assert.deepEqual(titles, ['Morse (2)', 'Morse', 'Morse (4)'])
  desktop.windowReset(); desktop.update(prefs, [{ uid: 'me', dialogs: [dialog(4)] }], true)
  assert.deepEqual(titles.at(-1), 'Morse (4)'); assert.equal(titles.length, 4, 'a new window is titled again')
  desktop.update({ ...prefs, showUnreadBadge: false }, [{ uid: 'me', dialogs: [dialog(4)] }], true)
  assert.equal(titles.at(-1), 'Morse', 'the badge turned off takes the number off the title too')
  const mac = shell('darwin')
  mac.desktop.update(prefs, [{ uid: 'me', dialogs: [dialog(7)] }], true)
  assert.deepEqual(mac.titles, ['Morse (7)'])
})

test('B348d: the window keeps the shell\'s title, and show, theme and display changes refresh', () => {
  const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
  assert.match(source, /window\.on\('page-title-updated', event => event\.preventDefault\(\)\)/)
  assert.match(source, /window\.on\('show', \(\) => desktopShell\.refresh\(\)\)/)
  assert.match(source, /screen\.on\('display-metrics-changed', \(\) => desktopShell\.refresh\(\)\)/)
  assert.match(source, /nativeTheme\.on\('updated', \(\) => \{[^}]*desktopShell\.refresh\(\)/)
  assert.match(source, /setTitle: title => window\.setTitle\(title\)/)
})

// B401: Webrtc::RecordAvailability and the three places tdesktop reads it (history_widget.cpp:1406-1422, 6110-6125,
// 6869-6872).
test('B401: what the computer can record, from the kinds of devices', () => {
  assert.equal(recordAvailabilityOf([]), 'none')
  assert.equal(recordAvailabilityOf([{ kind: 'videoinput' }, { kind: 'audiooutput' }]), 'none', 'a camera alone records nothing')
  assert.equal(recordAvailabilityOf([{ kind: 'audioinput' }, { kind: 'audiooutput' }]), 'audio')
  assert.equal(recordAvailabilityOf([{ kind: 'audioinput' }, { kind: 'videoinput' }]), 'videoAndAudio')
  assert.deepEqual(['none', 'audio', 'videoAndAudio'].map(a => showsRecordButton(a as never)), [false, true, true])
})

test('B401: the round button only with the choice and both devices; a click always turns the choice, and says what the button is now', () => {
  const rows = (['none', 'audio', 'videoAndAudio'] as const).flatMap(availability => [false, true].map(video => [availability, video, recordModeFor(video, availability), recordTipAfterSwitch(video, availability)]))
  assert.deepEqual(rows, [
    ['none', false, 'voice', 'hold'], ['none', true, 'voice', 'hold'],
    ['audio', false, 'voice', 'hold'], ['audio', true, 'voice', 'hold'],
    ['videoAndAudio', false, 'voice', 'voice'], ['videoAndAudio', true, 'video', 'video']
  ])
  const source = readFileSync(join(process.cwd(), 'src/renderer/src/history/record-button.tsx'), 'utf8')
  assert.match(source, /const next = !recordVideoMessages\n/, 'the click turns the choice over whatever the devices are')
  assert.doesNotMatch(source, /cameraAvailable/)
  for (const file of ['src/renderer/src/history/compose.tsx', 'src/renderer/src/channels/channel-inquiry-panel.tsx']) {
    const compose = readFileSync(join(process.cwd(), file), 'utf8')
    assert.match(compose, /const record = useRecordChoice\(\)/, file)
    assert.match(compose, /!showsRecordButton\(record\.availability\)/, file)
    assert.match(compose, /setRecording\(record\.mode\)/, file)
    assert.doesNotMatch(compose, /recordVideo \? 'video' : 'voice'/, file)
  }
})

test('B401: device listings — newer wins, a failed one changes nothing, a change of devices is read again', async () => {
  let release: ((devices: { kind: string }[]) => void) | null = null
  const slow = { enumerateDevices: () => new Promise<{ kind: string }[]>(resolve => { release = resolve }), addEventListener: () => {} }
  const older = readRecordAvailability(slow)
  await readRecordAvailability({ enumerateDevices: async () => [{ kind: 'audioinput' }, { kind: 'videoinput' }], addEventListener: () => {} })
  assert.equal(recordAvailabilityNow(), 'videoAndAudio')
  release!([]); await older
  assert.equal(recordAvailabilityNow(), 'videoAndAudio', 'the older answer came late and is dropped')
  await readRecordAvailability({ enumerateDevices: async () => { throw new Error('no') }, addEventListener: () => {} })
  assert.equal(recordAvailabilityNow(), 'videoAndAudio')
  await readRecordAvailability({ enumerateDevices: async () => [{ kind: 'audiooutput' }], addEventListener: () => {} })
  assert.equal(recordAvailabilityNow(), 'none')
})

test('the unit runner runs only the files it is given, and refuses a name that is not one', () => {
  const run = spawnSync(process.execPath, ['scripts/run-unit-tests.cjs', 'no-such-file.test.ts'], { cwd: process.cwd(), encoding: 'utf8' })
  assert.equal(run.status, 1)
  assert.match(run.stderr, /not a test file in test\/unit: no-such-file\.test\.ts/)
})
