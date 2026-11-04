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
// A3 §10 (B14): the server tells a repeat of a change it made only within seven days of it (talky-auth-callables.js
// BACKUP_CODE_RESEND_WINDOW_MS); past that a repeat is refused like a wrong code though the new code may be the account's.
// A change waiting that long is not sent again: both codes are shown for the person to keep, and a new code is made anew.
export const rotationExpiryMs = 7 * 24 * 60 * 60000

export type ProviderKind = 'apple' | 'google'
// An identity token of the provider (Apple's with the raw nonce whose SHA-256 the request carried), and when it came.
export interface ProviderProof { kind: ProviderKind; idToken: string; nonce?: string; obtainedAt: number }
// `at`: when the new code was made (ms); a record from an earlier build has none and is dated when it is next read.
export type Rotation = ({ old: string; next: string; byProvider?: undefined } | { old: null; next: string; byProvider: ProviderKind }) & { at?: number }
// `expired`: a change that waited past seven days, not sent again; `previous` is its old code, shown with the new one.
export interface RotationResult { backupCode: string; confirmed: boolean; needsProof?: boolean; expired?: true; previous?: string }

// The stored form of a change, read back or about to be written: two codes, or a new code made by identity. Anything
// else is no change (an earlier build reads one made by identity as none: its old code is not a code).
export function rotationRecord(value: unknown): Rotation | null {
  if (!value || typeof value !== 'object') return null
  const { old, next, byProvider, at } = value as { old?: unknown; next?: unknown; byProvider?: unknown; at?: unknown }
  const valid = (code: unknown): code is string => typeof code === 'string' && /^[A-Z0-9-]{1,64}$/.test(code)
  if (!valid(next)) return null
  const dated = typeof at === 'number' && Number.isSafeInteger(at) && at > 0 ? { at } : {}
  if (byProvider === undefined) return valid(old) ? { old, next, ...dated } : null
  return old === null && (byProvider === 'apple' || byProvider === 'google') ? { old: null, next, byProvider, ...dated } : null
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
type Outcome = 'done' | 'wrong-code' | 'needs-proof' | 'identity-refused' | 'rate-limited' | 'sign-in' | 'password' | 'refused' | 'waiting' | 'expired'

// What an answer to updateBackupCode does to the change (A3 §10, B14; the server's refusals,
// reports/server/2026-11-01-b14-update-backup-code-refusals.md). The server writes the new code in one commit and refuses
// nothing after it, so a refusal means nothing changed:
// - Only the server's own «Invalid backup code.» — permission-denied with no reason (talky-security.js verifyBackupForUid)
//   — says the old code is not the account's.
// - The identity check answers with its own reasons (morse-provider-proof.js): a token past ten minutes is asked for again
//   with the same new code kept; another identity, or one that does not check out, refuses it.
// - The callable wrapper turns a request away first with a reason (morse-callable-auth.js): a revoked session asks for
//   signing in again, a session waiting for its password for that password; a ban and any other reason refuse it.
// - A day's reissues used up (rate-limited, retryAfterSec): a wait of a minute or less goes again with the same new code; a
//   longer one drops the change and says how long (A3 §10's last line).
// An answer that turns it away for now waits as a lost one does; any other answer refuses it. Refused, the change is
// dropped and nothing goes again by itself.
export function rotationAnswer(error: unknown): Exclude<Outcome, 'done' | 'expired'> {
  if (!(error instanceof MorseCallableFailure) || error.delivery !== 'answered') return 'waiting'
  if (error.status === 'PERMISSION_DENIED') {
    if (!error.reason) return 'wrong-code'
    if (error.reason === 'provider-proof-stale') return 'needs-proof'
    if (error.reason === 'provider-proof-invalid' || error.reason === 'provider-not-linked') return 'identity-refused'
    if (error.reason === 'session-revoked') return 'sign-in'
    if (error.reason === 'password-needed') return 'password'
    return 'refused'
  }
  if (error.status === 'RESOURCE_EXHAUSTED' && error.reason === 'rate-limited') return 'rate-limited'
  return transientAnswers.has(error.status) ? 'waiting' : 'refused'
}

const wrongCode = (): Error => new Error(tr('복구 코드를 바꾸지 못했습니다. 현재 복구 코드를 확인해 주세요.'))
// iOS settings.backupCode.identityRefused / identityRateLimited.
const identityRefused = (): Error => new Error(tr('이 계정에 연결된 Apple·Google 계정이 아니에요. 바뀐 것은 없어요.'))
// A3 §10: why a refused change changed nothing, for each reason.
const signInAgain = (): Error => new Error(tr('다시 로그인한 뒤 복구 코드를 바꿔 주세요. 바뀐 것은 없어요.'))
const passwordFirst = (): Error => new Error(tr('2단계 인증 비밀번호를 확인한 뒤 복구 코드를 바꿔 주세요. 바뀐 것은 없어요.'))
const tryAgain = (): Error => new Error(tr('복구 코드를 바꾸지 못했습니다. 다시 시도해 주세요.'))
// A3 §10: the server's wait past which a day's limit is told instead of waited out.
export const rotationShortWaitMs = 60000
export function rateLimitedText(waitMs: number): string {
  const minutes = Math.max(1, Math.ceil(waitMs / 60000))
  return minutes >= 60 ? tr('지금은 더 만들 수 없어요. 약 {0}시간 뒤에 다시 시도해 주세요.', [Math.ceil(minutes / 60)])
    : tr('지금은 더 만들 수 없어요. 약 {0}분 뒤에 다시 시도해 주세요.', [minutes])
}
function refusal(outcome: Outcome, waitMs = 0): Error | null {
  if (outcome === 'rate-limited') return new Error(rateLimitedText(waitMs))
  return outcome === 'wrong-code' ? wrongCode() : outcome === 'identity-refused' ? identityRefused() : outcome === 'sign-in' ? signInAgain()
    : outcome === 'password' ? passwordFirst() : outcome === 'refused' ? tryAgain() : null
}
// Past seven days: both codes, kept by the person, and a new change made anew.
const expiredResult = (waiting: Rotation): RotationResult => ({ backupCode: waiting.next, confirmed: false, expired: true, ...(waiting.old ? { previous: waiting.old } : {}) })

export class BackupCodeRotations {
  private readonly chains = new Map<string, Promise<unknown>>()
  private readonly retries = new Map<string, { attempt: number; timer: ReturnType<typeof setTimeout> | null }>()
  private readonly proofs = new Map<string, ProviderProof>()
  // The server's last long wait for an account's change (rate-limited past a minute), for the words that say how long.
  private readonly waits = new Map<string, number>()
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
        if (outcome === 'expired') { await this.store.clear(uid).catch(() => {}); return expiredResult(waiting) }
        // The change on its way went through: the code the person knew then is no longer the account's.
        if (outcome === 'done' && (old === null || old === waiting.old || waiting.old === null)) old = waiting.next
        // Its old code was refused: the same code would only be refused again.
        if (outcome === 'wrong-code' && old === waiting.old) throw wrongCode()
      }
      if (!old) throw new Error(tr('현재 복구 코드를 입력해 주세요.'))
      const rotation: Rotation = { old, next: this.generate(), at: this.now() }
      await this.store.save(uid, rotation)
      const outcome = await this.send(uid, rotation)
      const refused = refusal(outcome, this.waits.get(uid))
      if (refused) throw refused
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
        if (outcome === 'expired') { await this.store.clear(uid).catch(() => {}); return expiredResult(waiting) }
        if (outcome === 'identity-refused' || outcome === 'sign-in' || outcome === 'password' || outcome === 'rate-limited') throw refusal(outcome, this.waits.get(uid))!
      }
      const rotation: Rotation = { old: null, next: this.generate(), byProvider: proof.kind, at: this.now() }
      await this.store.save(uid, rotation)
      const outcome = await this.send(uid, rotation)
      // By identity there is no old code to be wrong: the server's «Invalid backup code.» is another refusal here.
      const refused = refusal(outcome === 'wrong-code' ? 'refused' : outcome, this.waits.get(uid))
      if (refused) throw refused
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
    // Dated when first read by this build; past seven days it is not sent again (rotationExpiryMs).
    if (rotation.at === undefined) { rotation = { ...rotation, at: this.now() }; await this.store.save(uid, rotation).catch(() => {}) }
    // Kept until a «새 코드 만들기» shows both codes (expiredResult), which then lets it go.
    if (this.now() - rotation.at! > rotationExpiryMs) { this.forget(uid); return 'expired' }
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
      // The same new code goes again once the server's wait is over (A3 §10, a passing refusal).
      if (answer === 'rate-limited') {
        const wait = error instanceof MorseCallableFailure ? error.retryAfterSec * 1000 : 0
        if (wait <= rotationShortWaitMs) { this.later(uid, error, wait); return 'waiting' }
        // Past a minute: dropped, nothing goes again by itself, and the person is told how long.
        this.waits.set(uid, wait)
      }
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
  private later(uid: string, error: unknown, atLeast = 0): void {
    if (this.closed) return
    const retry = this.retries.get(uid) ?? { attempt: 0, timer: null }
    if (retry.timer) clearTimeout(retry.timer)
    const attempt = retry.attempt + 1, delay = Math.max(rotationRetryDelay(attempt), atLeast)
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
