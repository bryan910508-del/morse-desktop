import { object, identifier } from '../../shared/validation'
import type { AccountProfile } from '../../shared/model'
import { sendAgain } from '../network/resend'
import { recordConnectionStep } from '../platform/connection-diagnostics'
import { AuthenticationFailure, type AppCheckProof, type AuthTokens, type DesktopAuthConfiguration } from './contracts'
import type { ReadAuthorization } from '../network/firestore-rpc'
import { appleReturnURL, type AppleIdentity } from './apple-answer'

function string(value: unknown, max = 16384): string {
  if (typeof value !== 'string' || !value || value.length > max) throw new AuthenticationFailure('protocol')
  return value
}
type RequestKind = 'plain' | 'backup' | 'creation' | 'apple'
function failureFromBody(value: Record<string, unknown>, status: number, kind: RequestKind): AuthenticationFailure {
  const error = value.error && typeof value.error === 'object' ? value.error as Record<string, unknown> : {}
  const details = error.details && typeof error.details === 'object' ? error.details as Record<string, unknown> : {}
  const code = typeof error.message === 'string' ? error.message.split(' ')[0] : error.status
  if (details.reason === 'session-revoked') return new AuthenticationFailure('revoked')
  // completeTalkyProfile: a withdrawn account's leftover Firebase user (iOS MorseAccountDeletion.staleAppleAuthIdentityCode).
  if (details.morseCode === 'stale_apple_auth_identity') return new AuthenticationFailure('stale-identity')
  if (status === 429 || error.status === 'RESOURCE_EXHAUSTED' || code === 'TOO_MANY_ATTEMPTS_TRY_LATER') return new AuthenticationFailure('rate-limited')
  if (['TOKEN_EXPIRED', 'USER_DISABLED', 'USER_NOT_FOUND', 'INVALID_REFRESH_TOKEN', 'INVALID_ID_TOKEN'].includes(String(code))) return new AuthenticationFailure('invalid-credential')
  if (kind === 'backup' && error.status === 'PERMISSION_DENIED') return new AuthenticationFailure('invalid-code')
  if (kind === 'creation' && error.status === 'ALREADY_EXISTS') return new AuthenticationFailure('id-taken')
  if (kind === 'creation' && error.status === 'PERMISSION_DENIED') return new AuthenticationFailure('account-limit')
  // signInWithIdp refused Apple's identity token, its nonce or the Apple provider.
  if (kind === 'apple' && status === 400) return new AuthenticationFailure('apple')
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
      const response = await sendAgain(combined, () => fetch(url, { method: 'POST', headers, body, signal: combined, redirect: 'error', credentials: 'omit', cache: 'no-store' }), (code, attempt) => recordConnectionStep('token-resend', `${code} ${attempt}`))
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
  private async callable(name: 'verifyBackupCode' | 'createAccountWithCustomToken' | 'completeTalkyProfile' | 'startMorseDeviceSession' | 'revokeMorseDeviceSession', data: Record<string, unknown>, signal: AbortSignal, idToken?: string): Promise<Record<string, unknown>> {
    const proof = await this.proof(signal)
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Firebase-AppCheck': proof }
    // Bootstrap must never inherit another account's Authorization header.
    if (name !== 'verifyBackupCode' && idToken) headers.Authorization = `Bearer ${string(idToken)}`
    const response = await this.request(`https://asia-northeast3-${this.config.projectId}.cloudfunctions.net/${name}`,
      headers, JSON.stringify({ data }), signal, name === 'verifyBackupCode' ? 'backup' : name === 'createAccountWithCustomToken' || name === 'completeTalkyProfile' ? 'creation' : 'plain')
    return object(response.result)
  }
  async verifyBackupCode(code: string, signal: AbortSignal): Promise<{ profile: AccountProfile; customToken: string }> {
    const result = await this.callable('verifyBackupCode', { backupCode: code }, signal)
    const userId = string(result.userId, 160)
    return { profile: { uid: identifier(result.uid), userId,
      displayName: typeof result.displayName === 'string' && result.displayName.length <= 512 ? result.displayName : userId },
      customToken: string(result.token) }
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
  // OAuthProvider.appleCredential(withIDToken:rawNonce:) signed in over Identity Toolkit's REST API.
  async signInWithApple(apple: AppleIdentity, signal: AbortSignal): Promise<AuthTokens> {
    const result = await this.request(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${encodeURIComponent(this.config.apiKey)}`,
      { 'Content-Type': 'application/json', 'X-Firebase-AppCheck': await this.proof(signal) },
      JSON.stringify({ postBody: new URLSearchParams({ id_token: apple.idToken, providerId: 'apple.com', nonce: apple.rawNonce }).toString(),
        requestUri: appleReturnURL, returnSecureToken: true }), signal, 'apple')
    if (result.providerId !== 'apple.com') throw new AuthenticationFailure('apple')
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
  async refresh(refreshToken: string, uid: string, authTime: number, signal: AbortSignal): Promise<AuthTokens> {
    const result = await this.request(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(this.config.apiKey)}`,
      { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Firebase-AppCheck': await this.proof(signal) },
      new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }).toString(), signal)
    // The securetoken endpoint returns a project number in project_id.
    if (result.user_id !== uid || result.project_id !== this.config.projectNumber || result.token_type !== 'Bearer') throw new AuthenticationFailure('protocol')
    const tokens = this.tokens(result.id_token, result.refresh_token, result.expires_in, uid)
    if (tokens.authTime !== authTime) throw new AuthenticationFailure('invalid-credential')
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
  async startSession(idToken: string, sessionId: string, version: string, provider: 'custom' | 'apple.com', signal: AbortSignal): Promise<void> {
    const result = await this.callable('startMorseDeviceSession', { sessionId,
      deviceLabel: `Morse · ${this.config.platform}`, platform: this.config.platform, appVersion: version, loginProvider: provider }, signal, idToken)
    if (result.sessionId !== sessionId) throw new AuthenticationFailure('protocol')
  }
  async revokeSession(idToken: string, sessionId: string, signal: AbortSignal): Promise<void> {
    const result = await this.callable('revokeMorseDeviceSession', { sessionId }, signal, idToken)
    if (result.ok !== true) throw new AuthenticationFailure('protocol')
  }
}
