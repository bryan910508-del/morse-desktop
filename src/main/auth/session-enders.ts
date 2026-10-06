// Portions of this file follow Telegram Desktop (https://github.com/telegramdesktop/tdesktop, 7.2.8, 272f6f5c),
// Copyright (c) 2014-2026 The Telegram Desktop Authors. Licensed under GPL-3.0-or-later; see LEGAL.
import { AuthenticationFailure } from './contracts'
import { recordRetry } from '../platform/connection-diagnostics'

// Sessions this device still has to end on the server, each with its own credential — tdesktop's keys to destroy
// (Main::Account::destroyMtpKeys, an MTP::Instance of Mode::KeysDestroyer): a sign-in this device left behind is
// ended by the device itself, with the credential that sign-in had, and the list is written down so a restart goes
// on with it (main_account.cpp keysToDestroy). Two ways leave one behind: a QR sign-in that puts a new session in the
// place of a saved one of the same account, and a sign-out whose request to the server did not get through. Each is
// ended with its own refreshed token by revokeMorseDeviceSession{signOut: true} — a session ending itself, which the
// server's fresh-session rule does not stop. Like auth.logOut → destroy_auth_key, an answer takes it off the list —
// done, already ended, or a credential that can no longer end anything — and only a request that did not get through
// keeps it for later: at start, when the network is back, and from 2 s doubling to 10 minutes.
export interface EndingSession { uid: string; sessionId: string; refreshToken: string; authTime: number }
export interface EndingStore {
  read(): Promise<EndingSession[]>
  write(list: EndingSession[]): Promise<void>
}
export interface EndingApi {
  refresh(refreshToken: string, uid: string, authTime: number, signal: AbortSignal): Promise<{ idToken: string }>
  signOutSession(idToken: string, sessionId: string, signal: AbortSignal): Promise<void>
}
// The session a saved account of this device uses now, which is never ended from here.
export type CurrentSession = (uid: string) => Promise<string | null>

export function endingRetryDelay(attempt: number): number { return Math.min(600000, 2000 * 2 ** Math.max(0, attempt - 1)) }

// What a failure means for the session: ended (or not to be ended with this credential) — off the list — or later.
// signOutSession already takes «session-revoked» as done; a refresh refused (invalid-credential) or a banned account
// has nothing left to end; `protocol` is a credential of another generation, which cannot end it either.
export function endingOutcome(error: unknown): 'ended' | 'later' {
  if (!(error instanceof AuthenticationFailure)) return 'later'
  return ['revoked', 'invalid-credential', 'banned', 'protocol'].includes(error.code) ? 'ended' : 'later'
}

const valid = (entry: EndingSession): boolean => Boolean(entry.uid && entry.sessionId && entry.refreshToken) && Number.isSafeInteger(entry.authTime) && entry.authTime > 0

export class SessionEnders {
  private tail: Promise<unknown> = Promise.resolve()
  private timer: ReturnType<typeof setTimeout> | null = null
  private attempt = 0
  private closed = false
  private readonly controller = new AbortController()
  constructor(private readonly store: EndingStore, private readonly api: EndingApi | null, private readonly current: CurrentSession) {}

  // Written down before the credential it holds is replaced or removed anywhere else.
  add(entry: EndingSession): Promise<void> {
    if (!valid(entry)) return Promise.resolve()
    return this.serial(async () => {
      const list = (await this.store.read()).filter(item => item.sessionId !== entry.sessionId)
      await this.store.write([...list, entry])
    })
  }
  // At start and when the network is back: what waits goes now, its wait started over.
  runNow(): void {
    if (this.closed) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.attempt = 0
    void this.run().catch(() => {})
  }
  close(): void {
    this.closed = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.controller.abort()
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const task = this.tail.catch(() => {}).then(work)
    this.tail = task.catch(() => {})
    return task
  }
  private run(): Promise<void> {
    return this.serial(async () => {
      if (this.closed || !this.api) return
      let left = false
      for (const entry of await this.store.read()) {
        if (this.closed) return
        let outcome: 'ended' | 'later'
        if (await this.current(entry.uid).catch(() => null) === entry.sessionId) outcome = 'ended'
        else {
          try {
            const signal = AbortSignal.any([this.controller.signal, AbortSignal.timeout(35000)])
            const { idToken } = await this.api.refresh(entry.refreshToken, entry.uid, entry.authTime, signal)
            await this.api.signOutSession(idToken, entry.sessionId, signal)
            outcome = 'ended'
          } catch (error) {
            outcome = endingOutcome(error)
            if (outcome === 'later') recordRetry('session-end', 'send', error, endingRetryDelay(this.attempt + 1))
          }
        }
        if (outcome === 'later') { left = true; continue }
        await this.store.write((await this.store.read()).filter(item => item.sessionId !== entry.sessionId))
      }
      if (left) this.later()
      else this.attempt = 0
    })
  }
  private later(): void {
    if (this.closed) return
    if (this.timer) clearTimeout(this.timer)
    this.attempt++
    this.timer = setTimeout(() => { this.timer = null; void this.run().catch(() => {}) }, endingRetryDelay(this.attempt))
  }
}
