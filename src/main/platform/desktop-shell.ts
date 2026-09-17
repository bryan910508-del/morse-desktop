import { app, Menu, nativeImage, Tray } from 'electron'
import { join } from 'node:path'
import type { DesktopSnapshot, DialogSummary, Preferences } from '../../shared/model'
import { effectiveUnreadCount } from '../../shared/manual-unread'
import { tr } from '../../shared/i18n'

// Native shell ownership never owns a socket or writes message/read state.
export class DesktopShell {
  private tray: Tray | null = null
  private message = ''
  private badge = ''
  private closed = false
  constructor(private readonly show: () => void, private readonly quit: () => void) {}

  initialize(): void {
    if (process.platform === 'darwin') {
      try {
        app.dock?.setBadge('')
        app.dock?.setMenu(Menu.buildFromTemplate([{ label: tr('Morse 열기'), click: this.show }]))
      } catch { this.message = tr('Dock 메뉴와 메시지 수 표시를 초기화하지 못했습니다.') }
      return
    }
    if (process.platform !== 'win32') return
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
    return !this.closed && process.platform === 'win32' && preferences.closeToTray && this.status().trayAvailable
  }
  update(preferences: Preferences, accounts: { uid: string; dialogs: DialogSummary[] }[], available: boolean): void {
    if (this.closed || process.platform !== 'darwin') return
    // Every signed-in account's confirmed list contributes, as Telegram counts all accounts.
    // There is no local increment on receipt and no decrement when a notification is clicked.
    let count = 0
    if (available && preferences.showUnreadBadge) {
      for (const { uid, dialogs } of accounts) for (const dialog of dialogs) {
        const unread = effectiveUnreadCount(dialog)
        // iOS «메시지 수» counts unread messages, «채팅 수» the chats that have any.
        if (!dialog.muted && !dialog.archived && dialog.kind !== 'secret' && dialog.participantUids.includes(uid) &&
            Number.isSafeInteger(unread) && unread > 0) count = Math.min(1000, count + (preferences.badgeMode === 'chats' ? 1 : unread))
      }
    }
    const badge = count > 999 ? '999+' : count > 0 ? String(count) : ''
    if (badge === this.badge) return
    try { app.dock?.setBadge(badge); this.badge = badge }
    catch { this.message = tr('Dock의 읽지 않은 메시지 수를 표시하지 못했습니다.') }
  }
  close(): void {
    if (this.closed) return
    this.closed = true
    try {
      this.tray?.destroy()
      if (process.platform === 'darwin') app.dock?.setBadge('')
    } catch { this.message = tr('시스템 아이콘을 정리하지 못했습니다.') }
    finally { this.tray = null }
  }
}
