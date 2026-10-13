import { app, Menu, nativeImage, Tray } from 'electron'
import type { NativeImage } from 'electron'
import { join } from 'node:path'
import type { DesktopSnapshot, Preferences } from '../../shared/model'
import { appBadgePixels, appBadgeState, dockBadgeText, type AppBadgeAccount, type AppBadgeState } from '../../shared/app-badge'
import { tr } from '../../shared/i18n'

// The window that carries the Windows taskbar overlay (BrowserWindow.setOverlayIcon) and the scale it is shown at.
export interface OverlayWindow { setOverlayIcon(overlay: NativeImage | null, description: string): void; scaleFactor(): number }
// The window draws the overlay's and the tray icon's pictures, as the main process has no canvas to set text on.
export type BadgeTarget = 'taskbar' | 'tray'
export interface OverlayDrawRequest { key: string; count: number; muted: boolean; pixels: number; target: BadgeTarget }
interface Overlay { key: string; state: AppBadgeState; pixels: number }
// What a picture was asked for, which one shows, and when the window was last asked to draw it.
interface Painting { wanted: Overlay | null; shown: string; asked: number }
// The part of Electron's Tray the shell uses (a stand-in in tests).
export type TrayLike = Pick<Tray, 'setImage' | 'setToolTip' | 'setContextMenu' | 'on' | 'destroy' | 'isDestroyed'>

// Native shell ownership never owns a socket or writes message/read state.
export class DesktopShell {
  private tray: TrayLike | null = null
  private trayBase: NativeImage | null = null
  private tooltip = ''
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
    private readonly makeTray: (icon: NativeImage) => TrayLike = icon => new Tray(icon)) {}

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
      tray.setToolTip('Morse'); this.tooltip = 'Morse'
      tray.setContextMenu(Menu.buildFromTemplate([
        { label: tr('Morse 열기'), click: this.show }, { type: 'separator' },
        { label: tr('Morse 종료'), click: this.quit }
      ]))
      tray.on('click', this.show)
    } catch {
      this.tray?.destroy(); this.tray = null
      this.message = tr('시스템 트레이를 만들지 못했습니다. 창을 닫으면 앱이 종료됩니다.')
    }
  }
  status(): DesktopSnapshot['platformIntegration'] {
    return { trayAvailable: Boolean(this.tray && !this.tray.isDestroyed()), message: this.message }
  }
  canCloseToTray(preferences: Preferences): boolean {
    return !this.closed && this.platform === 'win32' && preferences.closeToTray && this.status().trayAvailable
  }
  update(preferences: Preferences, accounts: AppBadgeAccount[], available: boolean): void {
    if (this.closed) return
    // Every signed-in account's confirmed list contributes, as Telegram counts all accounts.
    // There is no local increment on receipt and no decrement when a notification is clicked.
    const state = appBadgeState(preferences, accounts, available)
    if (this.platform === 'darwin') this.updateDock(state.count)
    else if (this.platform === 'win32') { this.updateOverlay(state); this.updateTray(state) }
  }
  // The window gives back the picture for one request; an older one is dropped (the count moved on meanwhile).
  overlayDrawn(key: string, dataURL: string): void {
    if (this.closed || this.platform !== 'win32') return
    const target = (Object.keys(this.painting) as BadgeTarget[]).find(name => this.painting[name].wanted?.key === key)
    if (!target) return
    const painting = this.painting[target], wanted = painting.wanted!
    try {
      const image = nativeImage.createFromDataURL(dataURL)
      if (image.isEmpty()) throw new Error('Empty badge')
      if (target === 'taskbar') {
        const window = this.window()
        if (!window) return
        // tdesktop's description is lng_unread_bar (main_window_win.cpp:656-658), for screen readers.
        window.setOverlayIcon(image, tr('읽지 않은 메시지 {0}개', [wanted.state.count]))
      } else {
        if (!this.tray || this.tray.isDestroyed()) return
        this.tray.setImage(image)
      }
      painting.shown = key
    } catch { this.message = target === 'taskbar' ? tr('작업 표시줄의 읽지 않은 메시지 수를 표시하지 못했습니다.') : tr('알림 영역의 읽지 않은 메시지 수를 표시하지 못했습니다.') }
  }
  // A new window (or a reloaded one) has no overlay and forgot what it was asked: both are asked again (tdesktop draws
  // again on showFromTray, :626).
  windowReset(): void {
    for (const painting of Object.values(this.painting)) { painting.wanted = null; painting.asked = 0 }
    this.painting.taskbar.shown = ''
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
    if (!window) return
    this.paint('taskbar', state, appBadgePixels(window.scaleFactor()), () => window.setOverlayIcon(null, ''))
  }
  // B348b, tdesktop Tray::updateIcon (tray_win.cpp:209-233): the notification area's small icon carries the count on the
  // logo (WithSmallCounter), none shows the logo alone; its tooltip is «Morse (n)» (Core::TrayIconToolTip, tray.cpp:22-27).
  private updateTray(state: AppBadgeState): void {
    const tray = this.tray, base = this.trayBase
    if (!tray || tray.isDestroyed() || !base) return
    const tooltip = state.count > 0 ? `Morse (${state.count})` : 'Morse'
    if (tooltip !== this.tooltip) { try { tray.setToolTip(tooltip); this.tooltip = tooltip } catch { /* the tooltip stays */ } }
    this.paint('tray', state, appBadgePixels(this.window()?.scaleFactor() ?? 1), () => tray.setImage(base))
  }
  private paint(target: BadgeTarget, state: AppBadgeState, pixels: number, clear: () => void): void {
    const painting = this.painting[target]
    if (state.count === 0) {
      painting.wanted = null
      if (painting.shown === 'none') return
      try { clear(); painting.shown = 'none' }
      catch { this.message = target === 'taskbar' ? tr('작업 표시줄의 읽지 않은 메시지 수를 표시하지 못했습니다.') : tr('알림 영역의 읽지 않은 메시지 수를 표시하지 못했습니다.') }
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
