// Portions of this file follow Telegram Desktop (https://github.com/telegramdesktop/tdesktop, 7.2.8, 272f6f5c),
// Copyright (c) 2014-2026 The Telegram Desktop Authors. Licensed under GPL-3.0-or-later; see LEGAL.
import { object, identifier } from '../../shared/validation'
import type { AccountProfile } from '../../shared/model'
import { sendAgain } from '../network/resend'
import { recordConnectionStep } from '../platform/connection-diagnostics'
import { AuthenticationFailure, type AppCheckProof, type AuthTokens, type DesktopAuthConfiguration, PasswordNeeded } from './contracts'
import type { ReadAuthorization } from '../network/firestore-rpc'
import { appleReturnURL, type AppleIdentity } from './apple-answer'
import type { GoogleIdentity } from './google-answer'
export type ProviderIdentity = ({ provider: 'apple.com' } & AppleIdentity) | ({ provider: 'google.com' } & GoogleIdentity)
import { reachability } from '../network/reachability'
import { describeThisDevice } from '../platform/device-model'
import { decodeQrIssue, decodeQrRedeem, qrSwitchOn, type QrIssue, type QrRedeem } from './qr-login'

function string(value: unknown, max = 16384): string {
  if (typeof value !== 'string' || !value || value.length > max) throw new AuthenticationFailure('protocol')
  return value
}
type RequestKind = 'plain' | 'backup' | 'creation' | 'apple' | 'google' | 'qr'
export function failureFromBody(value: Record<string, unknown>, status: number, kind: RequestKind): AuthenticationFailure {
  const error = value.error && typeof value.error === 'object' ? value.error as Record<string, unknown> : {}
  const details = error.details && typeof error.details === 'object' ? error.details as Record<string, unknown> : {}
  const code = typeof error.message === 'string' ? error.message.split(' ')[0] : error.status
  if (details.reason === 'session-revoked') return new AuthenticationFailure('revoked')
  if (details.reason === 'password-needed') {
    const resetAt = typeof details.resetAt === 'number' && Number.isFinite(details.resetAt) && details.resetAt > 0 ? details.resetAt : null
    return new PasswordNeeded(typeof details.hint === 'string' ? details.hint.slice(0, 64) : '', resetAt)
  }
  // A10 §3-3-4: an operator's ban — bannedAt refused by the callable gate, or the Firebase user disabled.
  if (details.reason === 'ACCOUNT_BANNED' || code === 'USER_DISABLED') return new AuthenticationFailure('banned')
  // completeTalkyProfile: a withdrawn account's leftover Firebase user (iOS MorseAccountDeletion.staleAppleAuthIdentityCode).
  if (details.morseCode === 'stale_apple_auth_identity') return new AuthenticationFailure('stale-identity')
  // A13 §2.1: the QR sign-in is switched off on the server, or this attempt is over (expired, cancelled, the approving
  // phone signed out, the account unavailable) — a new code is shown, or none at all when switched off.
  if (kind === 'qr' && (details.reason === 'qr-login-disabled' || error.message === 'qr-login-disabled')) return new AuthenticationFailure('qr-disabled')
  if (kind === 'qr' && ['attempt-missing', 'attempt-closed', 'expired', 'approval-cancelled', 'approver-signed-out', 'account-unavailable', 'binding-malformed']
    .some(reason => details.reason === reason || error.message === reason)) return new AuthenticationFailure('qr-expired')
  if (status === 429 || error.status === 'RESOURCE_EXHAUSTED' || code === 'TOO_MANY_ATTEMPTS_TRY_LATER') return new AuthenticationFailure('rate-limited')
  if (['TOKEN_EXPIRED', 'USER_NOT_FOUND', 'INVALID_REFRESH_TOKEN', 'INVALID_ID_TOKEN'].includes(String(code))) return new AuthenticationFailure('invalid-credential')
  if (kind === 'backup' && error.status === 'PERMISSION_DENIED') return new AuthenticationFailure('invalid-code')
  if (kind === 'creation' && error.status === 'ALREADY_EXISTS') return new AuthenticationFailure('id-taken')
  if (kind === 'creation' && error.status === 'PERMISSION_DENIED') return new AuthenticationFailure('account-limit')
  // signInWithIdp refused the identity token, its nonce or the provider.
  if ((kind === 'apple' || kind === 'google') && status === 400) return new AuthenticationFailure(kind)
  // Callable 401 can mean App Check failure, not a revoked user credential.
  // Only explicit credential errors or session-revoked may erase the vault.
  if (error.status === 'UNAUTHENTICATED' || status === 401) return new AuthenticationFailure('unavailable')
  if (status === 403) return new AuthenticationFailure('unavailable')
  if (status >= 500) return new AuthenticationFailure('network')
  return new AuthenticationFailure('protocol')
}

export class FirebaseAuthenticationAPI {
  constructor(private readonly config: DesktopAuthConfiguration) {
    if (config.projectId !== 'talky-a38c3' || config.projectNumber !== '123713400904' ||
        !config.apiKey.trim() || !config.appId.startsWith(`1:${config.projectNumber}:web:`) ||
        (process.platform === 'darwin' ? config.platform !== 'macOS' : process.platform === 'win32' ? config.platform !== 'Windows' : true)) {
      throw new AuthenticationFailure('unavailable')
    }
  }
  private async appProof(signal: AbortSignal): Promise<AppCheckProof> {
    signal.throwIfAborted()
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(35000)])
    const proof = await new Promise<Awaited<ReturnType<DesktopAuthConfiguration['proof']['getProof']>>>((resolve, reject) => {
      const cancel = () => reject(new AuthenticationFailure(signal.aborted ? 'cancelled' : 'network'))
      bounded.addEventListener('abort', cancel, { once: true })
      // Race a provider that becomes unavailable, so cancel/quit cannot wait
      // indefinitely for an external attestation implementation.
      Promise.resolve().then(() => { bounded.throwIfAborted(); return this.config.proof.getProof(bounded) }).then(resolve, reject)
        .finally(() => bounded.removeEventListener('abort', cancel))
    })
    signal.throwIfAborted()
    if (proof.appId !== this.config.appId || !Number.isFinite(proof.expiresAt) || proof.expiresAt <= Date.now() + 60000) {
      throw new AuthenticationFailure('unavailable')
    }
    return { ...proof, token: string(proof.token) }
  }
  private async proof(signal: AbortSignal): Promise<string> { return (await this.appProof(signal)).token }
  async readAuthorization(idToken: string, expiresAt: number, signal: AbortSignal): Promise<ReadAuthorization> {
    const proof = await this.appProof(signal)
    return { idToken: string(idToken), appCheckToken: proof.token, expiresAt: Math.min(expiresAt, proof.expiresAt) }
  }
  private async request(url: string, headers: Record<string, string>, body: string, signal: AbortSignal, kind: RequestKind = 'plain'): Promise<Record<string, unknown>> {
    const combined = AbortSignal.any([signal, AbortSignal.timeout(35000)])
    try {
      const response = await sendAgain(combined, () => fetch(url, { method: 'POST', headers, body, signal: combined, redirect: 'error', credentials: 'omit', cache: 'no-store' }),
        (code, attempt) => { reachability.lost(); recordConnectionStep('token-resend', `${code} ${attempt}`) })
      reachability.reached('https')
      // Bound the decoded response, including chunked responses with no length.
      if (!response.body) throw new AuthenticationFailure('protocol')
      const reader = response.body.getReader()
      const parts: Uint8Array[] = []
      let size = 0
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > 262144) { await reader.cancel(); throw new AuthenticationFailure('protocol') }
          parts.push(value)
        }
      } finally { reader.releaseLock() }
      const result = object(JSON.parse(Buffer.concat(parts).toString('utf8')))
      if (!response.ok || result.error !== undefined) throw failureFromBody(result, response.status, kind)
      return result
    } catch (error) {
      if (signal.aborted) throw new AuthenticationFailure('cancelled')
      if (error instanceof AuthenticationFailure) throw error
      throw new AuthenticationFailure('network')
    }
  }
  private async callable(name: 'verifyBackupCode' | 'createAccountWithCustomToken' | 'completeTalkyProfile' | 'startMorseDeviceSession' | 'revokeMorseDeviceSession' | 'exportMorseLoginToken' | 'redeemMorseLoginToken', data: Record<string, unknown>, signal: AbortSignal, idToken?: string): Promise<Record<string, unknown>> {
    const proof = await this.proof(signal)
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Firebase-AppCheck': proof }
    // Bootstrap must never inherit another account's Authorization header (the QR sign-in is a bootstrap too).
    const bootstrap = name === 'verifyBackupCode' || name === 'exportMorseLoginToken' || name === 'redeemMorseLoginToken'
    if (!bootstrap && idToken) headers.Authorization = `Bearer ${string(idToken)}`
    const response = await this.request(`https://asia-northeast3-${this.config.projectId}.cloudfunctions.net/${name}`,
      headers, JSON.stringify({ data }), signal, name === 'verifyBackupCode' ? 'backup' : name === 'createAccountWithCustomToken' || name === 'completeTalkyProfile' ? 'creation'
        : name === 'exportMorseLoginToken' || name === 'redeemMorseLoginToken' ? 'qr' : 'plain')
    return object(response.result)
  }
  async verifyBackupCode(code: string, signal: AbortSignal): Promise<{ profile: AccountProfile; customToken: string }> {
    const result = await this.callable('verifyBackupCode', { backupCode: code }, signal)
    const userId = string(result.userId, 160)
    return { profile: { uid: identifier(result.uid), userId,
      displayName: typeof result.displayName === 'string' && result.displayName.length <= 512 ? result.displayName : userId },
      customToken: string(result.token) }
  }
  // A13 §2.1 exportMorseLoginToken: a code for this attempt, bound to SHA-256 of its secret. The accounts already on
  // this computer are left out (Telegram except_ids): such an account's phone is told it is connected already.
  async issueLoginCode(binding: string, exceptUids: string[], version: string, signal: AbortSignal): Promise<QrIssue> {
    const device = await describeThisDevice()
    return decodeQrIssue(await this.callable('exportMorseLoginToken', { binding, exceptUids: exceptUids.slice(0, 4).map(uid => identifier(uid)),
      appVersion: version, systemVersion: device.systemVersion }, signal))
  }
  // redeemMorseLoginToken: still waiting, approved (the sign-in with its server session), or a two-step password needed.
  async redeemLoginCode(secret: string, signal: AbortSignal): Promise<QrRedeem> {
    return decodeQrRedeem(await this.callable('redeemMorseLoginToken', { secret }, signal))
  }
  // The attempt ends here (the code closed, another way chosen): best effort, the server's TTL ends it anyway.
  async cancelLoginCode(secret: string, signal: AbortSignal): Promise<void> {
    await this.callable('redeemMorseLoginToken', { secret, cancel: true }, signal)
  }
  // app_config/{name} — readable by anyone, so it is read before any sign-in, with this app's proof only. Absent or
  // unreadable is null.
  async publicConfig(name: 'qr_login' | 'desktop', signal: AbortSignal): Promise<Record<string, unknown> | null> {
    const proof = await this.proof(signal)
    const combined = AbortSignal.any([signal, AbortSignal.timeout(15000)])
    try {
      const response = await fetch(`https://firestore.googleapis.com/v1/projects/${this.config.projectId}/databases/(default)/documents/app_config/${name}?key=${encodeURIComponent(this.config.apiKey)}`,
        { method: 'GET', headers: { 'X-Firebase-AppCheck': proof }, signal: combined, redirect: 'error', credentials: 'omit', cache: 'no-store' })
      if (!response.ok) return null
      const text = await response.text()
      return text.length <= 65536 ? object(JSON.parse(text)) : null
    } catch { return null }
  }
  // app_config/qr_login: off, absent or unreadable reads as off (A13 D-6: the QR sign-in appears in the three apps together).
  async qrLoginEnabled(signal: AbortSignal): Promise<boolean> {
    return qrSwitchOn(await this.publicConfig('qr_login', signal), this.config.testingBuild === true)
  }
  // Same request as iOS AuthService.signUp: the display name starts as the ID.
  async createAccount(input: { userId: string; backupCode: string; publicKey: string; deviceVendorId: string }, signal: AbortSignal, creatorIdToken: string | null = null): Promise<{ uid: string; customToken: string }> {
    const result = await this.callable('createAccountWithCustomToken', { userId: input.userId, displayName: input.userId, backupCode: input.backupCode,
      publicKey: input.publicKey, deviceVendorId: input.deviceVendorId }, signal, creatorIdToken ?? undefined)
    return { uid: identifier(result.uid), customToken: string(result.token) }
  }
  // iOS AuthService.completeMorseProfile: the Morse profile of a Firebase user made by Sign in with Apple.
  async completeProfile(input: { userId: string; backupCode: string; publicKey: string; deviceVendorId: string }, idToken: string, signal: AbortSignal): Promise<void> {
    const result = await this.callable('completeTalkyProfile', { userId: input.userId, displayName: input.userId, backupCode: input.backupCode,
      publicKey: input.publicKey, deviceVendorId: input.deviceVendorId }, signal, idToken)
    if (result.ok !== true) throw new AuthenticationFailure('protocol')
  }
  // A provider's identity token signed in over Identity Toolkit's REST API: Apple's with the original nonce
  // (OAuthProvider.appleCredential(withIDToken:rawNonce:)), Google's as Android's GoogleAuthProvider.getCredential(idToken).
  // An email that already belongs to an account made another way answers needConfirmation: refused, never linked.
  async signInWithIdp(identity: ProviderIdentity, signal: AbortSignal): Promise<AuthTokens> {
    const kind = identity.provider === 'apple.com' ? 'apple' : 'google'
    const postBody = new URLSearchParams({ id_token: identity.idToken, providerId: identity.provider, ...(identity.provider === 'apple.com' ? { nonce: identity.rawNonce } : {}) })
    const result = await this.request(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${encodeURIComponent(this.config.apiKey)}`,
      { 'Content-Type': 'application/json', 'X-Firebase-AppCheck': await this.proof(signal) },
      JSON.stringify({ postBody: postBody.toString(), requestUri: identity.provider === 'apple.com' ? appleReturnURL : 'http://127.0.0.1',
        returnSecureToken: true }), signal, kind)
    if (result.needConfirmation === true) throw new AuthenticationFailure('account-exists')
    if (result.providerId !== identity.provider) throw new AuthenticationFailure(kind)
    const tokens = this.tokens(result.idToken, result.refreshToken, result.expiresIn, identifier(result.localId))
    await this.confirmUser(tokens, signal)
    return tokens
  }
  async exchange(customToken: string, uid: string, signal: AbortSignal): Promise<AuthTokens> {
    const result = await this.request(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(this.config.apiKey)}`,
      { 'Content-Type': 'application/json', 'X-Firebase-AppCheck': await this.proof(signal) },
      JSON.stringify({ token: customToken, returnSecureToken: true }), signal)
    const tokens = this.tokens(result.idToken, result.refreshToken, result.expiresIn, uid)
    await this.confirmUser(tokens, signal)
    return tokens
  }
  // A16 (§33): renewing the sign-in token asks for no App Check proof — securetoken.googleapis.com is not a service App
  // Check covers (the App Check API answers it is unsupported, server session 10-03 23:4x), so the header was of no use,
  // and waiting for a proof could hold the renewal up exactly when the proof itself needed it (a signed-in Desktop's
  // proof comes from its session, below). The sign-in session alone carries an account on, as in Telegram Desktop.
  async refresh(refreshToken: string, uid: string, authTime: number, signal: AbortSignal): Promise<AuthTokens> {
    const result = await this.request(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(this.config.apiKey)}`,
      { 'Content-Type': 'application/x-www-form-urlencoded' },
      new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }).toString(), signal)
    // The securetoken endpoint returns a project number in project_id.
    if (result.user_id !== uid || result.project_id !== this.config.projectNumber || result.token_type !== 'Bearer') throw new AuthenticationFailure('protocol')
    const tokens = this.tokens(result.id_token, result.refresh_token, result.expires_in, uid)
    // A refreshed token of another sign-in generation than the one saved is this device's own reading, not the server's
    // word (A5 contract §3-1): morseAuthTime comes only from the custom token of that sign-in (talky-auth-callables.js
    // createCustomToken) and no server code rewrites it, so it should never differ. If it does, the account is not
    // used with it — its saved data belongs to the saved generation (storage scope) — but nothing is signed out or
    // cleared: the step is noted and the connection is tried again later. Only the Firebase servers refusing the
    // refresh token (failureFromBody) or startMorseDeviceSession's «session-revoked» sign out.
    if (tokens.authTime !== authTime) { recordConnectionStep('token-generation-mismatch'); throw new AuthenticationFailure('protocol') }
    return tokens
  }
  private tokens(idValue: unknown, refreshValue: unknown, expires: unknown, uid: string): AuthTokens {
    const idToken = string(idValue), refreshToken = string(refreshValue)
    const lifetime = Number(expires)
    if (!Number.isFinite(lifetime) || lifetime <= 0 || lifetime > 86400) throw new AuthenticationFailure('protocol')
    // This is consistency checking of a token received over Firebase HTTPS, not
    // local authorization or signature verification. Morse still verifies it.
    const components = idToken.split('.')
    if (components.length !== 3) throw new AuthenticationFailure('protocol')
    const claims = object(JSON.parse(Buffer.from(components[1]!, 'base64url').toString('utf8')))
    const authTime = Number(claims.morseAuthTime ?? claims.auth_time)
    if (claims.sub !== uid || claims.aud !== this.config.projectId || claims.iss !== `https://securetoken.google.com/${this.config.projectId}` ||
        !Number.isSafeInteger(authTime) || authTime <= 0 || !Number.isSafeInteger(claims.exp) || Number(claims.exp) * 1000 <= Date.now()) {
      throw new AuthenticationFailure('protocol')
    }
    return { idToken, refreshToken, uid, authTime, expiresAt: Math.min(Date.now() + lifetime * 1000, Number(claims.exp) * 1000) }
  }
  private async confirmUser(tokens: AuthTokens, signal: AbortSignal): Promise<void> {
    const result = await this.request(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(this.config.apiKey)}`,
      { 'Content-Type': 'application/json', 'X-Firebase-AppCheck': await this.proof(signal) }, JSON.stringify({ idToken: tokens.idToken }), signal)
    if (!Array.isArray(result.users) || result.users.length !== 1) throw new AuthenticationFailure('protocol')
    const user = object(result.users[0])
    if (user.localId !== tokens.uid || user.disabled === true) throw new AuthenticationFailure('invalid-credential')
  }
  // A16 (§33): this app's App Check token from the server, for a signed-in session — getMorseDesktopAppCheckToken checks
  // the sign-in (the ID token, its session, the generation) instead of a proof (enforceAppCheck: false), and names the app
  // from the session it started with. Sent without a proof: the proof is what it is asked for. Its refusals
  // (not-desktop-session, session-unconfirmed, session-revoked, password-needed, rate-limited) are read as any
  // callable's; the session itself is ended only by startMorseDeviceSession's word (A5 §3-1), never here.
  async desktopAppCheckToken(idToken: string, signal: AbortSignal): Promise<string> {
    const response = await this.request(`https://asia-northeast3-${this.config.projectId}.cloudfunctions.net/getMorseDesktopAppCheckToken`,
      { 'Content-Type': 'application/json', Authorization: `Bearer ${string(idToken)}` }, JSON.stringify({ data: {} }), signal)
    return string(object(response.result).token)
  }
  // A6 §3-3: the row of the account's session list shows this computer's model and system, as Telegram Desktop sends
  // them (platform/device-model.ts). deviceLabel stays for builds that read only it.
  async startSession(idToken: string, sessionId: string, version: string, provider: 'custom' | 'apple.com' | 'google.com' | 'qr', signal: AbortSignal): Promise<void> {
    const device = await describeThisDevice()
    const result = await this.callable('startMorseDeviceSession', { sessionId,
      deviceLabel: `Morse · ${this.config.platform}`, platform: this.config.platform, appVersion: version, loginProvider: provider,
      deviceModel: device.deviceModel, systemVersion: device.systemVersion }, signal, idToken)
    if (result.sessionId !== sessionId) throw new AuthenticationFailure('protocol')
  }
  // Signing this device out ends its own session on the server (A6 §3-1, `signOut: true`): the session leaves the list
  // at once and its generation is refused everywhere, as Telegram sends auth.logOut (telegram-refs R-13). The answer to
  // a request that reached the server can be lost; sent once more, the server then refuses the generation it has just
  // ended («session-revoked», morse-callable-auth.js) — which is the sign-out done, as is a session already ended.
  // Which of these it was goes to connection-check.log (B176: a sign-out the server took as «already ended» read the same
  // as one it carried out) — the kind, and no more of the session than its first four characters.
  async signOutSession(idToken: string, sessionId: string, signal: AbortSignal): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        const result = await this.callable('revokeMorseDeviceSession', { sessionId, signOut: true }, signal, idToken)
        if (result.ok !== true) throw new AuthenticationFailure('protocol')
        recordConnectionStep('sign-out', `${result.gone === true ? 'gone' : 'ok'} ${sessionId.slice(0, 4)}`)
        return
      } catch (error) {
        if (error instanceof AuthenticationFailure && error.code === 'revoked') { recordConnectionStep('sign-out', `revoked ${sessionId.slice(0, 4)}`); return }
        if (attempt >= 1 || signal.aborted || !(error instanceof AuthenticationFailure && error.code === 'network')) throw error
      }
    }
  }
}
