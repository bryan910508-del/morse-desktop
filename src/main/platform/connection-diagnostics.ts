import { app } from 'electron'
import { appendFile, mkdir, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { failureKind, type FailureKind } from './failure-kind'
import { registrationWords } from '../network/registration-outcome'

// Local diagnostics for the account connection: when it goes down or comes back, and why (Socket.IO's reason, the
// server's registration refusal, a renewal). Only the step and that reason are written — no account, token, chat or
// address. Every line is kept, since how often it happens is the point.
let written = 0, tail: Promise<unknown> = Promise.resolve()

export function recordConnectionStep(step: string, detail = ''): void {
  write(step, connectionDetail(detail))
}
// Anything long enough to be a token is hidden, except the server's own registration words (registrationWords):
// `session-unconfirmed` is as long as a token but says only why the socket was refused.
export function connectionDetail(detail: string): string {
  return detail.replace(/[A-Za-z0-9_-]{16,}/g, word => registrationWords.has(word) ? word : '*').slice(0, 80)
}
// An attempt of something waiting to be sent that failed: which queue, which step of it, the kind of failure
// (failure-kind.ts: 안 보냄/모름/서버 답 and a code) and, when it goes again, how long it now waits. The detail is made of
// those codes alone, so it is kept whole (a status name such as DEADLINE_EXCEEDED is longer than the scrub allows).
export function recordRetry(queue: string, stage: string, failure: unknown, waitMs?: number): void {
  const { delivery, code } = isKind(failure) ? failure : failureKind(failure)
  const wait = waitMs === undefined ? '' : ` wait=${Math.round(waitMs / 100) / 10}s`
  write('retry', `${queue} ${stage} ${delivery} ${code}${wait}`.replace(/[^\w:/=. -]/g, '').slice(0, 120))
}
// A5 contract §4: why an account is being signed out — which of the server's answers (§3-1) it was, as this build's own
// names for them (a step, a failure code, a socket reason). Nothing that names the account or the session goes in, so
// the detail is kept whole, as recordRetry keeps its codes.
export function recordSignOutBasis(basis: string): void {
  write('sign-out-basis', basis.replace(/[^\w:/=. -]/g, '').slice(0, 120))
}
// Firestore watches that ended and listen again after a wait, and ones that are current again. Dozens run at once, so
// one line of a kind every five seconds is enough to show when reads failed, why, and when they came back.
const watchLines = new Map<string, number>()
export function recordWatch(failure: unknown, waitMs?: number, where = ''): void {
  const kind = failure === null ? 'back' : (({ delivery, code }) => `${delivery} ${code}`)(failureKind(failure))
  const key = `${kind} ${where.split(' ')[0] ?? ''}`, now = Date.now()
  if ((watchLines.get(key) ?? 0) > now - 5000) return
  watchLines.set(key, now)
  write(failure === null ? 'watch-back' : 'watch-retry', `${failure === null ? '' : kind} ${where}${waitMs === undefined ? '' : ` wait=${Math.round(waitMs / 100) / 10}s`}`.trim().replace(/[^\w:/=. #-]/g, '').slice(0, 120))
}
const isKind = (value: unknown): value is FailureKind => Boolean(value && typeof value === 'object' && 'delivery' in value && 'code' in value && !(value instanceof Error))
function write(step: string, detail: string): void {
  if (written >= 2000) return
  written++
  const line = JSON.stringify({ at: new Date().toISOString(), version: app.getVersion(), step, detail })
  tail = tail.then(async () => {
    try {
      const directory = app.getPath('logs'), file = join(directory, 'connection-check.log')
      await mkdir(directory, { recursive: true })
      const size = await stat(file).then(value => value.size, () => 0)
      if (size > 256 * 1024) await rename(file, `${file}.1`).catch(() => {})
      await appendFile(file, `${line}\n`, { encoding: 'utf8', mode: 0o600 })
    } catch { /* Diagnostics are best effort. */ }
  })
}
