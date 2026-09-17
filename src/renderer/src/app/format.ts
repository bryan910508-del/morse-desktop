import { positionMilliseconds, type MessagePosition } from '../../../shared/model'
import { locale, tr } from '../../../shared/i18n'

const clock = new Intl.DateTimeFormat(locale(), { hour: 'numeric', minute: '2-digit' })
const weekday = new Intl.DateTimeFormat(locale(), { weekday: 'short' })
const shortDate = new Intl.DateTimeFormat(locale(), { year: '2-digit', month: 'numeric', day: 'numeric' })
const dayThisYear = new Intl.DateTimeFormat(locale(), { month: 'long', day: 'numeric', weekday: 'long' })
const dayOtherYear = new Intl.DateTimeFormat(locale(), { year: 'numeric', month: 'long', day: 'numeric' })
const full = new Intl.DateTimeFormat(locale(), { dateStyle: 'full', timeStyle: 'short' })

function startOfDay(time: number): number { const date = new Date(time); date.setHours(0, 0, 0, 0); return date.getTime() }

export function positionTime(position: MessagePosition | null | undefined): number | null {
  return position ? positionMilliseconds(position) : null
}
// Dialogs::Ui row date: today → time, this week → weekday, older → date.
export function dialogTime(time: number | null, now = Date.now()): string {
  if (time === null) return ''
  const today = startOfDay(now)
  if (time >= today) return clock.format(time)
  if (time >= today - 6 * 86400000) return weekday.format(time)
  return shortDate.format(time)
}
export function messageTime(time: number): string { return clock.format(time) }
export function fullTime(time: number): string { return full.format(time) }
// HistoryView service date: current year omits the year.
export function serviceDate(time: number, now = Date.now()): string {
  return new Date(time).getFullYear() === new Date(now).getFullYear() ? dayThisYear.format(time) : dayOtherYear.format(time)
}
export function sameDay(a: number, b: number): boolean { return startOfDay(a) === startOfDay(b) }
export function duration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds)), minutes = Math.floor(total / 60)
  return `${minutes}:${String(total % 60).padStart(2, '0')}`
}
export function bytes(size: number): string {
  if (size >= 1024 * 1024 * 1024) return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.ceil(size / 1024))} KB`
}
// Morse iOS AvatarView: the first character of the name, uppercased.
export function initials(name: string): string {
  return ([...name.trim()][0] ?? '?').toUpperCase()
}
export function errorText(error: unknown, fallback: string): string {
  // Electron prefixes invoke errors with the IPC channel; keep the product message.
  // A silent error already told the user what happened (see offerRecovery).
  if (error instanceof Error && error.name === 'SilentError') return ''
  // A message worded in Korean by a worker or the preload is shown in the app's language.
  return error instanceof Error && error.message ? tr(error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/u, '')) : fallback
}
