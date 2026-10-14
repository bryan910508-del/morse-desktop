import { app, Menu, nativeImage, Tray } from 'electron'
import type { NativeImage } from 'electron'
import { join } from 'node:path'
import type { DesktopSnapshot, Preferences } from '../../shared/model'
import { appBadgePixels, appBadgeState, dockBadgeText, type AppBadgeAccount, type AppBadgeState } from '../../shared/app-badge'
import { tr } from '../../shared/i18n'
import { closeToTrayEffective } from '../../shared/close-to-tray'
import { errorName, type BadgeDetail } from './badge-diagnostics'

// The window that carries the Windows taskbar overlay (BrowserWindow.setOverlayIcon), the scale it is shown at, and its
// title (B348d-3).
export interface OverlayWindow { setOverlayIcon(overlay: NativeImage | null, description: string): void; scaleFactor(): number; setTitle(title: string): void }
// B348d: the tray tooltip and the window title carry the count as Telegram's do (Core::TrayIconToolTip, tray.cpp:22-27;
// MainWindow::updateTitle, window/main_window.cpp:887-917, «Telegram (n)»). No chat or account name goes into either.
export function countTitle(count: number): string { return count > 0 ? `Morse (${count})` : 'Morse' }
// The window draws the overlay's and the tray icon's pictures, as the main process has no canvas to set text on.
export type BadgeTarget = 'taskbar' | 'tray'
export interface OverlayDrawRequest { key: string; count: number; muted: boolean; pixels: number; target: BadgeTarget }
interface Overlay { key: string; state: AppBadgeState; pixels: number }
// What a picture was asked for, which one shows, and when the window was last asked to draw it.
interface Painting { wanted: Overlay | null; shown: string; asked: number }
// The part of Electron's Tray the shell uses (a stand-in in tests).
export type TrayLike = Pick<Tray, 'setImage' | 'setToolTip' | 'setContextMenu' | 'on' | 'destroy' | 'isDestroyed'> & Partial<Pick<Tray, 'displayBalloon'>>
// B374: what a tray click does to the window (tdesktop Tray iconClicks, tray.cpp:67-77): one that is shown and active is
// hidden to the tray, any other is shown. Clicking the tray takes the focus first, so a window that lost it within half a
// second still counts as active (main_window_win.cpp:589-592, kKeepActiveForTrayIcon :63).
export interface TrayWindow { active(): boolean; hide(): void }
export function activeForTrayClick(visible: boolean, focused: boolean, lastBlur: number, now: number): boolean {
  return visible && (focused || (lastBlur > 0 && now - lastBlur <= 500))
}
// The second click of a double-click does nothing, so it neither shows and hides nor hides and shows (tray.cpp:69-71,
// QApplication::doubleClickInterval; Windows' default GetDoubleClickTime is 500 ms).
const trayDoubleClick = 500

// Native shell ownership never owns a socket or writes message/read state.
export class DesktopShell {
  private tray: TrayLike | null = null
  private trayBase: NativeImage | null = null
  // The tooltip the tray carries now, and the last one written to badge-check.log.
  private tooltip = 'Morse'
  private tooltipRecorded = ''
  private title = ''
  // The last count asked for, so a refresh can send it all again.
  private last: AppBadgeState | null = null
  private message = ''
  private badge = ''
  private closed = false
  // B348 (taskbar overlay) and B348b (tray icon): one painting each, from the one count.
  private readonly painting: Record<BadgeTarget, Painting> = { taskbar: { wanted: null, shown: '', asked: 0 }, tray: { wanted: null, shown: '', asked: 0 } }
  private serial = 0
  constructor(private readonly show: () => void, private readonly quit: () => void,
    private readonly window: () => OverlayWindow | null = () => null,
    private readonly draw: (request: OverlayDrawRequest) => void = () => {},
    private readonly platform: NodeJS.Platform = process.platform, private readonly now: () => number = Date.now,
    private readonly makeTray: (icon: NativeImage) => TrayLike = icon => new Tray(icon),
    private readonly trayWindow: TrayWindow = { active: () => false, hide: () => {} },
    // B348: badge-check.log (badge-diagnostics.ts); a test gives its own.
    private readonly record: (step: string, detail: BadgeDetail) => void = () => {}) {}
  private lastTrayClick = 0

  initialize(): void {
    if (this.platform === 'darwin') {
      try {
        app.dock?.setBadge('')
        app.dock?.setMenu(Menu.buildFromTemplate([{ label: tr('Morse 열기'), click: this.show }]))
      } catch { this.message = tr('Dock 메뉴와 메시지 수 표시를 초기화하지 못했습니다.') }
      return
    }
    if (this.platform !== 'win32') return
    try {
      const icon = nativeImage.createFromPath(join(app.getAppPath(), 'resources/brand/morse.png'))
      if (icon.isEmpty()) throw new Error('Missing icon')
      // The existing brand image is local. No account names or message bodies
      // enter the Windows notification area or its menu.
      const base = icon.resize({ width: 32, height: 32, quality: 'best' })
      const tray = this.makeTray(base)
      this.tray = tray; this.trayBase = base
      tray.setContextMenu(Menu.buildFromTemplate([
        { label: tr('Morse 열기'), click: this.show }, { type: 'separator' },
        { label: tr('Morse 종료'), click: this.quit }
      ]))
      tray.on('click', () => this.trayClicked())
      this.record('tray', { made: true, pixels: 32 })
      this.sendTip(tray)
    } catch (error) {
      this.record('tray', { made: false, reason: error instanceof Error && error.message === 'Missing icon' ? 'missing-icon' : errorName(error) })
      this.tray?.destroy(); this.tray = null
      this.message = tr('시스템 트레이를 만들지 못했습니다. 창을 닫으면 앱이 종료됩니다.')
    }
  }
  status(): DesktopSnapshot['platformIntegration'] {
    return { trayAvailable: Boolean(this.tray && !this.tray.isDestroyed()), message: this.message }
  }
  canCloseToTray(preferences: Preferences): boolean {
    return !this.closed && closeToTrayEffective(preferences, this.platform) && this.status().trayAvailable
  }
  private trayClicked(): void {
    const now = this.now()
    if (this.lastTrayClick > 0 && now - this.lastTrayClick < trayDoubleClick) return
    this.lastTrayClick = now
    if (this.trayWindow.active()) this.trayWindow.hide(); else this.show()
  }
  // B374: tdesktop Tray::showTrayMessage (platform/win/tray_win.cpp:268-280): the first time the window goes to the tray,
  // one balloon says Morse still runs there (lng_tray_icon_text, lang.strings:34). Whether it was shown is the caller's to
  // keep (SettingsStore.trayHintSeen); false when there is no tray to show it from.
  showTrayHint(): boolean {
    const tray = this.tray
    if (this.closed || this.platform !== 'win32' || !tray || tray.isDestroyed() || !tray.displayBalloon) return false
    try {
      tray.displayBalloon({ iconType: 'info', title: 'Morse', content: tr('Morse는 여기서 계속 실행 중이에요. 설정에서 바꿀 수 있어요.\n알림 영역에서 사라지면 숨겨진 아이콘에서 다시 끌어 올 수 있어요.') })
      return true
    } catch { return false }
  }
  update(preferences: Preferences, accounts: AppBadgeAccount[], available: boolean): void {
    if (this.closed) return
    // Every signed-in account's confirmed list contributes, as Telegram counts all accounts.
    // There is no local increment on receipt and no decrement when a notification is clicked.
    const state = appBadgeState(preferences, accounts, available)
    if (this.platform === 'win32') this.record('update', { count: state.count, muted: state.muted, available, shown: preferences.showUnreadBadge, accounts: accounts.length })
    this.last = state
    this.apply(state)
  }
  private apply(state: AppBadgeState): void {
    this.updateTitle(state.count)
    if (this.platform === 'darwin') this.updateDock(state.count)
    else if (this.platform === 'win32') { this.updateOverlay(state); this.updateTray(state) }
  }
  // B348d-2, tdesktop Tray::updateIconCounters where it is called besides a count change: showing the window from the tray
  // (MainWindow::showFromTray, window/main_window.cpp:621-628) and a change of the system's settings (WM_SETTINGCHANGE,
  // platform/win/integration_win.cpp:242-247). Electron gives these as the window's 'show', nativeTheme 'updated' and
  // screen 'display-metrics-changed'. The taskbar picture, the tray picture and the tooltip all go again: Windows makes the
  // taskbar again after a change of scale or resolution, and Electron then puts the tray icon back without its tooltip
  // (notify_icon.cc ResetIcon :110-128, notify_icon_host.cc:249-252).
  refresh(): void {
    if (this.closed || !this.last) return
    this.windowReset(); this.painting.tray.shown = ''; this.title = ''
    this.apply(this.last)
  }
  // The window gives back the picture for one request; an older one is dropped (the count moved on meanwhile).
  overlayDrawn(key: string, dataURL: string): void {
    if (this.closed || this.platform !== 'win32') return
    const target = (Object.keys(this.painting) as BadgeTarget[]).find(name => this.painting[name].wanted?.key === key)
    if (!target) { this.record('drawn', { result: 'stale' }); return }
    this.record('drawn', { target, result: 'ok', bytes: dataURL.length })
    const painting = this.painting[target], wanted = painting.wanted!
    try {
      const image = nativeImage.createFromDataURL(dataURL)
      if (image.isEmpty()) throw new Error('Empty badge')
      if (target === 'taskbar') {
        const window = this.window()
        if (!window) { this.record('apply', { target, result: 'no-window' }); return }
        // tdesktop's description is lng_unread_bar (main_window_win.cpp:656-658), for screen readers.
        window.setOverlayIcon(image, tr('읽지 않은 메시지 {0}개', [wanted.state.count]))
      } else {
        if (!this.tray || this.tray.isDestroyed()) { this.record('apply', { target, result: 'no-tray' }); return }
        this.tray.setImage(image); this.sendTip(this.tray)
      }
      painting.shown = key
      this.record('apply', { target, result: 'ok', count: wanted.state.count, pixels: wanted.pixels })
    } catch (error) {
      this.record('apply', { target, result: error instanceof Error && error.message === 'Empty badge' ? 'empty-picture' : errorName(error) }); this.message = target === 'taskbar' ? tr('작업 표시줄의 읽지 않은 메시지 수를 표시하지 못했습니다.') : tr('알림 영역의 읽지 않은 메시지 수를 표시하지 못했습니다.') }
  }
  // B348: the window could not draw a picture it was asked for (it used to be dropped where it failed, main.tsx). It is
  // written down by the error's name; the request goes again a second later, as one that never came back does.
  overlayFailed(key: string, name: string): void {
    if (this.closed || this.platform !== 'win32') return
    const target = (Object.keys(this.painting) as BadgeTarget[]).find(entry => this.painting[entry].wanted?.key === key)
    this.record('drawn', { target: target ?? 'stale', result: 'failed', name: name.slice(0, 40) })
  }
  // A new window (or a reloaded one) has no overlay or title of ours and forgot what it was asked: both are asked again
  // (tdesktop draws again on showFromTray, :626).
  windowReset(): void {
    for (const painting of Object.values(this.painting)) { painting.wanted = null; painting.asked = 0 }
    this.painting.taskbar.shown = ''; this.title = ''
  }
  // B348d-3: the window's title is «Morse (n)» from the same count as the badge (MainWindow::updateTitle).
  private updateTitle(count: number): void {
    const window = this.window(), title = countTitle(count)
    if (!window || title === this.title) return
    try { window.setTitle(title); this.title = title } catch { /* The window is going away; the next one is titled again. */ }
  }
  private updateDock(count: number): void {
    const badge = dockBadgeText(count)
    if (badge === this.badge) return
    try { app.dock?.setBadge(badge); this.badge = badge }
    catch { this.message = tr('Dock의 읽지 않은 메시지 수를 표시하지 못했습니다.') }
  }
  // tdesktop updateTaskbarAndIconCounters (main_window_win.cpp:645-660): a count draws the overlay, none takes it off.
  private updateOverlay(state: AppBadgeState): void {
    const window = this.window()
    if (!window) { if (state.count > 0) this.record('request', { target: 'taskbar', result: 'no-window' }); return }
    this.paint('taskbar', state, appBadgePixels(window.scaleFactor()), () => window.setOverlayIcon(null, ''))
  }
  // B348b, tdesktop Tray::updateIcon (tray_win.cpp:209-233): the notification area's small icon carries the count on the
  // logo (WithSmallCounter), none shows the logo alone; its tooltip is «Morse (n)» (Core::TrayIconToolTip, tray.cpp:22-27).
  // B348d-1: tdesktop sends the tooltip after every picture (:231-232), and Qt sends picture and tooltip in one message
  // (qwindowssystemtrayicon.cpp sendTrayMessage :336-352). Electron sends them apart and keeps no tooltip (notify_icon.cc
  // SetImage :130-140, SetToolTip :160-168), so the tooltip goes again with each picture, never skipped as unchanged.
  private updateTray(state: AppBadgeState): void {
    const tray = this.tray, base = this.trayBase
    if (!tray || tray.isDestroyed() || !base) { if (state.count > 0) this.record('request', { target: 'tray', result: 'no-tray' }); return }
    const tooltip = countTitle(state.count)
    // A new count says so at once; its picture follows when the window has drawn it, with the tooltip again.
    if (tooltip !== this.tooltip) { this.tooltip = tooltip; this.sendTip(tray) }
    this.paint('tray', state, appBadgePixels(this.window()?.scaleFactor() ?? 1), () => { tray.setImage(base); this.sendTip(tray) })
  }
  private sendTip(tray: TrayLike): void {
    const count = this.last?.count ?? 0
    try {
      tray.setToolTip(this.tooltip)
      if (this.tooltipRecorded !== this.tooltip) { this.tooltipRecorded = this.tooltip; this.record('tooltip', { count, result: 'ok' }) }
    } catch (error) { this.tooltipRecorded = ''; this.record('tooltip', { count, result: errorName(error) }) }
  }
  private paint(target: BadgeTarget, state: AppBadgeState, pixels: number, clear: () => void): void {
    const painting = this.painting[target]
    if (state.count === 0) {
      painting.wanted = null
      if (painting.shown === 'none') return
      try { clear(); painting.shown = 'none'; this.record('apply', { target, result: 'cleared' }) }
      catch (error) { this.record('apply', { target, result: errorName(error) }); this.message = target === 'taskbar' ? tr('작업 표시줄의 읽지 않은 메시지 수를 표시하지 못했습니다.') : tr('알림 영역의 읽지 않은 메시지 수를 표시하지 못했습니다.') }
      return
    }
    const wanted = painting.wanted
    const same = wanted !== null && wanted.state.count === state.count && wanted.state.muted === state.muted && wanted.pixels === pixels
    if (same && painting.shown === wanted.key) return
    // Not drawn yet: the request goes again a second later, as the window may not have been listening.
    if (same && this.now() - painting.asked < 1000) return
    if (!same) painting.wanted = { key: `${target}-${++this.serial}`, state, pixels }
    painting.asked = this.now()
    const next = painting.wanted!
    this.record('request', { target, count: state.count, muted: state.muted, pixels, serial: this.serial, again: same })
    this.draw({ key: next.key, count: state.count, muted: state.muted, pixels, target })
  }
  close(): void {
    if (this.closed) return
    this.closed = true
    try {
      this.tray?.destroy()
      if (this.platform === 'darwin') app.dock?.setBadge('')
      if (this.platform === 'win32') { this.painting.taskbar.wanted = this.painting.tray.wanted = null; this.window()?.setOverlayIcon(null, '') }
    } catch { this.message = tr('시스템 아이콘을 정리하지 못했습니다.') }
    finally { this.tray = null; this.trayBase = null }
  }
}
