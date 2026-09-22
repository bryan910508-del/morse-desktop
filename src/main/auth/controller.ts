import { generateKeyPairSync, randomInt, randomUUID } from 'node:crypto'
import type { AuthenticationSnapshot } from '../../shared/auth'
import { morseUserId, morseUserIdAlphabet, normalizeBackupCode, type AccountCreationResult } from '../../shared/auth'
import type { AccountProfile, ConnectionState } from '../../shared/model'
import type { NotificationHint } from '../../shared/notifications'
import type { AccountAuthorization } from '../messaging/outbox'
import { NotEmitted } from '../network/contracts'
import { FirestoreReader } from '../network/firestore-rpc'
import { documents, ReadFailure, stringField } from '../network/firestore-values'
import { SocketMessageTransport } from '../network/socket-transport'
import { AuthenticationFailure, asAuthFailure, type AuthFailureCode, type AuthTokens, type DesktopAuthConfiguration, type SavedCredential } from './contracts'
import { CredentialVault } from './credential-vault'
import { DeviceIdentity } from './device-identity'
import { generateBackupCode } from './backup-code'
import { authorizeWithApple } from './apple-authorization'
import { FirebaseAuthenticationAPI } from './firebase-rest'
import { recordConnectionStep } from '../platform/connection-diagnostics'
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
  rejection: string
}

export interface AuthenticatedAccountHooks {
  activated(profile: AccountProfile, credentials: AccountAuthorization): void
  connection(uid: string, state: ConnectionState): void
  closed(uid: string, purge: boolean): void
  notificationHint(uid: string, hint: NotificationHint): void
}
// Main::Domain decides whether another account fits on this device and supplies the
// signed-in account's token for creating one.
export interface AccountAdmission {
  admit(uid: string): void
  admitNew(): void
  creationToken(signal: AbortSignal): Promise<string | null>
}

// Authentication owns the only protocol-2 connection for registration and server
// revocation monitoring. Account readers consume its verified lifetime.
export class AuthenticationController {
  private readonly api: FirebaseAuthenticationAPI | null
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

  constructor(configuration: DesktopAuthConfiguration | null, private readonly vault: CredentialVault,
    private readonly version: string, private readonly changed: () => void, private readonly accounts: AuthenticatedAccountHooks,
    private boundUid: string | null = null, private readonly admission: AccountAdmission | null = null) {
    this.api = configuration ? new FirebaseAuthenticationAPI(configuration) : null
    this.identity = new DeviceIdentity(vault.location)
    this.value = { available: this.api !== null, phase: this.api ? 'signed-out' : 'unavailable', account: null,
      message: this.api ? tr('복구 코드로 기존 계정을 연결하세요.') : tr('Desktop 계정 연결을 준비하고 있습니다.') }
  }
  get uid(): string | null { return this.boundUid }
  get connected(): boolean { return Boolean(this.owner?.established) }
  // Why the last connection attempt or connection ended, for the domain's reconnect decision.
  get lastFailure(): AuthFailureCode | null { return this.failure }
  get snapshot(): AuthenticationSnapshot { return { ...this.value, account: this.value.account ? { ...this.value.account } : null } }
  private set(phase: AuthenticationSnapshot['phase'], message: string, owner: CredentialOwner | null = null): void {
    this.value = { available: this.api !== null, phase, message, account: owner ? { ...owner.record.profile } : null }
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
          if (failure.code === 'revoked' || failure.code === 'invalid-credential' ||
              (failure.code === 'cancelled' && this.newlySavedOperation === controller)) {
            try { if (this.boundUid) await this.vault.remove(this.boundUid) }
            catch { this.set('error', new AuthenticationFailure('storage').message); return }
          }
          this.failure = failure.code
          this.set(failure.code === 'cancelled' ? 'signed-out' : 'error', failure.message)
        }
      } finally {
        if (this.operation === controller) this.operation = null
        if (this.newlySavedOperation === controller) this.newlySavedOperation = null
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
      if (!this.boundUid) this.admission?.admit(verified.profile.uid)
      // Signing in again to a saved account keeps its device session ID.
      const previous = stored ?? (this.boundUid ? null : await this.vault.read(verified.profile.uid).catch(() => null))
      this.assertCurrent(controller)
      const tokens = await api.exchange(verified.customToken, verified.profile.uid, controller.signal)
      this.assertCurrent(controller)
      const record: SavedCredential = { version: 1, profile: verified.profile,
        sessionId: previous?.sessionId ?? randomUUID(), refreshToken: tokens.refreshToken, authTime: tokens.authTime }
      // The stable session ID must survive an unknown startSession response.
      // A stored credential is only a restore candidate, never authorization.
      await this.vault.save(record)
      this.boundUid = record.profile.uid
      this.newlySavedOperation = controller
      this.assertCurrent(controller)
      await this.establish(api, controller, record, tokens)
    })
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
        sessionId: randomUUID(), refreshToken: tokens.refreshToken, authTime: tokens.authTime }
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
      const apple = await authorizeWithApple(controller.signal)
      this.assertCurrent(controller)
      this.set('verifying', tr('Apple 계정을 확인하고 있습니다.'))
      let tokens = await api.signInWithApple(apple, controller.signal)
      this.assertCurrent(controller)
      let profile = await this.morseProfile(api, tokens, controller.signal)
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
      const record: SavedCredential = { version: 1, profile, sessionId: previous?.sessionId ?? randomUUID(),
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
    await this.operationScope(true, async (api, controller) => {
      const record = this.boundUid ? await this.vault.read(this.boundUid) : null
      this.assertCurrent(controller)
      if (!record) { this.set('signed-out', tr('복구 코드로 기존 계정을 연결하세요.')); return }
      const tokens = await api.refresh(record.refreshToken, record.profile.uid, record.authTime, controller.signal)
      this.assertCurrent(controller)
      // Commit rotated credentials before any later network operation can fail.
      record.refreshToken = tokens.refreshToken
      await this.vault.save(record)
      this.assertCurrent(controller)
      await this.establish(api, controller, record, tokens)
    })
  }
  private async establish(api: FirebaseAuthenticationAPI, controller: AbortController, record: SavedCredential, tokens: AuthTokens): Promise<void> {
    this.set('connecting', tr('이 기기의 로그인을 확인하고 있습니다.'))
    await api.startSession(tokens.idToken, record.sessionId, this.version, record.provider ?? 'custom', controller.signal)
    this.assertCurrent(controller)
    let ready!: () => void
    let failed!: (error: Error) => void
    const registration = new Promise<void>((resolve, reject) => { ready = resolve; failed = reject })
    let owner: CredentialOwner
    const transport = new SocketMessageTransport(this.version, {
      rejected: reason => { owner.rejection = reason },
      state: state => { recordConnectionStep('state', state); this.connectionChanged(owner, state, ready, failed) },
      step: (step, detail) => recordConnectionStep(step, detail),
      message: message => {
        if (this.owner === owner && !controller.signal.aborted && owner.established && message.senderId !== record.profile.uid) {
          this.accounts.notificationHint(record.profile.uid, { chatId: message.chatId, id: message.id })
        }
      },
      // A lapsed connection also stops every Firestore read's authorization, so each
      // watch re-listens by itself and brings the account up to date (the desktop's
      // getDifference); a renewal in place keeps them running. Nothing else to request here.
      needsReconciliation: () => {}
    })
    owner = { controller, record, tokens, established: false, rejection: '', refresh: null, transport }
    this.owner = owner
    const cancel = () => failed(new AuthenticationFailure('cancelled'))
    const timer = setTimeout(() => failed(new AuthenticationFailure('network')), 45000)
    controller.signal.addEventListener('abort', cancel, { once: true })
    try {
      owner.transport.connect({ uid: record.profile.uid, sessionId: record.sessionId, idToken: force => this.idToken(owner, force) })
      await registration
      this.assertCurrent(controller)
      await this.vault.save(record)
      this.assertCurrent(controller)
      // A disconnect while saving cannot publish a current server authorization.
      if (!owner.transport.ready) throw new AuthenticationFailure('network')
      owner.established = true
      const isCurrentSender = (): boolean => this.owner === owner && !controller.signal.aborted && owner.established && owner.transport.ready
      this.accounts.activated({ ...record.profile }, {
        signal: controller.signal,
        storageScope: `${record.sessionId}:${record.authTime}`,
        sender: {
          get ready() { return isCurrentSender() },
          send: (wire, signal) => {
            if (!isCurrentSender() || wire.senderId !== record.profile.uid) throw new NotEmitted(tr('계정 연결이 변경되었습니다.'))
            return owner.transport.send(wire, AbortSignal.any([signal, controller.signal]))
          },
          markRead: (chatId, target, signal) => {
            if (!isCurrentSender()) throw new NotEmitted(tr('계정 연결이 변경되었습니다.'))
            return owner.transport.markRead(chatId, record.profile.uid, target, AbortSignal.any([signal, controller.signal]))
          }
        },
        authorize: async (signal, force) => {
          const bounded = AbortSignal.any([signal, controller.signal])
          const assertOwner = (): void => {
            if (bounded.aborted || this.owner !== owner || !owner.established || !owner.transport.ready) throw new AuthenticationFailure('cancelled')
          }
          assertOwner()
          const idToken = await this.idToken(owner, force)
          assertOwner()
          const authorization = await api.readAuthorization(idToken, owner.tokens.expiresAt, bounded)
          assertOwner()
          return authorization
        }
      })
      this.set('signed-in', tr('계정이 연결되었습니다.'), owner)
    } finally {
      clearTimeout(timer)
      controller.signal.removeEventListener('abort', cancel)
    }
  }
  private connectionChanged(owner: CredentialOwner, state: ConnectionState, ready: () => void, failed: (error: Error) => void): void {
    if (this.owner !== owner || owner.controller.signal.aborted) return
    if (owner.established && state !== 'rejected') this.accounts.connection(owner.record.profile.uid, state)
    if (state === 'ready') {
      ready()
      if (owner.established) this.set('signed-in', tr('계정이 연결되었습니다.'), owner)
    } else if (state === 'rejected') {
      const revoked = ['session-revoked', 'credential-revoked', 'account-unavailable', 'token-account-mismatch'].includes(owner.rejection)
      const error = new AuthenticationFailure(revoked ? 'revoked' : owner.rejection === 'authorization-monitor-failed' ? 'network' : 'unavailable')
      if (!owner.established) { failed(error); return }
      this.detach()
      this.failure = error.code
      this.set('error', error.message)
      if (revoked) void this.vault.remove(owner.record.profile.uid).catch(() => {
        if (!this.closed && !this.owner && !this.operation) this.set('error', new AuthenticationFailure('storage').message)
      })
    } else if (owner.established) {
      this.set('suspended', tr('계정 연결을 다시 확인하고 있습니다.'), owner)
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
      const failure = asAuthFailure(error)
      if (this.owner === owner && ['invalid-credential', 'revoked', 'storage'].includes(failure.code)) {
        this.detach(); this.failure = failure.code; this.set('error', failure.message)
        if (failure.code !== 'storage') await this.vault.remove(owner.record.profile.uid)
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
        try { await this.api.revokeSession(owner.tokens.idToken, owner.record.sessionId,
          AbortSignal.any([this.logoutAbort.signal, AbortSignal.timeout(35000)])) }
        catch { remoteFailed = true }
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
