import { screen, type BrowserWindow, type Rectangle } from 'electron'
import type { SettingsStore } from './settings'
import { tr } from '../../shared/i18n'

// Electron window and screen bounds already use device-independent pixels.
// Keep normal geometry separate from transient minimized/fullscreen states.
export class WindowState {
  private window: BrowserWindow | null = null
  private timer?: ReturnType<typeof setTimeout>
  private maximized = false
  private needsRecovery = false
  constructor(private readonly settings: SettingsStore, private readonly report: (message: string) => void) {}

  private fitted(bounds?: Rectangle): Rectangle & { minWidth: number; minHeight: number } {
    const area = (bounds ? screen.getDisplayMatching(bounds) : screen.getPrimaryDisplay()).workArea
    // st::windowMinWidth / st::windowMinHeight: small enough that the one-column layout (below 260 + 380) is
    // reachable, which is what makes a narrow window show the list or the chat, never both.
    const minWidth = Math.min(380, area.width), minHeight = Math.min(480, area.height)
    const width = Math.round(Math.min(Math.max(bounds?.width ?? 1180, minWidth), area.width))
    const height = Math.round(Math.min(Math.max(bounds?.height ?? 800, minHeight), area.height))
    return { width, height, minWidth, minHeight,
      x: Math.round(Math.max(area.x, Math.min(bounds?.x ?? area.x + (area.width - width) / 2, area.x + area.width - width))),
      y: Math.round(Math.max(area.y, Math.min(bounds?.y ?? area.y + (area.height - height) / 2, area.y + area.height - height))) }
  }
  initial(): Rectangle & { minWidth: number; minHeight: number } { return this.fitted(this.settings.window) }

  attach(window: BrowserWindow): void {
    this.window = window
    this.maximized = this.settings.window?.maximized === true
    const changed = (): void => {
      clearTimeout(this.timer)
      this.timer = setTimeout(() => { void this.save() }, 400)
    }
    const restore = (): void => { if (this.needsRecovery) this.recover(); changed() }
    window.on('move', changed); window.on('resize', changed)
    window.on('maximize', () => { this.maximized = true; changed() })
    window.on('unmaximize', () => {
      if (window.isVisible() && !window.isFullScreen()) this.maximized = false
      restore()
    })
    window.on('restore', restore); window.on('leave-full-screen', restore)
    screen.on('display-added', this.displayChanged)
    screen.on('display-removed', this.displayChanged)
    screen.on('display-metrics-changed', this.displayChanged)
    window.once('closed', () => {
      clearTimeout(this.timer)
      screen.removeListener('display-added', this.displayChanged)
      screen.removeListener('display-removed', this.displayChanged)
      screen.removeListener('display-metrics-changed', this.displayChanged)
      if (this.window === window) this.window = null
    })
  }
  private readonly displayChanged = (): void => { this.needsRecovery = true; this.recover() }

  // Called only for OS display changes and explicit window restoration, never
  // on each user move. A monitor event must use current, not persisted bounds.
  recover(): void {
    const window = this.window
    if (!window || window.isDestroyed()) return
    this.needsRecovery = true
    if (window.isMinimized() || window.isFullScreen() || window.isMaximized()) return
    this.needsRecovery = false
    const current = window.getNormalBounds()
    const { minWidth, minHeight, ...bounds } = this.fitted(current)
    window.setMinimumSize(minWidth, minHeight)
    if (current.x !== bounds.x || current.y !== bounds.y || current.width !== bounds.width || current.height !== bounds.height) window.setBounds(bounds)
  }
  show(): void {
    const window = this.window
    if (!window || window.isDestroyed()) return
    if (window.isMinimized()) window.restore()
    this.recover()
    window.show()
    if (this.maximized && !window.isFullScreen() && !window.isMaximized()) window.maximize()
    window.focus()
  }
  async save(): Promise<void> {
    clearTimeout(this.timer)
    const window = this.window
    if (!window || window.isDestroyed() || window.isMinimized() || window.isFullScreen()) return
    try { await this.settings.saveWindow({ ...window.getNormalBounds(), maximized: this.maximized }) }
    catch { this.report(tr('창 위치와 상태를 저장하지 못했습니다.')) }
  }
}
