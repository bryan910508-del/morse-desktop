import { createHash, randomBytes } from 'node:crypto'
import { identifier } from '../../shared/validation'
import type { AccountProfile } from '../../shared/model'
import { AuthenticationFailure } from './contracts'

// A13 §2.1 · 08 §3.1 (Telegram auth.exportLoginToken / auth.importLoginToken, tdesktop intro/intro_qr.cpp): this
// computer shows a QR code, a phone of the account scans and approves it at once, and this computer takes the sign-in.
// The secret S stays in the main process (PKCE): only SHA-256(S) goes out when the code is issued, S itself only when
// the approved sign-in is redeemed — whoever sees the code or the issue answer cannot redeem it.
export interface QrAttempt { secret: string; binding: string; startedAt: number }
const base64url = (bytes: Buffer): string => bytes.toString('base64url')
export function newQrAttempt(now = Date.now()): QrAttempt {
  const secret = randomBytes(32)
  return { secret: base64url(secret), binding: base64url(createHash('sha256').update(secret).digest()), startedAt: now }
}
// An attempt lives ten minutes on the server (08 §3.3.1); this computer starts a new one a little before.
export const qrAttemptLifetimeMs = 9 * 60000
export const qrPollMs = 2000
export const qrRotateMs = 30000

const token43 = /^[A-Za-z0-9_-]{43}$/
function number(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
}
export type QrIssue = { state: 'pending'; token: string; refreshAfterMs: number } | { state: 'waiting'; pollAfterMs: number }
// exportMorseLoginToken: a new code (pending), or — the code already approved — only when to poll.
export function decodeQrIssue(result: Record<string, unknown>): QrIssue {
  if (result.state === 'pending') {
    if (typeof result.token !== 'string' || !token43.test(result.token)) throw new AuthenticationFailure('protocol')
    return { state: 'pending', token: result.token, refreshAfterMs: number(result.refreshAfterMs, qrRotateMs, 5000, 60000) }
  }
  if (typeof result.state === 'string') return { state: 'waiting', pollAfterMs: number(result.pollAfterMs, qrPollMs, 1000, 10000) }
  throw new AuthenticationFailure('protocol')
}
export type QrRedeem =
  | { state: 'waiting'; pollAfterMs: number }
  | { state: 'approved'; profile: AccountProfile; customToken: string; sessionId: string }
  // A13 §5: the account has a two-step password; the sign-in waits for it (checked in §24, not here).
  | { state: 'password-needed'; hint: string }
export function decodeQrRedeem(result: Record<string, unknown>): QrRedeem {
  if (result.state === 'approved') {
    if (typeof result.customToken !== 'string' || !result.customToken || result.customToken.length > 16384) throw new AuthenticationFailure('protocol')
    if (typeof result.userId !== 'string' || !result.userId || result.userId.length > 160) throw new AuthenticationFailure('protocol')
    if (typeof result.sessionId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(result.sessionId)) throw new AuthenticationFailure('protocol')
    const displayName = typeof result.displayName === 'string' && result.displayName && result.displayName.length <= 512 ? result.displayName : result.userId
    return { state: 'approved', profile: { uid: identifier(result.uid), userId: result.userId, displayName }, customToken: result.customToken, sessionId: result.sessionId }
  }
  if (result.state === 'password-needed') return { state: 'password-needed', hint: typeof result.hint === 'string' ? result.hint.slice(0, 64) : '' }
  if (typeof result.state === 'string') return { state: 'waiting', pollAfterMs: number(result.pollAfterMs, qrPollMs, 1000, 10000) }
  throw new AuthenticationFailure('protocol')
}
// app_config/qr_login {enabled} (A13 §2.1, D-6): everyone may read it; off — or unreadable — shows no QR.
export function qrSwitchOn(document: Record<string, unknown> | null): boolean {
  const fields = document?.fields as Record<string, { booleanValue?: unknown }> | undefined
  return fields?.enabled?.booleanValue === true
}
