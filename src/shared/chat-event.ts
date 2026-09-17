import { identifier, object } from './validation'
import { language, locale, tr } from './i18n'

// MorseMessenger iOS "일정 만들기": the chat receives a text message and the sender's device keeps a
// reminder (EventAlarmOption / NotificationService.scheduleChatEventReminder).
export const eventAlarmOptions = [
  { id: 'none', label: tr('없음'), before: null },
  { id: 'atStart', label: tr('일정 시작 시각'), before: 0 },
  { id: 'minutes5', label: tr('5분 전'), before: 5 * 60000 },
  { id: 'minutes10', label: tr('10분 전'), before: 10 * 60000 },
  { id: 'minutes15', label: tr('15분 전'), before: 15 * 60000 },
  { id: 'minutes30', label: tr('30분 전'), before: 30 * 60000 },
  { id: 'hour1', label: tr('1시간 전'), before: 60 * 60000 },
  { id: 'day1', label: tr('1일 전'), before: 24 * 60 * 60000 }
] as const
export type EventAlarm = typeof eventAlarmOptions[number]['id']
export const maxEventTitle = 200

// chat.dateMonthDayTime: "M월 d일 a h:mm" in Korean, "MMM d h:mm a" in English and "d MMM HH:mm" in Russian.
export function eventDateLine(ms: number): string {
  const date = new Date(ms), hour = date.getHours(), h12 = hour % 12 === 0 ? 12 : hour % 12
  const lang = language()
  if (lang === 'ko') return `${date.getMonth() + 1}월 ${date.getDate()}일 ${hour < 12 ? '오전' : '오후'} ${h12}:${String(date.getMinutes()).padStart(2, '0')}`
  const parts = (options: Intl.DateTimeFormatOptions): Partial<Record<Intl.DateTimeFormatPartTypes, string>> =>
    Object.fromEntries(new Intl.DateTimeFormat(locale(), options).formatToParts(date).map(part => [part.type, part.value]))
  if (lang === 'en') { const p = parts({ month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }); return `${p.month} ${p.day} ${p.hour}:${p.minute} ${p.dayPeriod}` }
  const p = parts({ month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  return `${p.day} ${p.month} ${p.hour}:${p.minute}`
}
export function eventMessageText(title: string, start: number): string { return `📅 ${title}\n${eventDateLine(start)}` }
// NotificationService.formatEventDateLine: medium date, short time.
const reminderFormat = new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeStyle: 'short' })
export function eventReminderBody(title: string, start: number): string { return tr('{0}\n시작 {1}', [title, reminderFormat.format(start)]) }
export function eventFireAt(start: number, alarm: EventAlarm): number | null {
  const before = eventAlarmOptions.find(option => option.id === alarm)?.before
  return before === null || before === undefined ? null : start - before
}

export interface EventReminderRequest { id: string; chatId: string; title: string; eventStart: number; fireAt: number }
export function eventReminderRequest(raw: unknown): EventReminderRequest {
  const value = object(raw)
  if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > maxEventTitle) throw new Error(tr('일정 제목을 확인해 주세요.'))
  for (const key of ['eventStart', 'fireAt'] as const) if (typeof value[key] !== 'number' || !Number.isSafeInteger(value[key])) throw new Error(tr('일정 시간을 확인해 주세요.'))
  if ((value.fireAt as number) > (value.eventStart as number)) throw new Error(tr('알림 시간을 확인해 주세요.'))
  return { id: identifier(value.id), chatId: identifier(value.chatId), title: value.title.trim(), eventStart: value.eventStart as number, fireAt: value.fireAt as number }
}
