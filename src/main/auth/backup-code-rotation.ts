import { MorseCallableFailure } from '../network/morse-callable'
import { recordRetry } from '../platform/connection-diagnostics'
import { tr } from '../../shared/i18n'

// A recovery code change, carried the way A3 asks (contract §4, common rules 1, 4 and 6; the server live since
// 2026-09-30): the new code is kept with the old one on this device the moment it is made; updateBackupCode goes, and a
// request whose answer was lost goes again with the same two codes — at once when the network comes back, otherwise
// after 2 s doubling to a minute — because the server answers a repeat of a change it has already made with
// `ok, applied: false` (§3-2). `ok` makes the new code the account's; the server refusing the old code drops the change
// and keeps the old. A new change waits for one still on its way, so two never overlap.
export function rotationRetryDelay(attempt: number): number { return Math.min(60000, 2000 * 2 ** Math.max(0, attempt - 1)) }

export interface RotationStore {
  read(uid: string): Promise<{ old: string; next: string } | null>
  save(uid: string, rotation: { old: string; next: string }): Promise<void>
  clear(uid: string): Promise<void>
  // The code this device keeps for an account that signed up with Apple (iOS SavedAccount.backupCode), if any.
  kept(uid: string): Promise<string | null>
  keep(uid: string, code: string): Promise<void>
}
// updateBackupCode for an account, or null while it cannot be sent (not the active account, not connected).
export type RotationSender = (uid: string) => ((old: string, next: string) => Promise<void>) | null
type Outcome = 'done' | 'refused' | 'waiting'

export class BackupCodeRotations {
  private readonly chains = new Map<string, Promise<unknown>>()
  private readonly retries = new Map<string, { attempt: number; timer: ReturnType<typeof setTimeout> | null }>()
  private closed = false
  constructor(private readonly store: RotationStore, private readonly sender: RotationSender, private readonly generate: () => string) {}

  // «새 코드 만들기»: `current` is the code the person typed, or null to use the one this device keeps. What is on its
  // way is finished first; while it cannot be, its new code is shown again, still waiting.
  change(uid: string, current: string | null): Promise<{ backupCode: string; confirmed: boolean }> {
    return this.serial(uid, async () => {
      const waiting = await this.store.read(uid)
      let old = current ?? await this.store.kept(uid)
      if (waiting) {
        const outcome = await this.send(uid, waiting)
        if (outcome === 'waiting') return { backupCode: waiting.next, confirmed: false }
        // The change on its way went through: the code the person knew then is no longer the account's.
        if (outcome === 'done' && (old === null || old === waiting.old)) old = waiting.next
      }
      if (!old) throw new Error(tr('현재 복구 코드를 입력해 주세요.'))
      const rotation = { old, next: this.generate() }
      await this.store.save(uid, rotation)
      const outcome = await this.send(uid, rotation)
      if (outcome === 'refused') throw new Error(tr('복구 코드를 바꾸지 못했습니다. 현재 복구 코드를 확인해 주세요.'))
      return { backupCode: rotation.next, confirmed: outcome === 'done' }
    })
  }
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
  }

  private serial<T>(uid: string, work: () => Promise<T>): Promise<T> {
    const task = (this.chains.get(uid) ?? Promise.resolve()).catch(() => {}).then(work)
    this.chains.set(uid, task.catch(() => {}))
    return task
  }
  private async send(uid: string, rotation: { old: string; next: string }): Promise<Outcome> {
    const update = this.sender(uid)
    if (!update) { this.later(uid, null); return 'waiting' }
    try {
      await update(rotation.old, rotation.next)
    } catch (error) {
      if (error instanceof MorseCallableFailure && error.delivery === 'answered') {
        // «Invalid backup code.» (or the session ended): the server kept the old code.
        await this.store.clear(uid).catch(() => {})
        this.forget(uid)
        return 'refused'
      }
      this.later(uid, error)
      return 'waiting'
    }
    // ok, applied or not: the new code is the account's.
    if (await this.store.kept(uid).catch(() => null)) await this.store.keep(uid, rotation.next).catch(() => {})
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
