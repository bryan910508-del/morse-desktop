import { generateKeyPairSync, randomInt } from 'node:crypto'
import type { AuthenticationSnapshot, QrSignIn } from '../../shared/auth'
import { morseUserId, morseUserIdAlphabet, normalizeBackupCode, qrLoginLink, type AccountCreationResult } from '../../shared/auth'
import type { AccountProfile, ConnectionState } from '../../shared/model'
import type { NotificationHint } from '../../shared/notifications'
import type { AccountAuthorization } from '../messaging/outbox'
import { NotEmitted } from '../network/contracts'
import { FirestoreReader } from '../network/firestore-rpc'
import { documents, ReadFailure, stringField } from '../network/firestore-values'
import { SocketMessageTransport } from '../network/socket-transport'
import { watchSignIn } from './sign-in-watch'
import { callMorseFunction } from '../network/morse-callable'
import { markReadWithFallback, sendWithFallback, type CallablePath, type SocketPath } from '../messaging/send-fallback'
import { purgesAccountData, registrationOutcome, rejectionFailure } from '../network/registration-outcome'
import { AuthenticationFailure, asAuthFailure, tokenFailureEffect, type AuthFailureCode, type AuthTokens, type DesktopAuthConfiguration, type SavedCredential } from './contracts'
import { CredentialVault } from './credential-vault'
import { DeviceIdentity } from './device-identity'
import { generateBackupCode } from './backup-code'
import { authorizeWithApple } from './apple-authorization'
import { FirebaseAuthenticationAPI } from './firebase-rest'
import { newQrAttempt, qrAttemptLifetimeMs, qrPollMs, type QrRedeem } from './qr-login'
import { recordConnectionStep, recordRetry, recordSignOutBasis } from '../platform/connection-diagnostics'
import { tr } from '../../shared/i18n'

// A Curve25519 key pair in the base64 form iOS CryptoService stores and the server keeps as publicKey.
function newKeypair(): { publicKey: string; privateKey: string } {
  const jwk = generateKeyPairSync('x25519').privateKey.export({ format: 'jwk' }) as { x?: string; d?: string }
  if (!jwk.x || !jwk.d) throw new AuthenticationFailure('protocol')
  return { publicKey: Buffer.from(jwk.x, 'base64url').toString('base64'), privateKey: Buffer.from(jwk.d, 'base64url').toString('base64') }
}

interface CredentialOwner {
  controller: AbortController
  record: SavedCredential
  tokens: AuthTokens
  transport: SocketMessageTransport
  refresh: Promise<string> | null
  established: boolean
  // startMorseDeviceSession answered «session-revoked» when a socket refusal was checked (A5 contract §3-1).
  revokedByServer?: boolean
  rejection: string
  // A15-5: the sign-in watch (sign-in-watch.ts) is asking the server now.
  checking?: boolean
}

export interface AuthenticatedAccountHooks {
  activated(profile: AccountProfile, credentials: AccountAuthorization): void
  connection(uid: string, state: ConnectionState): void
  closed(uid: string, purge: boolean): void
  notificationHint(uid: string, hint: NotificationHint): void
  // A message's full reaction state from the socket (reactionUpdated).
  reactionUpdated(uid: string, body: unknown): void
}
// Main::Domain decides whether another account fits on this device and supplies the
// signed-in account's token for creating one.
export interface AccountAdmission {
  admit(uid: string): void
  admitNew(): void
  creationToken(signal: AbortSignal): Promise<string | null>
}

// Stand-ins for the unit tests: how the socket is made, and how the sign-in is watched (sign-in-watch.ts).
export interface AuthenticationSeams {
  openSocket?: ConstructorParameters<typeof SocketMessageTransport>[2]
  watchSignIn?: typeof watchSignIn
}

// Authentication owns the only protocol-2 connection for registration and server
// revocation monitoring. Account readers consume its verified lifetime.
export class AuthenticationController {
  private readonly api: FirebaseAuthenticationAPI | null
  // A16: where a signed-in account offers its session to prove this app.
  private readonly proofSessions: DesktopAuthConfiguration['proof'] | null
  private readonly identity: DeviceIdentity
  private value: AuthenticationSnapshot
  private operation: AbortController | null = null
  private owner: CredentialOwner | null = null
  private closed = false
  private loggingOut = false
  private operationTask: Promise<void> | null = null
  private newlySavedOperation: AbortController | null = null
  private logoutTask: Promise<void> | null = null
  private logoutAbort: AbortController | null = null
  private failure: AuthFailureCode | null = null
  // The account this operation is about, once known (the recovery code's answer, or the saved sign-in): a ban refused
  // after that point still names it in the «도움» mail. Never the code itself.
  private known: AccountProfile | null = null
  // A13: the QR code on screen (the link and what it waits for), and the operation a quiet stop ends.
  private qr: QrSignIn | null = null
  private qrOperation: AbortController | null = null
  private qrOff = false
  private quietStop: AbortController | null = null

  constructor(configuration: DesktopAuthConfiguration | null, private readonly vault: CredentialVault,
    private readonly version: string, private readonly changed: () => void, private readonly accounts: AuthenticatedAccountHooks,
    private boundUid: string | null = null, private readonly admission: AccountAdmission | null = null,
    private readonly seams: AuthenticationSeams = {}) {
    this.api = configuration ? new FirebaseAuthenticationAPI(configuration) : null
    this.proofSessions = configuration?.proof ?? null
    this.identity = new DeviceIdentity(vault.location)
    this.value = { available: this.api !== null, phase: this.api ? 'signed-out' : 'unavailable', account: null,
      message: this.api ? tr('복구 코드로 기존 계정을 연결하세요.') : tr('Desktop 계정 연결을 준비하고 있습니다.') }
  }
  get uid(): string | null { return this.boundUid }
  get connected(): boolean { return Boolean(this.owner?.established) }
  // Why the last connection attempt or connection ended, for the domain's reconnect decision.
  get lastFailure(): AuthFailureCode | null { return this.failure }
  get snapshot(): AuthenticationSnapshot { return { ...this.value, account: this.value.account ? { ...this.value.account } : null, ...(this.qr ? { qr: { ...this.qr } } : {}), ...(this.qrOff ? { qrOff: true } : {}) } }
  private showQr(qr: QrSignIn | null): void { this.qr = qr; this.changed() }
  private set(phase: AuthenticationSnapshot['phase'], message: string, owner: CredentialOwner | null = null): void {
    const banned = phase === 'error' && this.failure === 'banned'
    const account = owner ? owner.record.profile : banned ? this.known : null
    this.value = { available: this.api !== null, phase, message, account: account ? { ...account } : null, ...(banned ? { banned: true } : {}) }
    this.changed()
  }
  private requireAPI(): FirebaseAuthenticationAPI {
    if (!this.api || this.closed) throw new AuthenticationFailure('unavailable')
    return this.api
  }
  private assertCurrent(controller: AbortController): void {
    if (this.closed || controller.signal.aborted || this.operation !== controller) throw new AuthenticationFailure('cancelled')
  }
  private async operationScope(restoring: boolean, execute: (api: FirebaseAuthenticationAPI, controller: AbortController) => Promise<void>, message?: string): Promise<void> {
    const api = this.requireAPI()
    if (this.operation || this.owner || this.loggingOut) throw new AuthenticationFailure('unavailable')
    const controller = new AbortController()
    this.operation = controller
    this.failure = null
    this.known = null
    this.set(restoring ? 'restoring' : 'verifying', restoring ? tr('저장된 계정을 확인하고 있습니다.') : message ?? tr('복구 코드를 확인하고 있습니다.'))
    const task = (async () => {
      try {
        await this.vault.ready()
        this.assertCurrent(controller)
        await execute(api, controller)
      } catch (error) {
        const failure = controller.signal.aborted ? new AuthenticationFailure('cancelled') : asAuthFailure(error)
        if (this.owner?.controller === controller) this.detach()
        if (this.operation === controller && !this.closed) {
          if (failure.code === 'revoked' || failure.code === 'invalid-credential') noteSignOut(`${restoring ? 'restore' : 'sign-in'} ${failure.code}`)
          if (failure.code === 'revoked' || failure.code === 'invalid-credential' ||
              (failure.code === 'cancelled' && this.newlySavedOperation === controller)) {
            try { if (this.boundUid) await this.vault.remove(this.boundUid) }
            catch { this.set('error', new AuthenticationFailure('storage').message); return }
          }
          this.failure = failure.code
          // A QR code stopped because the screen went away is not «cancelled» for the person: the screen is as before.
          const quiet = failure.code === 'cancelled' && this.quietStop === controller
          this.set(failure.code === 'cancelled' ? 'signed-out' : 'error', quiet ? tr('복구 코드로 기존 계정을 연결하세요.') : failure.message)
        }
      } finally {
        if (this.operation === controller) this.operation = null
        if (this.newlySavedOperation === controller) this.newlySavedOperation = null
        if (this.qrOperation === controller) { this.qrOperation = null; this.showQr(null) }
        if (this.quietStop === controller) this.quietStop = null
      }
    })()
    this.operationTask = task
    try { await task }
    finally { if (this.operationTask === task) this.operationTask = null }
  }
  async signIn(rawCode: unknown): Promise<void> {
    const code = normalizeBackupCode(rawCode)
    await this.operationScope(false, async (api, controller) => {
      const stored = this.boundUid ? await this.vault.read(this.boundUid) : null
      this.assertCurrent(controller)
      const verified = await api.verifyBackupCode(code, controller.signal)
      this.assertCurrent(controller)
      // A saved account reconnects only as itself; a new one must fit the device's account limit.
      if (stored && stored.profile.uid !== verified.profile.uid) throw new AuthenticationFailure('unavailable')
      this.known = verified.profile
      if (!this.boundUid) this.admission?.admit(verified.profile.uid)
      // Signing in again to a saved account keeps its device session ID.
      const previous = stored ?? (this.boundUid ? null : await this.vault.read(verified.profile.uid).catch(() => null))
      this.assertCurrent(controller)
      const tokens = await api.exchange(verified.customToken, verified.profile.uid, controller.signal)
      this.assertCurrent(controller)
      const record: SavedCredential = { version: 1, profile: verified.profile,
        sessionId: await this.identity.sessionId(verified.profile.uid, previous?.sessionId), refreshToken: tokens.refreshToken, authTime: tokens.authTime }
      // The stable session ID must survive an unknown startSession response.
      // A stored credential is only a restore candidate, never authorization.
      await this.vault.save(record)
      this.boundUid = record.profile.uid
      this.newlySavedOperation = controller
      this.assertCurrent(controller)
      await this.establish(api, controller, record, tokens)
    })
  }
  // A13 · 08 §3.1 (Telegram's first sign-in step is the QR code, tdesktop intro/intro_qr.cpp): a code for this computer,
  // renewed every 30 s and polled every 2 s, that a phone of the account approves at once. Approved, the sign-in goes the
  // way a recovery code's does (exchange, the session the server made, establish); a two-step password stops at its
  // screen (§24). While it waits the sign-in screen stays usable — another way in stops it first (the domain).
  async signInWithQr(exceptUids: string[]): Promise<void> {
    await this.operationScope(false, async (api, controller) => {
      this.qrOperation = controller
      const stored = this.boundUid ? await this.vault.read(this.boundUid) : null
      for (;;) {
        this.assertCurrent(controller)
        const enabled = await api.qrLoginEnabled(controller.signal)
        this.assertCurrent(controller)
        // Switched off: the code area goes away, quietly — not a failure the person has to read.
        if (this.qrOff !== !enabled) { this.qrOff = !enabled; this.changed() }
        if (!enabled) { this.quietStop = controller; throw new AuthenticationFailure('cancelled') }
        this.set('signed-out', tr('복구 코드로 기존 계정을 연결하세요.'))
        const outcome = await this.qrRound(api, controller, exceptUids)
        if (!outcome) continue
        if (outcome.state === 'password-needed') {
          this.showQr({ state: 'password-needed', hint: outcome.hint })
          await new Promise<void>(resolve => controller.signal.addEventListener('abort', () => resolve(), { once: true }))
          this.assertCurrent(controller)
          return
        }
        const { profile, customToken, sessionId } = outcome
        this.showQr(null)
        // Whose account came in is said by name (08 §3.5): a third party who scanned this screen is seen at once.
        this.set('verifying', tr('@{0} 계정으로 연결하고 있습니다.', [profile.userId]))
        if (stored && stored.profile.uid !== profile.uid) throw new AuthenticationFailure('unavailable')
        this.known = profile
        if (!this.boundUid) this.admission?.admit(profile.uid)
        const tokens = await api.exchange(customToken, profile.uid, controller.signal)
        this.assertCurrent(controller)
        // The server made this session when it handed over the sign-in (08 §3.7): its id is the one used.
        const record: SavedCredential = { version: 1, profile, sessionId, refreshToken: tokens.refreshToken, authTime: tokens.authTime, provider: 'qr' }
        await this.vault.save(record)
        this.boundUid = record.profile.uid
        this.newlySavedOperation = controller
        this.assertCurrent(controller)
        await this.establish(api, controller, record, tokens)
        return
      }
    }, tr('QR 코드를 준비하고 있습니다.'))
  }
  // One attempt: a secret, its codes, the polls. Over (ten minutes, or the server's «expired») → null, a new attempt.
  private async qrRound(api: FirebaseAuthenticationAPI, controller: AbortController, exceptUids: string[]): Promise<Exclude<QrRedeem, { state: 'waiting' }> | null> {
    const attempt = newQrAttempt(), signal = controller.signal
    let settled = false, refreshAt = 0, poll = qrPollMs
    const issue = async (): Promise<void> => {
      const code = await api.issueLoginCode(attempt.binding, exceptUids, this.version, signal)
      this.assertCurrent(controller)
      if (code.state === 'pending') { this.showQr({ state: 'code', link: qrLoginLink(code.token) }); refreshAt = Date.now() + code.refreshAfterMs }
      else { refreshAt = Number.POSITIVE_INFINITY; poll = code.pollAfterMs }
    }
    try {
      this.showQr({ state: 'preparing' })
      await issue()
      for (;;) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, poll)
          signal.addEventListener('abort', () => { clearTimeout(timer); reject(new AuthenticationFailure('cancelled')) }, { once: true })
        })
        this.assertCurrent(controller)
        const answer = await api.redeemLoginCode(attempt.secret, signal)
        this.assertCurrent(controller)
        if (answer.state !== 'waiting') { settled = true; return answer }
        poll = answer.pollAfterMs
        if (Date.now() - attempt.startedAt >= qrAttemptLifetimeMs) return null
        if (Date.now() >= refreshAt) await issue()
      }
    } catch (error) {
      if (error instanceof AuthenticationFailure && error.code === 'qr-expired') return null
      if (error instanceof AuthenticationFailure && error.code === 'qr-disabled') { this.qrOff = true; this.quietStop = controller; throw new AuthenticationFailure('cancelled') }
      throw error
    } finally {
      // An attempt left behind is ended on the server too (it would expire anyway).
      if (!settled) void api.cancelLoginCode(attempt.secret, AbortSignal.timeout(5000)).catch(() => {})
    }
  }
  // The sign-in screen went away (hidden, closed, another way chosen): the QR attempt ends without a word.
  async stopQr(): Promise<void> {
    const operation = this.qrOperation
    if (!operation || this.operation !== operation) return
    this.quietStop = operation
    operation.abort()
    await this.operationTask
  }
  // Onboarding sign-up (iOS AuthService.signUp): the server creates the user from an
  // eight-character ID, a new recovery code and a Curve25519 public key, then returns
  // a custom token that signs in like a recovery code.
  async createAccount(rawUserId: unknown): Promise<AccountCreationResult | null> {
    const userId = morseUserId(rawUserId)
    let created: AccountCreationResult | null = null
    await this.operationScope(false, async (api, controller) => {
      // Main::Domain::addActivated: a new account must fit the device's account limit.
      if (this.boundUid) throw new AuthenticationFailure('saved-account')
      this.admission?.admitNew()
      const backupCode = generateBackupCode()
      const pair = newKeypair()
      const deviceVendorId = await this.identity.vendorId()
      this.assertCurrent(controller)
      // A signed-in account's token lets the server apply that account's premium slots (iOS additionalAccount).
      const creator = await this.admission?.creationToken(controller.signal).catch(() => null) ?? null
      this.assertCurrent(controller)
      const account = await api.createAccount({ userId, backupCode, publicKey: pair.publicKey, deviceVendorId }, controller.signal, creator)
      // From here the account exists: the recovery code must reach the user even if connecting fails.
      const result: AccountCreationResult = { userId, backupCode, connected: false }
      created = result
      await this.identity.saveKeypair(account.uid, pair).catch(() => {})
      this.assertCurrent(controller)
      const tokens = await api.exchange(account.customToken, account.uid, controller.signal)
      this.assertCurrent(controller)
      const record: SavedCredential = { version: 1, profile: { uid: account.uid, userId, displayName: userId },
        sessionId: await this.identity.sessionId(account.uid), refreshToken: tokens.refreshToken, authTime: tokens.authTime }
      await this.vault.save(record)
      this.boundUid = record.profile.uid
      this.newlySavedOperation = controller
      this.assertCurrent(controller)
      await this.establish(api, controller, record, tokens)
      result.connected = true
    }, tr('Morse 계정을 만들고 있습니다.'))
    return created
  }
  // iOS OnboardingView.handleAppleSignIn: Apple's sign-in, then Firebase. A Firebase user that already has a
  // Morse profile connects as that account; otherwise the server makes one with a new anonymous ID, key pair
  // and recovery code, and iOS keeps that code without showing it (AuthService.completeAppleSignupProfile).
  async signInWithApple(): Promise<void> {
    await this.operationScope(false, async (api, controller) => {
      if (this.boundUid) throw new AuthenticationFailure('saved-account')
      // How long a sign-in takes, step by step, so a slow one can be told apart from a slow link.
      // Only the seconds each step took; nothing of the account is written.
      let step = Date.now()
      const took = (name: string): void => { recordConnectionStep(name, `${Date.now() - step}ms`); step = Date.now() }
      const apple = await authorizeWithApple(controller.signal)
      took('sign-in-apple')
      this.assertCurrent(controller)
      this.set('verifying', tr('Apple 계정을 확인하고 있습니다.'))
      let tokens = await api.signInWithApple(apple, controller.signal)
      took('sign-in-firebase')
      this.assertCurrent(controller)
      let profile = await this.morseProfile(api, tokens, controller.signal)
      took('sign-in-profile')
      this.assertCurrent(controller)
      if (profile) this.admission?.admit(profile.uid)
      else {
        this.admission?.admitNew()
        // completeAppleSignupProfile: «already exists» also means this user's profile was just made.
        const complete = async (): Promise<AccountProfile> => {
          let userId = ''
          while (userId.length < 8) userId += morseUserIdAlphabet[randomInt(morseUserIdAlphabet.length)]
          const pair = newKeypair(), backupCode = generateBackupCode(), deviceVendorId = await this.identity.vendorId()
          this.assertCurrent(controller)
          try { await api.completeProfile({ userId, backupCode, publicKey: pair.publicKey, deviceVendorId }, tokens.idToken, controller.signal) }
          catch (error) {
            if (asAuthFailure(error).code !== 'id-taken') throw error
            const existing = await this.morseProfile(api, tokens, controller.signal)
            if (!existing) throw error
            return existing
          }
          await this.identity.saveKeypair(tokens.uid, pair).catch(() => {})
          await this.vault.saveBackupCode(tokens.uid, backupCode).catch(() => {})
          return { uid: tokens.uid, userId, displayName: userId }
        }
        try { profile = await complete() }
        catch (error) {
          // completeAppleSignupProfileRetryingStaleIdentity: the server removed a withdrawn account's leftover
          // Firebase user, so the same Apple answer signs in once more as a new one.
          if (asAuthFailure(error).code !== 'stale-identity') throw error
          this.assertCurrent(controller)
          tokens = await api.signInWithApple(apple, controller.signal)
          this.assertCurrent(controller)
          profile = await complete()
        }
        this.assertCurrent(controller)
        // iOS reads a fresh ID token once the profile exists.
        tokens = await api.refresh(tokens.refreshToken, tokens.uid, tokens.authTime, controller.signal)
      }
      this.assertCurrent(controller)
      // Signing in again to a saved account keeps its device session ID.
      const previous = await this.vault.read(profile.uid).catch(() => null)
      this.assertCurrent(controller)
      const record: SavedCredential = { version: 1, profile, sessionId: await this.identity.sessionId(profile.uid, previous?.sessionId),
        refreshToken: tokens.refreshToken, authTime: tokens.authTime, provider: 'apple.com' }
      await this.vault.save(record)
      this.boundUid = record.profile.uid
      this.newlySavedOperation = controller
      this.assertCurrent(controller)
      await this.establish(api, controller, record, tokens)
    }, tr('Apple 로그인 창에서 계속해 주세요.'))
  }
  // iOS AuthService.fetchMorseUser: the users document is a Morse profile once it has an ID.
  private async morseProfile(api: FirebaseAuthenticationAPI, tokens: AuthTokens, signal: AbortSignal): Promise<AccountProfile | null> {
    const reader = new FirestoreReader({ signal, authorize: bounded => api.readAuthorization(tokens.idToken, tokens.expiresAt, bounded) })
    try {
      const doc = await reader.getDocument(`${documents}/users/${tokens.uid}`, signal)
      const userId = doc ? stringField(doc.fields, 'userId', 160) : ''
      if (!doc || !userId) return null
      return { uid: tokens.uid, userId, displayName: stringField(doc.fields, 'displayName', 512) || userId }
    } catch (error) {
      if (signal.aborted) throw new AuthenticationFailure('cancelled')
      if (error instanceof AuthenticationFailure) throw error
      throw new AuthenticationFailure(error instanceof ReadFailure && error.code === 'network' ? 'network' : 'protocol')
    } finally { reader.close() }
  }
  async restore(): Promise<void> {
    // Which step a failed restore stopped at, for connection-check.log.
    const progress = { stage: 'saved' }
    await this.operationScope(true, async (api, controller) => {
      try {
        const record = this.boundUid ? await this.vault.read(this.boundUid) : null
        this.assertCurrent(controller)
        if (!record) { this.set('signed-out', tr('복구 코드로 기존 계정을 연결하세요.')); return }
        this.known = record.profile
        // A credential saved by an earlier build: its session ID is written down so a later sign-in reuses it (A6 §4).
        void this.identity.sessionId(record.profile.uid, record.sessionId).catch(() => {})
        progress.stage = 'token'
        const tokens = await api.refresh(record.refreshToken, record.profile.uid, record.authTime, controller.signal)
        this.assertCurrent(controller)
        // Commit rotated credentials before any later network operation can fail.
        record.refreshToken = tokens.refreshToken
        progress.stage = 'saved'
        await this.vault.save(record)
        this.assertCurrent(controller)
        // A16: the saved sign-in proves the app while it is restored — the server checks its session — so a restart on a
        // network where reCAPTCHA scores low (B99, a VPN exit) still opens. The open account takes this over (establish);
        // a session the server refuses leaves it to the hidden page as before.
        const restoring = this.proofSessions?.useSession?.(record.profile.uid, signal => api.desktopAppCheckToken(tokens.idToken, signal))
        try { await this.establish(api, controller, record, tokens, progress) }
        finally { restoring?.() }
      } catch (error) {
        if (!controller.signal.aborted) recordRetry('restore', progress.stage, error)
        throw error
      }
    })
  }
  private async establish(api: FirebaseAuthenticationAPI, controller: AbortController, record: SavedCredential, tokens: AuthTokens, progress = { stage: '' }): Promise<void> {
    this.set('connecting', tr('이 기기의 로그인을 확인하고 있습니다.'))
    progress.stage = 'session'
    await api.startSession(tokens.idToken, record.sessionId, this.version, record.provider ?? 'custom', controller.signal)
    this.assertCurrent(controller)
    let owner: CredentialOwner
    const transport = new SocketMessageTransport(this.version, {
      rejected: reason => { owner.rejection = reason },
      // A socket refusal that may mean the sign-in is gone is asked of the server; only its «session-revoked» ends it.
      confirm: () => this.confirmSession(api, owner),
      state: state => { recordConnectionStep('state', state); this.connectionChanged(owner, state) },
      step: (step, detail) => recordConnectionStep(step, detail),
      reactionUpdated: body => { if (this.owner === owner && !controller.signal.aborted && owner.established) this.accounts.reactionUpdated(record.profile.uid, body) },
      message: message => {
        if (this.owner === owner && !controller.signal.aborted && owner.established && message.senderId !== record.profile.uid) {
          this.accounts.notificationHint(record.profile.uid, { chatId: message.chatId, id: message.id })
        }
      },
      // A lapsed connection also stops every Firestore read's authorization, so each
      // watch re-listens by itself and brings the account up to date (the desktop's
      // getDifference); a renewal in place keeps them running. Nothing else to request here.
      needsReconciliation: () => {}
    }, this.seams.openSocket)
    owner = { controller, record, tokens, established: false, rejection: '', refresh: null, transport }
    this.owner = owner
    // A15-5 (§31, user «권장대로» 10-03 18:3x): the account opens on the session the server has just confirmed
    // (startMorseDeviceSession above, the same answer the socket's registration asks for: revoked, banned, too old) and
    // on Firestore, not on the message server's socket — where that socket does not carry (Russia, B95) the account
    // still opens, reads, and sends through the callables (send-fallback.ts). The socket is connected once the account
    // is open and its refusals end the account as they always did (connectionChanged); until it is there the list and
    // the chat say «연결 중…» and nothing waits for it, as Telegram's title says «Connecting...» without stopping the
    // window (tdesktop window/window_connecting_widget.cpp:31, 307-345; history/view/history_view_top_bar_widget.cpp
    // :276-296, 770-786).
    progress.stage = 'save'
    await this.vault.save(record)
    this.assertCurrent(controller)
    owner.established = true
    // A15: sending no longer waits for the socket — a message the socket cannot carry goes through the callable
    // (send-fallback.ts) — so the sender is this account's for as long as it is established. Reactions stay on the
    // socket while it is there and otherwise use their own callable (message-actions.ts).
    const isCurrent = (): boolean => this.owner === owner && !controller.signal.aborted && owner.established
    const isCurrentSender = (): boolean => isCurrent() && owner.transport.ready
    // Reading is not sending: Telegram downloads over its own connections, so a socket that went down does not
    // stop a watch or a picture. Only the account being gone (another one, signed out, aborted) does.
    const authorize = async (signal: AbortSignal, force: boolean) => {
      const bounded = AbortSignal.any([signal, controller.signal])
      const assertOwner = (): void => {
        if (bounded.aborted || this.owner !== owner || !owner.established) throw new AuthenticationFailure('cancelled')
      }
      assertOwner()
      const idToken = await this.idToken(owner, force)
      assertOwner()
      const authorization = await api.readAuthorization(idToken, owner.tokens.expiresAt, bounded)
      assertOwner()
      return authorization
    }
    const socket: SocketPath = {
      whenSendable: (ms, signal) => owner.transport.whenSendable(ms, signal),
      send: (wire, signal) => owner.transport.send(wire, signal),
      markRead: (chatId, target, signal) => owner.transport.markRead(chatId, record.profile.uid, target, signal)
    }
    const callable: CallablePath = (name, data, signal) => callMorseFunction({ signal: controller.signal, authorize }, name, data, signal, { timeout: 30000 })
    this.accounts.activated({ ...record.profile }, {
      signal: controller.signal,
      storageScope: `${record.sessionId}:${record.authTime}`,
      sender: {
        get ready() { return isCurrent() },
        send: (wire, signal) => {
          if (!isCurrent() || wire.senderId !== record.profile.uid) throw new NotEmitted(tr('계정 연결이 변경되었습니다.'))
          return sendWithFallback(wire, AbortSignal.any([signal, controller.signal]), socket, callable)
        },
        markRead: (chatId, target, signal) => {
          if (!isCurrent()) throw new NotEmitted(tr('계정 연결이 변경되었습니다.'))
          return markReadWithFallback(chatId, record.profile.uid, target, AbortSignal.any([signal, controller.signal]), socket, callable)
        },
        get reactions() { return isCurrentSender() && owner.transport.reactionsReady },
        react: (payload, signal) => {
          if (!isCurrentSender() || payload.expectedUid !== record.profile.uid) throw new NotEmitted(tr('계정 연결이 변경되었습니다.'))
          return owner.transport.setReaction(payload, AbortSignal.any([signal, controller.signal]))
        }
      },
      authorize
    })
    this.set('signed-in', tr('계정이 연결되었습니다.'), owner)
    // A16: this account's session proves the app from now on (web-app-proof.ts): the server gives the token. A sign-in
    // token about to run out is renewed first (idToken) — renewing needs no proof (firebase-rest.ts refresh) — so after a
    // long sleep the saved sign-in alone leads back: refresh token → ID token → this app's token, with no page.
    const stopProof = this.proofSessions?.useSession?.(record.profile.uid, async signal =>
      owner.established && this.owner === owner ? api.desktopAppCheckToken(await this.idToken(owner, false), signal) : null)
    if (stopProof) controller.signal.addEventListener('abort', stopProof, { once: true })
    // What the socket's registration watched for this sign-in is watched on Firestore too (sign-in-watch.ts).
    const watchReader = new FirestoreReader({ signal: controller.signal, authorize })
    controller.signal.addEventListener('abort', () => watchReader.close(), { once: true })
    const watch = this.seams.watchSignIn ?? watchSignIn
    watch(watchReader, record.profile.uid, record.sessionId, record.authTime, controller.signal, reason => void this.checkSignIn(api, owner, reason))
    progress.stage = 'socket'
    owner.transport.connect({ uid: record.profile.uid, sessionId: record.sessionId, idToken: force => this.idToken(owner, force) })
  }
  private connectionChanged(owner: CredentialOwner, state: ConnectionState): void {
    if (this.owner !== owner || owner.controller.signal.aborted) return
    if (owner.established && state !== 'rejected') this.accounts.connection(owner.record.profile.uid, state)
    if (state === 'ready') {
      if (owner.established) this.set('signed-in', tr('계정이 연결되었습니다.'), owner)
    } else if (state === 'rejected') {
      const outcome = owner.revokedByServer ? 'revoked' : registrationOutcome({ reason: owner.rejection, error: owner.rejection })
      const revoked = outcome === 'revoked'
      const error = new AuthenticationFailure(rejectionFailure(outcome))
      // The socket is connected only once the account is open (establish), so its refusal always ends an open account.
      if (!owner.established) return
      if (revoked) noteSignOut(`startMorseDeviceSession session-revoked, asked after ${owner.rejection.startsWith('watch-') ? owner.rejection : `socket ${owner.rejection}`}`)
      // Only a sign-in the server says is gone clears what this device kept for the account: the messages not yet
      // sent, uploads, drafts, what it hid. Anything else leaves them for the next connection (Telegram logs out
      // on 401 alone).
      this.detach(purgesAccountData(outcome))
      this.failure = error.code
      this.set('error', error.message)
      if (revoked) void this.vault.remove(owner.record.profile.uid).catch(() => {
        if (!this.closed && !this.owner && !this.operation) this.set('error', new AuthenticationFailure('storage').message)
      })
    }
    // A15-5: any other state of the socket leaves an open account as it is — it is shown as «연결 중…» (registry →
    // session.setSocket) and nothing waits for it.
  }
  // A5 contract §3-1: whether the server still holds this device's session, asked with a fresh token. «session-revoked»
  // is the answer that signs out; a token the Firebase servers refuse signs out on the way (idToken, their answer too);
  // anything else — the network, a proof, a slow server — is no answer, and the socket registers again later.
  // A15-5: the account's or the session's document says the sign-in may be gone (sign-in-watch.ts). The server is asked
  // as for a socket refusal, one question at a time; its «session-revoked» ends the account the way the socket's does —
  // the connection stops as rejected and connectionChanged signs out and clears what this device kept.
  private async checkSignIn(api: FirebaseAuthenticationAPI, owner: CredentialOwner, reason: string): Promise<void> {
    if (this.owner !== owner || !owner.established || owner.checking) return
    owner.checking = true
    try {
      const answer = await this.confirmSession(api, owner)
      recordConnectionStep('session-confirm', `watch-${reason}:${answer}`)
      if (answer === 'revoked' && this.owner === owner) { owner.rejection = `watch-${reason}`; owner.transport.stop('rejected') }
    } finally { owner.checking = false }
  }
  private async confirmSession(api: FirebaseAuthenticationAPI, owner: CredentialOwner): Promise<'revoked' | 'confirmed' | 'unknown'> {
    if (this.owner !== owner || owner.controller.signal.aborted) return 'unknown'
    try {
      const idToken = await this.idToken(owner, true)
      await api.startSession(idToken, owner.record.sessionId, this.version, owner.record.provider ?? 'custom', owner.controller.signal)
      return 'confirmed'
    } catch (error) {
      // A10 §4: the server says the account is banned — the socket stops asking, and the account says so with «도움».
      if (asAuthFailure(error).code === 'banned' && this.owner === owner) {
        this.detach(false); this.failure = 'banned'; this.set('error', asAuthFailure(error).message)
        return 'unknown'
      }
      if (asAuthFailure(error).code !== 'revoked' || this.owner !== owner) return 'unknown'
      owner.revokedByServer = true
      return 'revoked'
    }
  }
  private async idToken(owner: CredentialOwner, force: boolean): Promise<string> {
    if (this.owner !== owner || owner.controller.signal.aborted) throw new AuthenticationFailure('cancelled')
    if (!force && owner.tokens.expiresAt > Date.now() + 60000) return owner.tokens.idToken
    if (owner.refresh) return owner.refresh
    const task = (async () => {
      const tokens = await this.requireAPI().refresh(owner.tokens.refreshToken, owner.record.profile.uid, owner.record.authTime, owner.controller.signal)
      if (this.owner !== owner || owner.controller.signal.aborted) throw new AuthenticationFailure('cancelled')
      const record = { ...owner.record, refreshToken: tokens.refreshToken }
      await this.vault.save(record)
      if (this.owner !== owner || owner.controller.signal.aborted) throw new AuthenticationFailure('cancelled')
      owner.record = record; owner.tokens = tokens
      return tokens.idToken
    })()
    owner.refresh = task
    try { return await task }
    catch (error) {
      const failure = asAuthFailure(error), effect = tokenFailureEffect(failure.code)
      if (this.owner === owner && effect !== 'none') {
        if (effect === 'sign-out') noteSignOut(`token refresh ${failure.code}`)
        this.detach(effect === 'sign-out'); this.failure = failure.code; this.set('error', failure.message)
        if (effect === 'sign-out') await this.vault.remove(owner.record.profile.uid)
      }
      throw failure
    } finally { if (owner.refresh === task) owner.refresh = null }
  }
  private detach(purge = true): CredentialOwner | null {
    const owner = this.owner
    this.owner = null
    if (owner) this.accounts.closed(owner.record.profile.uid, purge)
    owner?.controller.abort()
    owner?.transport.stop()
    return owner
  }
  async creationIdToken(signal: AbortSignal): Promise<string | null> {
    const owner = this.owner
    if (!owner?.established || signal.aborted) return null
    return this.idToken(owner, false)
  }
  async cancel(): Promise<void> {
    if (this.owner?.established || this.loggingOut) return
    this.operation?.abort()
    await this.operationTask
  }
  async signOut(): Promise<void> {
    if (this.logoutTask) return this.logoutTask
    this.loggingOut = true
    const task = this.performSignOut()
    this.logoutTask = task
    try { await task }
    finally { this.logoutTask = null; this.loggingOut = false }
  }
  private async performSignOut(): Promise<void> {
    try {
      this.operation?.abort()
      await this.operationTask
      const owner = this.detach()
      // Persist local sign-out before awaiting the network. Quitting offline
      // must not leave a restorable credential after an explicit sign-out.
      if (this.boundUid) await this.vault.remove(this.boundUid)
      if (!this.closed) this.set(this.api ? 'signed-out' : 'unavailable', tr('이 기기에서 로그아웃했습니다.'))
      let remoteFailed = false
      if (owner && this.api && !this.closed) {
        // Explicit sign-out attempts the existing server revoke command. The
        // local credential is removed even if that remote operation is offline.
        this.logoutAbort = new AbortController()
        const signal = AbortSignal.any([this.logoutAbort.signal, AbortSignal.timeout(35000)])
        try {
          // A token about to run out is renewed first: an expired one would only be refused as unauthenticated.
          const idToken = owner.tokens.expiresAt > Date.now() + 60000 ? owner.tokens.idToken
            : (await this.api.refresh(owner.record.refreshToken, owner.record.profile.uid, owner.record.authTime, signal)).idToken
          await this.api.signOutSession(idToken, owner.record.sessionId, signal)
        } catch { remoteFailed = true }
      }
      if (!this.closed && remoteFailed) this.set('signed-out', tr('이 기기에서 로그아웃했습니다. 서버의 로그인 해제는 확인하지 못했습니다.'))
    } catch { if (!this.closed) this.set('error', new AuthenticationFailure('storage').message) }
    finally { this.logoutAbort = null }
  }
  // The server already deleted the account; only this device's credential is left to forget.
  async forgetDeletedAccount(): Promise<void> {
    this.operation?.abort()
    await this.operationTask
    this.detach()
    try { if (this.boundUid) await this.vault.remove(this.boundUid) } catch { if (!this.closed) this.set('error', new AuthenticationFailure('storage').message); return }
    if (!this.closed) this.set(this.api ? 'signed-out' : 'unavailable', tr('계정을 삭제했습니다.'))
  }
  suspend(): void {
    if (!this.owner?.established) { this.operation?.abort(); return }
    this.owner.transport.suspend()
  }
  resume(): void { this.owner?.transport.resume() }
  async close(): Promise<void> {
    this.closed = true
    this.operation?.abort()
    this.logoutAbort?.abort()
    this.detach(false)
    await this.operationTask
    await this.logoutTask
    await this.vault.flush()
  }
}

// A5 contract §4: before an account is signed out, which of the server's answers it was (§3-1) — nothing that names
// the account or the session.
function noteSignOut(basis: string): void { recordSignOutBasis(basis) }
