import { MorseCallableFailure, transientAnswers } from '../network/morse-callable'
import { recordRetry } from '../platform/connection-diagnostics'
import { tr } from '../../shared/i18n'

// A recovery code change, carried the way A3 asks (contract §4, common rules 1, 4 and 6; the server live since
// 2026-09-30): the new code is kept with the old one on this device the moment it is made; updateBackupCode goes, and a
// request whose answer was lost goes again with the same two codes — at once when the network comes back, otherwise
// after 2 s doubling to a minute — because the server answers a repeat of a change it has already made with
// `ok, applied: false` (§3-2). `ok` makes the new code the account's; the server refusing the old code drops the change
// and keeps the old. A new change waits for one still on its way, so two never overlap.
// With no old code (A3 §9, 3-1d), the account's Apple or Google identity shown again stands for it: the change is kept
// the same way, marked byProvider, and the identity token stays in memory only — sent while it is under nine minutes old
// (the server takes ten), so a change that has to go again after that waits for the person to confirm again.
export function rotationRetryDelay(attempt: number): number { return Math.min(60000, 2000 * 2 ** Math.max(0, attempt - 1)) }
export const proofFreshMs = 9 * 60000

export type ProviderKind = 'apple' | 'google'
// An identity token of the provider (Apple's with the raw nonce whose SHA-256 the request carried), and when it came.
export interface ProviderProof { kind: ProviderKind; idToken: string; nonce?: string; obtainedAt: number }
export type Rotation = { old: string; next: string; byProvider?: undefined } | { old: null; next: string; byProvider: ProviderKind }
export interface RotationResult { backupCode: string; confirmed: boolean; needsProof?: boolean }

// The stored form of a change, read back or about to be written: two codes, or a new code made by identity. Anything
// else is no change (an earlier build reads one made by identity as none: its old code is not a code).
export function rotationRecord(value: unknown): Rotation | null {
  if (!value || typeof value !== 'object') return null
  const { old, next, byProvider } = value as { old?: unknown; next?: unknown; byProvider?: unknown }
  const valid = (code: unknown): code is string => typeof code === 'string' && /^[A-Z0-9-]{1,64}$/.test(code)
  if (!valid(next)) return null
  if (byProvider === undefined) return valid(old) ? { old, next } : null
  return old === null && (byProvider === 'apple' || byProvider === 'google') ? { old: null, next, byProvider } : null
}

export interface RotationStore {
  read(uid: string): Promise<Rotation | null>
  save(uid: string, rotation: Rotation): Promise<void>
  clear(uid: string): Promise<void>
  // The code this device keeps for an account that signed up with Apple (iOS SavedAccount.backupCode), if any.
  kept(uid: string): Promise<string | null>
  keep(uid: string, code: string): Promise<void>
  // The kept code leaves this device while it is still `code` — the one the server just refused (iOS
  // AuthService.forgetRefusedBackupCode): settings then ask for the code instead of sending the wrong one again.
  forget(uid: string, code: string): Promise<void>
}
// One updateBackupCode: with the old code, or with the identity in its place.
export type RotationRequest = { next: string; old: string } | { next: string; proof: ProviderProof }
// updateBackupCode for an account, or null while it cannot be sent (not the active account, not connected).
export type RotationSender = (uid: string) => ((request: RotationRequest) => Promise<void>) | null
type Outcome = 'done' | 'wrong-code' | 'needs-proof' | 'identity-refused' | 'rate-limited' | 'refused' | 'waiting'

// What an answer to updateBackupCode does to the change. Only the server's own «Invalid backup code.» — permission-denied
// with no reason (talky-security.js verifyBackupForUid) — says the old code is not the account's. The identity check
// answers with its own reasons (morse-provider-proof.js): a token past ten minutes is asked for again with the change
// kept; another identity, or one that does not check out, refuses it. The callable wrapper turns a request away first
// with a reason (session-revoked, a ban, password-needed — morse-callable-auth.js): that is not about the change, so it
// stays and goes once the account is connected again (held, no timer). A day's reissues used up drop it (iOS, Android).
// An answer that turns it away for now waits as a lost one does; any other answer refuses it.
export function rotationAnswer(error: unknown): Exclude<Outcome, 'done'> | 'held' {
  if (!(error instanceof MorseCallableFailure) || error.delivery !== 'answered') return 'waiting'
  if (error.status === 'PERMISSION_DENIED') {
    if (!error.reason) return 'wrong-code'
    if (error.reason === 'provider-proof-stale') return 'needs-proof'
    if (error.reason === 'provider-proof-invalid' || error.reason === 'provider-not-linked') return 'identity-refused'
    return 'held'
  }
  if (error.status === 'RESOURCE_EXHAUSTED' && error.reason === 'rate-limited') return 'rate-limited'
  return transientAnswers.has(error.status) ? 'waiting' : 'refused'
}

const wrongCode = (): Error => new Error(tr('복구 코드를 바꾸지 못했습니다. 현재 복구 코드를 확인해 주세요.'))
// iOS settings.backupCode.identityRefused / identityRateLimited.
const identityRefused = (): Error => new Error(tr('이 계정에 연결된 Apple·Google 계정이 아니에요. 바뀐 것은 없어요.'))
const rateLimited = (): Error => new Error(tr('오늘은 더 만들 수 없어요. 내일 다시 시도해 주세요.'))

export class BackupCodeRotations {
  private readonly chains = new Map<string, Promise<unknown>>()
  private readonly retries = new Map<string, { attempt: number; timer: ReturnType<typeof setTimeout> | null }>()
  private readonly proofs = new Map<string, ProviderProof>()
  private closed = false
  constructor(private readonly store: RotationStore, private readonly sender: RotationSender, private readonly generate: () => string,
    private readonly now: () => number = Date.now) {}

  // «새 코드 만들기»: `current` is the code the person typed, or null to use the one this device keeps. What is on its
  // way is finished first; while it cannot be, its new code is shown again, still waiting.
  change(uid: string, current: string | null): Promise<RotationResult> {
    return this.serial(uid, async () => {
      const waiting = await this.store.read(uid)
      let old = current ?? await this.store.kept(uid)
      if (waiting) {
        const outcome = await this.send(uid, waiting)
        if (outcome === 'waiting' || outcome === 'needs-proof') return { backupCode: waiting.next, confirmed: false, ...(outcome === 'needs-proof' ? { needsProof: true } : {}) }
        // The change on its way went through: the code the person knew then is no longer the account's.
        if (outcome === 'done' && (old === null || old === waiting.old || waiting.old === null)) old = waiting.next
        // Its old code was refused: the same code would only be refused again.
        if (outcome === 'wrong-code' && old === waiting.old) throw wrongCode()
      }
      if (!old) throw new Error(tr('현재 복구 코드를 입력해 주세요.'))
      const rotation: Rotation = { old, next: this.generate() }
      await this.store.save(uid, rotation)
      const outcome = await this.send(uid, rotation)
      if (outcome === 'wrong-code') throw wrongCode()
      if (outcome === 'refused') throw new Error(tr('복구 코드를 바꾸지 못했습니다. 다시 시도해 주세요.'))
      return { backupCode: rotation.next, confirmed: outcome === 'done' }
    })
  }
  // «Apple/Google로 확인하고 새 코드 만들기» (A3 §9): the identity just shown again stands for the old code. A change on its
  // way is finished first — one made this way goes again with this identity; once it is through, its code is the new one.
  changeByProvider(uid: string, proof: ProviderProof): Promise<RotationResult> {
    return this.serial(uid, async () => {
      this.proofs.set(uid, proof)
      const waiting = await this.store.read(uid)
      if (waiting) {
        const outcome = await this.send(uid, waiting)
        if (outcome === 'done') return { backupCode: waiting.next, confirmed: true }
        if (outcome === 'waiting' || outcome === 'needs-proof') return { backupCode: waiting.next, confirmed: false, ...(outcome === 'needs-proof' ? { needsProof: true } : {}) }
        if (outcome === 'identity-refused') throw identityRefused()
        if (outcome === 'rate-limited') throw rateLimited()
      }
      const rotation: Rotation = { old: null, next: this.generate(), byProvider: proof.kind }
      await this.store.save(uid, rotation)
      const outcome = await this.send(uid, rotation)
      if (outcome === 'identity-refused') throw identityRefused()
      if (outcome === 'rate-limited') throw rateLimited()
      if (outcome === 'refused' || outcome === 'wrong-code') throw new Error(tr('복구 코드를 바꾸지 못했습니다. 다시 시도해 주세요.'))
      return { backupCode: rotation.next, confirmed: outcome === 'done', ...(outcome === 'needs-proof' ? { needsProof: true } : {}) }
    })
  }
  // A change made by identity that cannot go on until the person confirms again (iOS pendingNeedsProof).
  async needsProof(uid: string): Promise<boolean> {
    const waiting = await this.store.read(uid).catch(() => null)
    return waiting?.byProvider !== undefined && !this.freshProof(uid)
  }
  // The screen locked: no identity outlives it.
  dropProofs(): void { this.proofs.clear() }
  // The network is back, or the account became active: what waits goes now, its wait started over.
  retryNow(uid: string): void {
    if (this.closed) return
    const retry = this.retries.get(uid)
    if (retry?.timer) clearTimeout(retry.timer)
    this.retries.set(uid, { attempt: retry?.attempt ?? 0, timer: null })
    void this.serial(uid, async () => { const waiting = await this.store.read(uid); if (waiting) await this.send(uid, waiting) }).catch(() => {})
  }
  close(): void {
    this.closed = true
    for (const retry of this.retries.values()) if (retry.timer) clearTimeout(retry.timer)
    this.retries.clear()
    this.proofs.clear()
  }

  private serial<T>(uid: string, work: () => Promise<T>): Promise<T> {
    const task = (this.chains.get(uid) ?? Promise.resolve()).catch(() => {}).then(work)
    this.chains.set(uid, task.catch(() => {}))
    return task
  }
  private freshProof(uid: string): ProviderProof | null {
    const proof = this.proofs.get(uid)
    if (!proof) return null
    const age = this.now() - proof.obtainedAt
    if (age >= 0 && age < proofFreshMs) return proof
    this.proofs.delete(uid)
    return null
  }
  private async send(uid: string, rotation: Rotation): Promise<Outcome> {
    // Made by identity and none fresh enough to send: it waits for the person, not for a timer.
    const proof = rotation.byProvider ? this.freshProof(uid) : null
    if (rotation.byProvider && !proof) { this.forget(uid); return 'needs-proof' }
    const update = this.sender(uid)
    if (!update) { this.later(uid, null); return 'waiting' }
    try {
      await update(proof ? { next: rotation.next, proof } : { next: rotation.next, old: rotation.old as string })
    } catch (error) {
      const answer = rotationAnswer(error)
      if (answer === 'waiting') { this.later(uid, error); return 'waiting' }
      // Kept for when the account is back (retryNow); the session's own handling decides the rest.
      if (answer === 'held') { this.forget(uid); return 'waiting' }
      // Kept; the identity is asked for again.
      if (answer === 'needs-proof') { this.proofs.delete(uid); this.forget(uid); return 'needs-proof' }
      // The server kept the old code.
      await this.store.clear(uid).catch(() => {})
      this.forget(uid)
      if (answer === 'identity-refused') this.proofs.delete(uid)
      if (answer === 'wrong-code' && rotation.old !== null) await this.store.forget(uid, rotation.old).catch(() => {})
      return answer
    }
    // ok, applied or not: the new code is the account's. Made by identity, it is the code this device keeps from now on
    // (iOS storedCode); otherwise a kept code follows it.
    if (rotation.byProvider || await this.store.kept(uid).catch(() => null)) await this.store.keep(uid, rotation.next).catch(() => {})
    await this.store.clear(uid).catch(() => {})
    this.forget(uid)
    return 'done'
  }
  private later(uid: string, error: unknown): void {
    if (this.closed) return
    const retry = this.retries.get(uid) ?? { attempt: 0, timer: null }
    if (retry.timer) clearTimeout(retry.timer)
    const attempt = retry.attempt + 1, delay = rotationRetryDelay(attempt)
    if (error !== null) recordRetry('backup-code', 'send', error, delay)
    this.retries.set(uid, { attempt, timer: setTimeout(() => { this.retries.set(uid, { attempt, timer: null }); void this.serial(uid, async () => {
      const waiting = await this.store.read(uid); if (waiting) await this.send(uid, waiting)
    }).catch(() => {}) }, delay) })
  }
  private forget(uid: string): void {
    const retry = this.retries.get(uid)
    if (retry?.timer) clearTimeout(retry.timer)
    this.retries.delete(uid)
  }
}
