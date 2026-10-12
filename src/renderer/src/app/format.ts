// Portions of this file follow Telegram Desktop (https://github.com/telegramdesktop/tdesktop, 7.2.8, 272f6f5c),
// Copyright (c) 2014-2026 The Telegram Desktop Authors. Licensed under GPL-3.0-or-later; see LEGAL.
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
// Api::Authorizations::ActiveDateString (tdesktop api_authorizations.cpp): a session's last activity — today → time,
// this calendar week → weekday, older → date.
export function sessionActiveTime(time: number, now = Date.now()): string {
  if (sameDay(time, now)) return clock.format(time)
  const week = (value: number): number => { const date = new Date(startOfDay(value)); date.setDate(date.getDate() - (date.getDay() + 6) % 7); return date.getTime() }
  return week(time) === week(now) ? weekday.format(time) : shortDate.format(time)
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
// tdesktop Ui::FormatSizeText (ui/text/format_values.cpp:54-68): under 1 KB in bytes, then KB and MB with one decimal,
// cut rather than rounded (1023 bytes are «1023 B», 1535 are «1.4 KB»). Morse adds GB the same way for large files.
export function bytes(size: number): string {
  const whole = Math.max(0, Math.floor(size))
  const tenths = (unit: number, name: string): string => { const value = Math.floor(whole * 10 / unit); return `${Math.floor(value / 10)}.${value % 10} ${name}` }
  if (whole >= 1024 * 1024 * 1024) return tenths(1024 * 1024 * 1024, 'GB')
  if (whole >= 1024 * 1024) return tenths(1024 * 1024, 'MB')
  if (whole >= 1024) return tenths(1024, 'KB')
  return `${whole} B`
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
