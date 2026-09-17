import type Database from 'better-sqlite3-multiple-ciphers'
import { identifier } from '../../shared/validation'

export interface StoredEventReminder { id: string; chatId: string; title: string; eventStart: number; fireAt: number }
export type EventReminderCommand =
  | { kind: 'event-reminders' }
  | { kind: 'event-reminder-add'; reminder: StoredEventReminder }
  | { kind: 'event-reminder-remove'; id: string }

// Reminders of events this account created on this device, like iOS pending local notifications.
export function executeEventReminder(db: Database.Database, command: EventReminderCommand): unknown {
  switch (command.kind) {
    case 'event-reminders': {
      const rows = db.prepare('SELECT id,chat_id,title,event_start,fire_at FROM event_reminders ORDER BY fire_at').all() as { id: string; chat_id: string; title: string; event_start: number; fire_at: number }[]
      return rows.map(row => ({ id: identifier(row.id), chatId: identifier(row.chat_id), title: row.title.slice(0, 200), eventStart: row.event_start, fireAt: row.fire_at }))
    }
    case 'event-reminder-add': {
      const value = command.reminder
      db.prepare(`INSERT INTO event_reminders(id,chat_id,title,event_start,fire_at) VALUES(?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET chat_id=excluded.chat_id,title=excluded.title,event_start=excluded.event_start,fire_at=excluded.fire_at`)
        .run(identifier(value.id), identifier(value.chatId), value.title.slice(0, 200), value.eventStart, value.fireAt)
      return null
    }
    case 'event-reminder-remove': return db.prepare('DELETE FROM event_reminders WHERE id=?').run(identifier(command.id)).changes === 1
  }
}
