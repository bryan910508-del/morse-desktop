import { eventReminderBody, type EventReminderRequest } from '../../shared/chat-event'
import type { NotificationContent } from '../messaging/notifications'
import type { EventReminderCommand, StoredEventReminder } from '../storage/event-reminder-table'
import { tr } from '../../shared/i18n'

// Timers wait at most this long; a longer reminder is armed again when it comes closer.
const maxTimer = 24 * 60 * 60 * 1000
// A reminder missed while Morse was closed still shows if it is this recent.
const lateGrace = 10 * 60 * 1000

interface ReminderHost {
  locked(): boolean
  show(content: NotificationContent, click: () => void, dismiss: () => void): (() => void) | null
  open(chatId: string): void
}

// NotificationService.scheduleChatEventReminder on Desktop: while Morse runs, the reminder of an event
// the user created appears as a system notification ("일정 알림") and opens its chat when clicked.
export class EventReminders {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private closed = false
  constructor(private readonly store: <T>(command: EventReminderCommand) => Promise<T>, private readonly host: ReminderHost) {
    void this.store<StoredEventReminder[]>({ kind: 'event-reminders' }).then(rows => { for (const row of rows) this.arm(row) }, () => {})
  }
  async add(request: EventReminderRequest): Promise<'done'> {
    if (this.closed) throw new Error(tr('일정 알림을 저장하지 못했습니다.'))
    if (request.fireAt <= Date.now() + 2000) return 'done'
    await this.store({ kind: 'event-reminder-add', reminder: request })
    this.arm(request)
    return 'done'
  }
  private arm(reminder: StoredEventReminder): void {
    if (this.closed) return
    const existing = this.timers.get(reminder.id)
    if (existing) clearTimeout(existing)
    const wait = reminder.fireAt - Date.now()
    if (wait < -lateGrace) { this.forget(reminder.id); return }
    this.timers.set(reminder.id, setTimeout(() => {
      this.timers.delete(reminder.id)
      if (this.closed) return
      if (reminder.fireAt - Date.now() > 1000) { this.arm(reminder); return }
      // A locked screen shows no chat content; look again shortly while the reminder is still recent.
      if (this.host.locked()) {
        if (Date.now() - reminder.fireAt < lateGrace) this.timers.set(reminder.id, setTimeout(() => { this.timers.delete(reminder.id); this.arm(reminder) }, 60000))
        else this.forget(reminder.id)
        return
      }
      this.forget(reminder.id)
      const close = this.host.show({ chatId: reminder.chatId, title: tr('일정 알림'), body: eventReminderBody(reminder.title, reminder.eventStart), silent: false },
        () => { close?.(); this.host.open(reminder.chatId) }, () => {})
    }, Math.max(0, Math.min(maxTimer, wait))))
  }
  private forget(id: string): void { void this.store({ kind: 'event-reminder-remove', id }).catch(() => {}) }
  close(): void {
    this.closed = true
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
  }
}
