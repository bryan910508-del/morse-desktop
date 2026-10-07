// Portions of this file follow Telegram Desktop (https://github.com/telegramdesktop/tdesktop, 7.2.8, 272f6f5c),
// Copyright (c) 2014-2026 The Telegram Desktop Authors. Licensed under GPL-3.0-or-later; see LEGAL.
import type { AccountProfile } from '../../shared/model'
import type { AuthPhase, AuthenticationSnapshot, AccountCreationResult } from '../../shared/auth'
import type { AccountAuthorization } from '../messaging/outbox'
import { AuthenticationController, type AuthenticatedAccountHooks } from './controller'
import { AuthenticationFailure, type DesktopAuthConfiguration } from './contracts'
import type { CredentialVault } from './credential-vault'
import { tr } from '../../shared/i18n'
import { recordConnectionStep } from '../platform/connection-diagnostics'
import { reachability } from '../network/reachability'
import { restoreRetryDelay } from './restore-retry'
import { FirebaseAuthenticationAPI } from './firebase-rest'
import { SessionEnders } from './session-enders'

export interface DomainHooks extends Omit<AuthenticatedAccountHooks, 'activated' | 'endSession' | 'endSessionsNow'> {
  activated(profile: AccountProfile, credentials: AccountAuthorization, makeActive: boolean): void
  maxAccounts(): number
  activeUid(): string | null
}
export interface DomainAccountState { uid: string; userId: string; displayName: string; phase: AuthPhase; message: string; banned?: boolean; updateRequired?: boolean }


// Main::Domain: every saved account keeps its own authentication and connection. One more
// controller runs "Add Account" (or the first sign-in) until its account is saved.
export class AuthenticationDomain {
  private readonly controllers = new Map<string, AuthenticationController>()
  private readonly profiles = new Map<string, AccountProfile>()
  private readonly retries = new Map<string, { attempt: number; timer: NodeJS.Timeout | null }>()
  private adding: AuthenticationController | null = null
  private pendingUid: string | null = null
  private requested = false
  private preferred: string | null = null
  private suspended: string[] | null = null
  private closed = false
  // B182: the QR switch as last read, for the next sign-in screen (null until read; unreadable stays unknown = not drawn).
  private qrKnown: boolean | null = null
  constructor(private readonly configuration: DesktopAuthConfiguration | null, private readonly vault: CredentialVault,
    private readonly version: string, private readonly changed: () => void, private readonly hooks: DomainHooks) {
    // tdesktop keeps one instance for keys to destroy beside the accounts' own (Main::Account::_mtpForKeysDestroy).
    this.enders = new SessionEnders({ read: () => vault.endingSessions(), write: list => vault.saveEndingSessions(list) },
      configuration ? new FirebaseAuthenticationAPI(configuration) : null, uid => vault.read(uid).then(record => record?.sessionId ?? null))
    this.unsubscribe = reachability.subscribe(reason => { this.restoreNow(reason); this.enders.runNow() })
    this.enders.runNow()
    // Read once at start, so «계정 추가» opened later already knows whether its QR is drawn.
    this.readQrSwitch()
  }
  private readonly enders: SessionEnders
  private readonly unsubscribe: () => void

  get available(): boolean { return this.configuration !== null }
  // app_config read before any sign-in, with this app's proof only (the version gate, platform/app-version-gate.ts).
  private publicApi: FirebaseAuthenticationAPI | null = null
  publicConfig(name: 'desktop', signal: AbortSignal): Promise<Record<string, unknown> | null> {
    if (!this.configuration) return Promise.resolve(null)
    this.publicApi ??= new FirebaseAuthenticationAPI(this.configuration)
    return this.publicApi.publicConfig(name, signal)
  }
  private create(uid: string | null): AuthenticationController {
    const controller: AuthenticationController = new AuthenticationController(this.configuration, this.vault, this.version, () => this.controllerChanged(controller), {
      activated: (profile, credentials) => {
        this.profiles.set(profile.uid, { ...profile })
        // An added account is shown at once (Domain::addActivated); a saved one only when it was the one shown.
        if (uid === null) this.preferred = profile.uid
        this.hooks.activated(profile, credentials, profile.uid === this.preferred)
      },
      connection: (account, state) => this.hooks.connection(account, state),
      closed: (account, purge) => this.hooks.closed(account, purge),
      notificationHint: (account, hint) => this.hooks.notificationHint(account, hint),
      reactionUpdated: (account, body) => this.hooks.reactionUpdated(account, body),
      endSession: entry => this.enders.add(entry),
      endSessionsNow: () => this.enders.runNow(),
      qrSwitch: { known: () => this.qrKnown, changed: on => { this.qrKnown = on } }
    }, uid, { admit: next => this.admit(next), admitNew: () => this.admitNew(), creationToken: signal => this.creationToken(signal) })
    return controller
  }
  private controllerChanged(controller: AuthenticationController): void {
    const uid = controller.uid
    if (!this.closed && uid && this.adding === controller) {
      // The new account's credential is saved: it joins the device's accounts, replacing a
      // disconnected entry of the same account.
      const old = this.controllers.get(uid)
      this.controllers.set(uid, controller)
      this.adding = null
      this.pendingUid = uid
      if (old && old !== controller) void old.close().catch(() => {})
    }
    if (!this.closed && uid && this.controllers.get(uid) === controller) {
      const snapshot = controller.snapshot
      if (snapshot.account) this.profiles.set(uid, { ...snapshot.account })
      if (controller.connected) {
        this.clearRetry(uid)
        if (this.pendingUid === uid) { this.pendingUid = null; this.requested = false }
      } else if (snapshot.phase === 'signed-out') {
        // Signed out, a cancelled first connection or a missing record: the row stays only while its credential exists.
        void this.vault.read(uid).then(record => {
          if (record === null && this.controllers.get(uid) === controller && !controller.connected) this.forget(uid)
        }, () => {})
      } else if (snapshot.phase === 'error' && controller.lastFailure === 'network' && this.pendingUid !== uid) {
        this.scheduleRetry(uid, controller)
      }
    }
    this.changed()
  }
  private scheduleRetry(uid: string, controller: AuthenticationController): void {
    if (this.suspended) return
    const state = this.retries.get(uid) ?? { attempt: 0, timer: null }
    this.retries.set(uid, state)
    if (state.timer) return
    const delay = restoreRetryDelay(state.attempt)
    recordConnectionStep('restore-wait', `${delay / 1000}s`)
    state.timer = setTimeout(() => {
      state.timer = null; state.attempt++
      if (!this.closed && !this.suspended && this.controllers.get(uid) === controller && !controller.connected) void controller.restore().catch(() => {})
    }, delay)
  }
  // The network is back: an account waiting out its wait to reconnect reconnects now, and its waits start over.
  private restoreNow(reason: string): void {
    if (this.closed || this.suspended) return
    for (const [uid, controller] of this.controllers) {
      const state = this.retries.get(uid)
      if (!state?.timer || controller.connected) continue
      recordConnectionStep('restore-now', reason)
      this.clearRetry(uid)
      void controller.restore().catch(() => {})
    }
  }
  private clearRetry(uid: string): void {
    const state = this.retries.get(uid)
    if (state?.timer) clearTimeout(state.timer)
    this.retries.delete(uid)
  }
  private forget(uid: string): void {
    this.controllers.delete(uid); this.profiles.delete(uid); this.clearRetry(uid)
    if (this.pendingUid === uid) this.pendingUid = null
    this.changed()
  }
  private admit(uid: string): void {
    const existing = this.controllers.get(uid)
    if (existing?.connected) throw new AuthenticationFailure('already-added')
    // A saved account that is not connected can sign in again with its recovery code.
    if (existing) { void existing.cancel().catch(() => {}); return }
    this.admitNew()
  }
  private admitNew(): void { if (this.controllers.size >= this.hooks.maxAccounts()) throw new AuthenticationFailure('device-limit') }
  private async creationToken(signal: AbortSignal): Promise<string | null> {
    const uid = this.hooks.activeUid(), controller = uid ? this.controllers.get(uid) : undefined
    return controller ? controller.creationIdToken(signal).catch(() => null) : null
  }

  // Telegram reconnects every saved account at start, the last shown one first.
  // The saved accounts are known before their local data can be opened, so a forgotten local passcode can still sign
  // them out (Domain::start waits for the passcode before any account starts).
  async prepare(): Promise<string[]> {
    const order = await this.vault.list().catch(() => [] as string[])
    this.preferred = await this.vault.active().catch(() => null)
    for (const uid of order) {
      if (this.controllers.has(uid) || this.closed) continue
      const record = await this.vault.read(uid).catch(() => null)
      if (record) this.profiles.set(uid, { ...record.profile })
      this.controllers.set(uid, this.create(uid))
    }
    this.changed()
    return order
  }
  async start(): Promise<void> {
    const order = await this.prepare()
    const first = this.preferred && this.controllers.has(this.preferred) ? this.preferred : order[0]
    if (first) await this.controllers.get(first)?.restore().catch(() => {})
    for (const uid of order) if (uid !== first && !this.closed) void this.controllers.get(uid)?.restore().catch(() => {})
  }
  get addingRequested(): boolean { return this.requested }
  // A13-2 ②: the password step belongs to the sign-in that waits for it — the one being added, or a saved account's
  // restore that was left there (the app closed before the password passed) — and it is what the entry screen shows.
  private waitingForPassword(): AuthenticationController | null {
    if (this.adding?.snapshot.phase === 'password') return this.adding
    return [...this.controllers.values()].find(controller => controller.snapshot.phase === 'password') ?? null
  }
  async submitPassword(password: unknown): Promise<void> { await this.waitingForPassword()?.submitPassword(password) }
  async requestPasswordReset(): Promise<void> { await this.waitingForPassword()?.requestPasswordReset() }
  get entrySnapshot(): AuthenticationSnapshot {
    const waiting = this.waitingForPassword()
    if (waiting) return waiting.snapshot
    if (this.adding) return this.adding.snapshot
    const pending = this.pendingUid ? this.controllers.get(this.pendingUid) : undefined
    if (pending && !pending.connected) return pending.snapshot
    // B182: before the screen's QR start makes its controller, the screen still says whether its QR is drawn — by the
    // switch as last read, unknown being «not drawn» — so the QR area does not appear for the moment until it is made.
    return { available: this.available, phase: this.available ? 'signed-out' : 'unavailable', account: null,
      message: this.available ? tr('복구 코드로 기존 계정을 연결하세요.') : tr('Desktop 계정 연결을 준비하고 있습니다.'),
      qrOff: this.qrKnown !== true }
  }
  states(): DomainAccountState[] {
    return [...this.controllers.entries()].map(([uid, controller]) => {
      const snapshot = controller.snapshot, profile = snapshot.account ?? this.profiles.get(uid)
      return { uid, userId: profile?.userId ?? '', displayName: profile?.displayName ?? '', phase: snapshot.phase, message: snapshot.phase === 'signed-in' ? '' : snapshot.message, ...(snapshot.banned ? { banned: true } : {}),
        ...(snapshot.updateRequired ? { updateRequired: true } : {}) }
    })
  }
  // The account the user chose to see; it stays shown when it reconnects.
  select(uid: string): void { this.preferred = uid }
  beginAdd(): void {
    if (this.closed) return
    if (this.controllers.size >= this.hooks.maxAccounts()) throw new AuthenticationFailure('device-limit')
    this.requested = true; this.pendingUid = null
    // Not known on (unread, unreadable, or off when last read): read again — the screen draws the QR once it is on.
    if (this.qrKnown !== true) this.readQrSwitch()
    this.changed()
  }
  // B182: the QR switch read for the sign-in screens (A13 D-6: off or unreadable draws nothing). The screen starts its QR
  // only once this — or its own controller — says on.
  private qrReading = false
  private readQrSwitch(): void {
    if (!this.configuration || this.qrReading || this.closed) return
    this.qrReading = true
    this.publicApi ??= new FirebaseAuthenticationAPI(this.configuration)
    void this.publicApi.qrLoginEnabled(AbortSignal.timeout(15000)).then(on => {
      if (this.closed || this.qrKnown === on) return
      this.qrKnown = on
      this.adding?.qrSwitchKnown(on)
      this.changed()
    }).catch(() => {}).finally(() => { this.qrReading = false })
  }
  async cancelAdd(): Promise<void> {
    const adding = this.adding
    if (adding) await adding.cancel()
    if (this.adding === adding) this.adding = null
    this.requested = false; this.pendingUid = null
    this.changed()
  }
  private entry(): AuthenticationController {
    if (this.closed) throw new AuthenticationFailure('unavailable')
    this.adding ??= this.create(null)
    return this.adding
  }
  // Another way in stops a QR code on screen first (A13: the code is the first step, not a lock on the screen).
  async signIn(code: unknown): Promise<void> { const entry = this.entry(); await entry.stopQr(); return entry.signIn(code) }
  async createAccount(userId: unknown): Promise<AccountCreationResult | null> { const entry = this.entry(); await entry.stopQr(); return entry.createAccount(userId) }
  async signInWithApple(): Promise<void> { const entry = this.entry(); await entry.stopQr(); return entry.signInWithApple() }
  async signInWithGoogle(): Promise<void> { const entry = this.entry(); await entry.stopQr(); return entry.signInWithGoogle() }
  // A13: the QR code of the sign-in screen. The accounts connected here are left out (Telegram except_ids).
  signInWithQr(): Promise<void> {
    const connected = [...this.controllers.entries()].filter(([, controller]) => controller.connected).map(([uid]) => uid)
    return this.entry().signInWithQr(connected)
  }
  async stopQr(): Promise<void> { await this.adding?.stopQr() }
  async retrySecurityCheck(): Promise<boolean> { return await this.adding?.retrySecurityCheck() ?? false }
  async cancel(): Promise<void> {
    await this.adding?.cancel()
    const pending = this.pendingUid ? this.controllers.get(this.pendingUid) : undefined
    if (pending && !pending.connected) await pending.cancel()
  }
  restore(uid: string): Promise<void> {
    const controller = this.controllers.get(uid)
    if (!controller) throw new AuthenticationFailure('unavailable')
    this.preferred = uid
    this.clearRetry(uid)
    return controller.restore()
  }
  async signOut(uid: string): Promise<void> {
    const controller = this.controllers.get(uid)
    if (!controller) return
    this.clearRetry(uid)
    await controller.signOut()
    if (this.controllers.get(uid) === controller) this.forget(uid)
  }
  async signOutAll(): Promise<void> {
    await this.adding?.cancel(); this.adding = null; this.requested = false; this.pendingUid = null
    for (const uid of [...this.controllers.keys()]) await this.signOut(uid)
  }
  async forgetDeleted(uid: string): Promise<void> {
    const controller = this.controllers.get(uid)
    if (!controller) return
    await controller.forgetDeletedAccount()
    if (this.controllers.get(uid) === controller) this.forget(uid)
  }
  private all(): AuthenticationController[] { return [...this.controllers.values(), ...(this.adding ? [this.adding] : [])] }
  suspend(): void {
    this.suspended = [...this.controllers.entries()].filter(([, controller]) => !controller.connected && ['restoring', 'connecting'].includes(controller.snapshot.phase)).map(([uid]) => uid)
    for (const state of this.retries.values()) if (state.timer) { clearTimeout(state.timer); state.timer = null }
    for (const controller of this.all()) controller.suspend()
  }
  // After sleep, connections cut off while connecting and accounts waiting to reconnect try again.
  resume(): void {
    const interrupted = this.suspended ?? []
    this.suspended = null
    for (const controller of this.all()) controller.resume()
    for (const [uid, controller] of this.controllers) {
      if (this.closed || controller.connected || (!interrupted.includes(uid) && !this.retries.has(uid))) continue
      this.clearRetry(uid)
      void controller.restore().catch(() => {})
    }
  }
  async close(): Promise<void> {
    this.closed = true
    this.unsubscribe()
    this.enders.close()
    for (const uid of [...this.retries.keys()]) this.clearRetry(uid)
    await Promise.all(this.all().map(controller => controller.close()))
  }
}
