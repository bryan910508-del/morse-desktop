// Portions of this file follow Telegram Desktop (https://github.com/telegramdesktop/tdesktop, 7.2.8, 272f6f5c),
// Copyright (c) 2014-2026 The Telegram Desktop Authors. Licensed under GPL-3.0-or-later; see LEGAL.
import type { PasswordStep } from '../../shared/auth'
import type { AuthTokens } from './contracts'
import { TwoStepFailure, type TwoStepApi } from '../api/two-step'

// A13-2 ② (tdesktop intro_password_check.cpp): the sign-in's password step, whichever way the sign-in came. The held
// token reads the check and proves the password (checkMorsePassword — with a QR attempt's secret, the server writes the
// session it kept back); passed, the new generation's token is what the sign-in goes on with. «Forgot?» asks for the
// 7-day reset (no recovery email): waiting, its date is shown; asked again once due, the password is off.
// Contract §6 (server 10-04): once it is off — the reset done, or found off — the ID token is refreshed before the
// session is asked for (the old one still carries morsePwdSince and would be held again), and a QR attempt goes on
// with the session the reset's answer names (its secret rides on the reset requests).
export type PasswordAction = { kind: 'submit'; password: string } | { kind: 'reset' }
export interface PasswordGate {
  twoStep: Pick<TwoStepApi, 'state' | 'signIn' | 'requestReset'>
  // The custom token checkMorsePassword answers, signed in.
  exchange(customToken: string): Promise<AuthTokens>
  // A forced refresh of the held sign-in's ID token.
  refresh(): Promise<AuthTokens>
  show(step: PasswordStep): void
  // The person's next action on the step; rejects when the sign-in is cancelled.
  action(): Promise<PasswordAction>
  // Throws when the sign-in is no longer the current one.
  current(): void
}
export interface PasswordPassed { tokens: AuthTokens; sessionId: string | null }

// Whether a sign-in token is held for the two-step password — the rules' twoStepPassed (firestore.rules, functions
// morse-two-step-gate.js), read the same way: the account turned the password on (morsePwdSince), this generation was
// made after it (morseAuthTime, else auth_time), and it has not passed (morsePwdOk). A held generation reads nothing in
// Firestore — not even its own users document — so the sign-in goes to the password step before anything is read
// (Telegram: the account is not settled before auth.checkPassword). The server decides; this only keeps the app from
// asking first and failing.
export function heldForPassword(idToken: string): boolean {
  let claims: Record<string, unknown>
  try { claims = JSON.parse(Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<string, unknown> } catch { return false }
  const since = claims.morsePwdSince, made = typeof claims.morseAuthTime === 'number' ? claims.morseAuthTime : claims.auth_time
  return typeof since === 'number' && typeof made === 'number' && made > since && claims.morsePwdOk !== true
}
// A provider's sign-in (Apple, Google): a held generation passes the password step first, and only the token that
// passed reads the Morse profile.
export async function profileAfterPassword<P>(tokens: AuthTokens, pass: (held: AuthTokens) => Promise<AuthTokens>,
  readProfile: (tokens: AuthTokens) => Promise<P>): Promise<{ tokens: AuthTokens; profile: P }> {
  const passed = heldForPassword(tokens.idToken) ? await pass(tokens) : tokens
  return { tokens: passed, profile: await readProfile(passed) }
}

// `needed` null: the step was found by the token, not told by the server — its hint and a waiting reset are read first.
export async function passPassword(gate: PasswordGate, needed: { hint: string; resetAt: number | null } | null, qrSecret?: string): Promise<PasswordPassed> {
  const off = async (sessionId: string | null): Promise<PasswordPassed> => {
    const tokens = await gate.refresh()
    gate.current()
    return { tokens, sessionId }
  }
  let step: PasswordStep = { hint: needed?.hint ?? '', resetAt: needed?.resetAt ?? null, busy: false, error: '' }
  // QR's answer carries no reset date, and a held provider sign-in carries nothing: the step reads the state as
  // Telegram's does (account.getPassword), so the hint and a reset already waiting show. Unread, the step still works —
  // «Forgot?» answers with the date.
  if (qrSecret || !needed) {
    gate.show({ ...step, busy: true })
    const state = await gate.twoStep.state().catch(() => null)
    gate.current()
    if (state && !state.enabled) return off(null)
    if (state?.enabled) step = { ...step, hint: state.hint || step.hint, resetAt: state.resetAt }
  }
  for (;;) {
    gate.show(step)
    const action = await gate.action()
    gate.current()
    step = { ...step, busy: true, error: '' }
    gate.show(step)
    try {
      if (action.kind === 'submit') {
        const passed = await gate.twoStep.signIn(action.password, qrSecret)
        gate.current()
        return { tokens: await gate.exchange(passed.customToken), sessionId: passed.sessionId }
      }
      const reset = await gate.twoStep.requestReset(qrSecret)
      gate.current()
      if (reset.state === 'done') return off(reset.sessionId)
      // 'none': the password is already off (turned off or reset elsewhere; server morse-two-step.js requestReset) —
      // nothing is held any more, the same as password-off. Only 'waiting' stays on the step, with its date.
      if (reset.state === 'none') return off(null)
      step = { ...step, busy: false, resetAt: reset.resetAt }
    } catch (error) {
      if (!(error instanceof TwoStepFailure)) throw error
      // The password went off meanwhile (a reset that came due, another device): nothing is held any more.
      if (error.reason === 'password-off') return off(null)
      step = { ...step, busy: false, error: error.message }
    }
  }
}
