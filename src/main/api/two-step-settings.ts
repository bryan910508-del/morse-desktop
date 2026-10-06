// Portions of this file follow Telegram Desktop (https://github.com/telegramdesktop/tdesktop, 7.2.8, 272f6f5c),
// Copyright (c) 2014-2026 The Telegram Desktop Authors. Licensed under GPL-3.0-or-later; see LEGAL.
import type { AccountAuthorization } from '../messaging/outbox'
import { FirestoreReader } from '../network/firestore-rpc'
import { boolField, documents, timestamp, type FirestoreDocument, type WireObject } from '../network/firestore-values'
import { callMorseFunction } from '../network/morse-callable'
import { hintMaximum, hintProblem, newPasswordProblem, twoStepReasonText, type TwoStepOutcome, type TwoStepSettings } from '../../shared/two-step'
import { TwoStepApi, TwoStepFailure, type TwoStepCall } from './two-step'
import { featureAccessPath, featureOn } from './feature-switch'

// A13-2 ③ (tdesktop settings_privacy_security.cpp:583-602, settings/cloud_password/*): the signed-in account's
// two-step password — read from its own state document (users/{uid}/twoStep/state, owner get) and the switch
// (app_config/two_step), set, changed and turned off with the five calls (./two-step), from this device's session.
// The person's words never leave this process except as the SRP proof.
const resetTime = (doc: FirestoreDocument | null): number | null => {
  const raw = (doc?.fields?.resetAt as { timestampValue?: unknown } | undefined)?.timestampValue
  if (!raw) return null
  try { const at = timestamp(raw, ''); return at.seconds * 1000 + Math.floor(at.nanoseconds / 1e6) || null } catch { return null }
}
// A hint only ever shown: cut to the length the apps allow, never refused (a longer one must not hide the screen).
const shownHint = (value: WireObject | undefined): string => { const raw = (value as { stringValue?: unknown } | undefined)?.stringValue; return typeof raw === 'string' ? [...raw].slice(0, hintMaximum).join('') : '' }
// `access`: this account's own switches (server r35 §1) — a password may also be set while it alone may try it.
export function decodeTwoStepSettings(state: FirestoreDocument | null, gate: FirestoreDocument | null, access: FirestoreDocument | null = null): TwoStepSettings {
  const fields = (state?.fields ?? {}) as Record<string, WireObject>
  const enabled = boolField(fields, 'enabled')
  return { available: featureOn('two_step', gate, access), enabled,
    hint: enabled ? shownHint(fields.hint) : '', resetAt: enabled ? resetTime(state) : null }
}

const text = (value: unknown, max = 1024): string => typeof value === 'string' && value.length <= max ? value : ''

export class TwoStepSettingsApi {
  private readonly api: TwoStepApi
  constructor(private readonly uid: string, private readonly auth: AccountAuthorization, private readonly allowed: () => unknown,
    call: TwoStepCall = (name, data) => callMorseFunction(auth, name, data, AbortSignal.timeout(65000))) {
    this.api = new TwoStepApi((name, data) => { this.allowed(); return call(name, data) })
  }
  // The session the server checks for change and disable (24 hours old) — this device's own.
  private get sessionId(): string { const scope = this.auth.storageScope; return scope.slice(0, scope.lastIndexOf(':')) }

  async state(): Promise<TwoStepSettings> {
    this.allowed()
    const reader = new FirestoreReader(this.auth), signal = AbortSignal.timeout(35000)
    try {
      const [state, gate, access] = await Promise.all([
        reader.getDocument(`${documents}/users/${this.uid}/twoStep/state`, signal),
        reader.getDocument(`${documents}/app_config/two_step`, signal).catch(() => null),
        reader.getDocument(`${documents}/${featureAccessPath(this.uid)}`, signal).catch(() => null)
      ])
      return decodeTwoStepSettings(state, gate, access)
    } finally { reader.close() }
  }

  // The same rules as the screen's (A13-4), held here too: what reaches the proof is a password the rules allow.
  private checked(password: unknown, hint: unknown): { password: string; hint: string } {
    const next = text(password), words = text(hint, 1024)
    const problem = newPasswordProblem(next, next) ?? hintProblem(words, next)
    if (problem) throw new Error(problem)
    return { password: next, hint: words.trim() }
  }
  // A request that may have gone through without its answer is settled by reading the state again (Telegram re-reads
  // account.getPassword after an update fails): when it shows the wanted outcome, it went through.
  private async settle(work: () => Promise<void>, done: (state: TwoStepSettings) => boolean): Promise<TwoStepSettings> {
    try { await work() }
    catch (error) {
      if (!(error instanceof TwoStepFailure) || !error.uncertain) throw error
      const state = await this.state().catch(() => null)
      if (!state || !done(state)) throw error
      return state
    }
    return this.state()
  }

  // Manage opens only for the right current password (tdesktop: account.getPasswordSettings before the section).
  async verify(current: unknown): Promise<TwoStepSettings> {
    const now = text(current)
    if (!now) throw new Error(newPasswordProblem('', '')!)
    await this.api.verify(now)
    return this.state()
  }
  enable(password: unknown, hint: unknown): Promise<TwoStepSettings> {
    const next = this.checked(password, hint)
    return this.settle(() => this.api.enable(next.password, next.hint, this.sessionId), state => state.enabled)
  }
  // Changing it sets the hint as well (Telegram: the hint only changes inside «Change Password»; contract §3-4).
  change(current: unknown, password: unknown, hint: unknown): Promise<TwoStepSettings> {
    const now = text(current), next = this.checked(password, hint)
    if (!now) throw new Error(newPasswordProblem('', '')!)
    return this.settle(() => this.api.change(now, next.password, next.hint, this.sessionId), () => false)
  }
  disable(current: unknown): Promise<TwoStepSettings> {
    const now = text(current)
    if (!now) throw new Error(newPasswordProblem('', '')!)
    return this.settle(() => this.api.disable(now, this.sessionId), state => !state.enabled)
  }
  // One request from the screen; a refusal is answered with its reason rather than thrown, so the screen can act on it.
  async update(raw: unknown): Promise<TwoStepOutcome> {
    const request = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
    try {
      switch (request.action) {
        case 'verify': return { ok: true, settings: await this.verify(request.current) }
        case 'enable': return { ok: true, settings: await this.enable(request.password, request.hint) }
        case 'change': return { ok: true, settings: await this.change(request.current, request.password, request.hint) }
        case 'disable': return { ok: true, settings: await this.disable(request.current) }
        case 'reset': return { ok: true, settings: await this.requestReset() }
        case 'cancel-reset': return { ok: true, settings: await this.cancelReset() }
        default: return { ok: false, reason: 'malformed', message: twoStepReasonText('malformed') }
      }
    } catch (error) {
      if (error instanceof TwoStepFailure) return { ok: false, reason: error.reason, message: error.message }
      throw error
    }
  }
  // «Forgot password?»: the 7-day wait, or — asked again once it is due — the password off.
  async requestReset(): Promise<TwoStepSettings> {
    await this.api.requestReset()
    return this.state()
  }
  cancelReset(): Promise<TwoStepSettings> {
    return this.settle(async () => { await this.api.cancelReset() }, state => state.resetAt === null)
  }
}
