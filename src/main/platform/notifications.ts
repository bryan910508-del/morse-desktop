import { Notification } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import type { NotificationStatus } from '../../shared/notifications'
import type { NotificationContent } from '../messaging/notifications'
import { tr } from '../../shared/i18n'

// Only the main process owns native notifications. Platform support is distinct
// from permission, Focus settings, signing and installation readiness.
export class NativeNotifications {
  private supported = false
  private message = ''
  constructor(private readonly changed: () => void) {}
  initialize(): void {
    this.supported = Notification.isSupported()
    if (this.supported && process.platform === 'darwin') {
      try { Notification.removeAll() }
      catch { this.report(tr('이전 알림을 정리하지 못했습니다. 시스템 알림 센터에서 확인해 주세요.')) }
    }
  }
  status(): NotificationStatus { return { supported: this.supported, message: this.message } }
  report(message: string): void {
    if (message === this.message) return
    this.message = message; this.changed()
  }
  show(uid: string, content: NotificationContent, click: () => void, dismiss: () => void): (() => void) | null {
    if (!this.supported) return null
    let notification: Notification | undefined
    let disposed = false
    const close = (): void => {
      if (disposed) return
      disposed = true
      notification?.removeAllListeners()
      try { notification?.close() }
      catch { this.report(tr('알림을 닫지 못했습니다. 시스템 알림 센터에서 확인해 주세요.')) }
    }
    const failed = (): void => {
      this.report(tr('시스템 알림을 표시하지 못했습니다. 알림 허용 상태와 앱 설치 상태를 확인해 주세요.'))
      close(); dismiss()
    }
    try {
      notification = new Notification({
        id: randomUUID().replaceAll('-', '').slice(0, 16),
        groupId: createHash('sha256').update(JSON.stringify([uid, content.chatId])).digest('hex').slice(0, 16),
        title: content.title, body: content.body, silent: content.silent
      })
      notification.on('show', () => { if (!disposed) this.report('') })
      notification.on('failed', failed)
      notification.on('click', () => { if (!disposed) click() })
      notification.on('close', details => {
        // A timed-out Windows toast may still be clickable in Action Center.
        if (disposed || (process.platform === 'win32' && details.reason === 'timedOut')) return
        close(); dismiss()
      })
      notification.show()
      return disposed ? null : close
    } catch { failed(); return null }
  }
}
