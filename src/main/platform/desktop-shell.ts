import { app, Menu, nativeImage, Tray } from 'electron'
import type { NativeImage } from 'electron'
import { join } from 'node:path'
import type { DesktopSnapshot, Preferences } from '../../shared/model'
import { appBadgePixels, appBadgeState, dockBadgeText, type AppBadgeAccount, type AppBadgeState } from '../../shared/app-badge'
import { tr } from '../../shared/i18n'

// The window that carries the Windows taskbar overlay (BrowserWindow.setOverlayIcon) and the scale it is shown at.
export interface OverlayWindow { setOverlayIcon(overlay: NativeImage | null, description: string): void; scaleFactor(): number }
// The window draws the overlay's picture, as the main process has no canvas to set text on.
export interface OverlayDrawRequest { key: string; count: number; muted: boolean; pixels: number }
interface Overlay { key: string; state: AppBadgeState; pixels: number }

// Native shell ownership never owns a socket or writes message/read state.
export class DesktopShell {
  private tray: Tray | null = null
  private message = ''
  private badge = ''
  private closed = false
  // B348: what the taskbar should show, what it shows, and when the window was last asked to draw.
  private wanted: Overlay | null = null
  private shown = ''
  private asked = 0
  private serial = 0
  constructor(private readonly show: () => void, private readonly quit: () => void,
    private readonly window: () => OverlayWindow | null = () => null,
    private readonly draw: (request: OverlayDrawRequest) => void = () => {},
    private readonly platform: NodeJS.Platform = process.platform, private readonly now: () => number = Date.now) {}

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
      const tray = new Tray(icon.resize({ width: 32, height: 32, quality: 'best' }))
      this.tray = tray
      tray.setToolTip('Morse')
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
    else if (this.platform === 'win32') this.updateOverlay(state)
  }
  // The window gives back the picture for one request; an older one is dropped (the count moved on meanwhile).
  overlayDrawn(key: string, dataURL: string): void {
    const wanted = this.wanted
    if (this.closed || this.platform !== 'win32' || !wanted || wanted.key !== key) return
    const target = this.window()
    if (!target) return
    try {
      const image = nativeImage.createFromDataURL(dataURL)
      if (image.isEmpty()) throw new Error('Empty badge')
      // tdesktop's description is lng_unread_bar (main_window_win.cpp:656-658), for screen readers.
      target.setOverlayIcon(image, tr('읽지 않은 메시지 {0}개', [wanted.state.count]))
      this.shown = key
    } catch { this.message = tr('작업 표시줄의 읽지 않은 메시지 수를 표시하지 못했습니다.') }
  }
  // A new window (or a reloaded one) has no overlay: it is set again (tdesktop draws again on showFromTray, :626).
  windowReset(): void {
    this.shown = ''
    this.asked = 0
    this.wanted = null
  }
  private updateDock(count: number): void {
    const badge = dockBadgeText(count)
    if (badge === this.badge) return
    try { app.dock?.setBadge(badge); this.badge = badge }
    catch { this.message = tr('Dock의 읽지 않은 메시지 수를 표시하지 못했습니다.') }
  }
  // tdesktop updateTaskbarAndIconCounters (main_window_win.cpp:645-660): a count draws the overlay, none takes it off.
  private updateOverlay(state: AppBadgeState): void {
    const target = this.window()
    if (!target) return
    if (state.count === 0) {
      this.wanted = null
      if (this.shown === 'none') return
      try { target.setOverlayIcon(null, ''); this.shown = 'none' }
      catch { this.message = tr('작업 표시줄의 읽지 않은 메시지 수를 표시하지 못했습니다.') }
      return
    }
    const pixels = appBadgePixels(target.scaleFactor())
    const same = this.wanted && this.wanted.state.count === state.count && this.wanted.state.muted === state.muted && this.wanted.pixels === pixels
    if (same && this.shown === this.wanted!.key) return
    // Not drawn yet: the request goes again a second later, as the window may not have been listening.
    if (same && this.now() - this.asked < 1000) return
    if (!same) this.wanted = { key: `${++this.serial}`, state, pixels }
    this.asked = this.now()
    const wanted = this.wanted!
    this.draw({ key: wanted.key, count: state.count, muted: state.muted, pixels })
  }
  close(): void {
    if (this.closed) return
    this.closed = true
    try {
      this.tray?.destroy()
      if (this.platform === 'darwin') app.dock?.setBadge('')
      if (this.platform === 'win32') { this.wanted = null; this.window()?.setOverlayIcon(null, '') }
    } catch { this.message = tr('시스템 아이콘을 정리하지 못했습니다.') }
    finally { this.tray = null }
  }
}
