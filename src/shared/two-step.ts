// Portions of this file follow Telegram Desktop (https://github.com/telegramdesktop/tdesktop, 7.2.8, 272f6f5c),
// Copyright (c) 2014-2026 The Telegram Desktop Authors. Licensed under GPL-3.0-or-later; see LEGAL.
import { locale, tr } from './i18n'

// Two-step verification's rules and words (contracts A13-2 §3, §5), the same in the three apps.
// A13-4: at least 6 characters (code points) — the server cannot see the password, so the app holds the line; a short
// digits-only one (a 4-digit PIN) is below it. The hint is optional, at most 64 characters, and never the password
// (tdesktop settings_cloud_password_hint.cpp:131-139). There is no recovery email: a forgotten password waits 7 days.
export const passwordMinimum = 6
export const hintMaximum = 64

export function newPasswordProblem(password: string, confirm: string): string | null {
  if (!password) return tr('비밀번호를 입력해 주세요.')
  if ([...password].length < passwordMinimum) return tr('비밀번호는 {0}자 이상이어야 해요.', [passwordMinimum])
  if (password !== confirm) return tr('비밀번호가 서로 달라요. 다시 입력해 주세요.')
  return null
}
// B173 (review 10-06 20:4x, the three apps alike): a hint that is the password but for letter case or surrounding
// spaces gives it away all the same, so the two are compared with both set aside. Telegram itself differs here —
// tdesktop compares exactly (settings_cloud_password_hint.cpp:134), Telegram Android ignores case
// (TwoStepVerificationSetupActivity.java:1458-1464) — and Morse takes the side that refuses more.
const hintKey = (value: string): string => value.trim().toLowerCase()
export function hintProblem(hint: string, password: string): string | null {
  const value = hint.trim()
  if ([...value].length > hintMaximum) return tr('힌트는 {0}자까지 쓸 수 있어요.', [hintMaximum])
  if (value && hintKey(value) === hintKey(password)) return tr('힌트는 비밀번호와 달라야 해요.')
  return null
}

// What a refusal says, by the server's reason (morse-two-step.js fail(); the app never shows the message string).
export function twoStepReasonText(reason: string, retryAfterSec?: number): string {
  const wait = retryAfterSec && retryAfterSec > 0 ? waitText(retryAfterSec) : ''
  switch (reason) {
    case 'password-wrong': return wait ? tr('비밀번호가 틀렸어요. {0} 다시 해 주세요.', [wait]) : tr('비밀번호가 틀렸어요.')
    case 'password-flood': case 'rate-limited': return wait ? tr('시도가 너무 많아요. {0} 다시 해 주세요.', [wait]) : tr('시도가 너무 많아요. 잠시 뒤에 다시 해 주세요.')
    case 'reset-too-soon': return tr('재설정은 24시간에 한 번만 요청할 수 있어요.')
    case 'fresh-session': return tr('이 기기에서 로그인한 지 24시간이 지나야 바꿀 수 있어요.')
    case 'check-expired': case 'salt-stale': return tr('시간이 지났어요. 다시 시도해 주세요.')
    case 'two-step-disabled': return tr('지금은 2단계 인증을 켤 수 없어요.')
    case 'password-on': return tr('2단계 인증이 이미 켜져 있어요.')
    case 'password-off': return tr('2단계 인증이 꺼져 있어요.')
    case 'session-revoked': return tr('이 기기의 로그인이 끝났어요. 다시 로그인해 주세요.')
    case 'hint-malformed': return tr('힌트를 확인해 주세요.')
    default: return tr('2단계 인증을 처리하지 못했어요. 잠시 뒤에 다시 해 주세요.')
  }
}
// «5분 뒤» / «1시간 뒤» — when a lock ends, rounded up to whole minutes (or seconds under one); a phrase of its own, as
// languages decline it (ru «через 1 минуту»).
export function waitText(seconds: number): string {
  if (seconds < 60) return tr('{0}초 뒤', [Math.ceil(seconds)])
  const minutes = Math.ceil(seconds / 60)
  if (minutes < 60) return tr('{0}분 뒤', [minutes])
  return tr('{0}시간 뒤', [Math.ceil(minutes / 60)])
}
// The day a requested reset turns the password off, in this window's language.
export function resetDateText(resetAt: number): string {
  return new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeStyle: 'short' }).format(resetAt)
}

// A13-2 ③: what the settings screen shows — whether the account has a password, its hint, a waiting reset's date, and
// whether a new one may be set (app_config/two_step: turning it on waits for the three apps; an account that has one
// can always change it, turn it off and reset it — the server's rule, morse-two-step.js header).
export interface TwoStepSettings { available: boolean; enabled: boolean; hint: string; resetAt: number | null }
// What the settings screen asks for: the current password checked before Manage opens, set, change (with its hint)
// or turn off — the last two proved with the current password again — and the reset's request and cancel.
export type TwoStepRequest =
  | { action: 'verify'; current: string }
  | { action: 'enable'; password: string; hint: string }
  | { action: 'change'; current: string; password: string; hint: string }
  | { action: 'disable'; current: string }
  | { action: 'reset' }
  | { action: 'cancel-reset' }
// Its answer: the state after it, or the server's refusal — its reason, which the screen acts on (a wrong current
// password goes back to asking for it), and its words.
export type TwoStepOutcome = { ok: true; settings: TwoStepSettings } | { ok: false; reason: string; message: string }
