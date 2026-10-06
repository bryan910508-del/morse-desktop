// Portions of this file follow Telegram Desktop (https://github.com/telegramdesktop/tdesktop, 7.2.8, 272f6f5c),
// Copyright (c) 2014-2026 The Telegram Desktop Authors. Licensed under GPL-3.0-or-later; see LEGAL.
import { app, BrowserWindow, ipcMain, net, session, shell, type IpcMainEvent } from 'electron'
import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { AuthenticationFailure, ProofWaiting, type AppCheckProof, type DesktopAppProofProvider } from './contracts'
import type { ProofTokenStore } from './proof-token-store'
import { tr } from '../../shared/i18n'
import { reachability } from '../network/reachability'

// The App Check token's claims must name this Web App and the Morse project and stay within the TTL.
function proofFromToken(token: string, appId: string): AppCheckProof {
  const parts = token.split('.')
  if (token.length > 16384 || parts.length !== 3) throw new Error('Malformed proof')
  const claims = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as Record<string, unknown>
  const expiresAt = Number(claims.exp) * 1000
  if (claims.sub !== appId || claims.iss !== 'https://firebaseappcheck.googleapis.com/123713400904' ||
      !Array.isArray(claims.aud) || !claims.aud.includes('projects/123713400904') ||
      !Number.isSafeInteger(claims.exp) || expiresAt <= Date.now() + 120000 || expiresAt > Date.now() + 3900000) throw new Error('Mismatched proof')
  return { token, expiresAt, appId }
}

interface Flight { controller: AbortController; promise: Promise<AppCheckProof>; consumers: number }
export type ProofFailureStep = 'page-error' | 'timeout' | 'load-failed' | 'renderer-gone' | 'invalid-response' | 'window-closed' | 'session-failed' | 'backoff'
interface ProofResponse { host: string; path: string; method: string; status: number; error: string }
interface ProofFailureEntry { step: ProofFailureStep; detail: string; blockedHosts: string[]; responses: ProofResponse[]; elapsedMs: number; platform: 'macOS' | 'Windows' }

const maxLogBytes = 256 * 1024
// The exchange normally ends in a few seconds; the hidden try gives up first, and the window in view has the rest of
// the 35 seconds FirebaseRest allows a proof.
const hiddenDeadline = 12000, visibleDeadline = 20000
// A page that never loaded used nothing up: a name that would not resolve or a network that changed
// under it is the machine's moment, not a refusal, and the sign-in waiting on it should not be failed
// for it. The log has three ERR_NAME_NOT_RESOLVED and one ERR_NETWORK_CHANGED in a single day.
const transientRetryDelay = 1500
// How long a machine that has just woken is given to have its network back before trying anyway.
const offlineWait = 15000
// Firebase refreshes an App Check token before it runs out. Acquiring only when a caller already needs
// it makes that caller wait for the whole exchange — 12 seconds when it times out — so it starts early.
const renewBefore = 10 * 60000
// A16: a token in hand is used until it is about to run out — a renewal that fails behind it costs nothing while it
// lasts. This much is kept for the request to reach Google.
const usableUntilBefore = 30000
// A16: after an exchange that failed, the next one waits — 2 s, doubling to a minute — or until the network comes
// back. Asking again at once cannot help: the reCAPTCHA key only scores, and a low score (a VPN exit, B99) stays
// low, while every caller that needed a token opened the check again.
// What a failed check is for the person: closed by them (cancelled), refused — the page's error with the exchange
// answering 403, a low reCAPTCHA score that waiting does not raise (a VPN exit, B99) — or lost (timeout, load, other).
export function proofFailureCode(step: ProofFailureStep, exchangeStatus: number | null): 'cancelled' | 'app-proof-refused' | 'app-proof' {
  if (step === 'window-closed') return 'cancelled'
  return step === 'page-error' && exchangeStatus === 403 ? 'app-proof-refused' : 'app-proof'
}
export function proofRetryDelay(failures: number): number { return failures <= 0 ? 0 : Math.min(60000, 2000 * 2 ** (failures - 1)) }
// A16: how a signed-in (or restoring) account asks the server for this app's token (getMorseDesktopAppCheckToken), its
// sign-in token renewed first when it is running out — renewing needs no proof; null when it cannot ask now.
export type SessionProof = (signal: AbortSignal) => Promise<string | null>
const guardedSessions = new WeakSet<Electron.Session>()

// Local diagnostics for a failed security check: the failed step, a short reason,
// blocked host names and, per verification request, its host, a short path and the
// HTTP status. Tokens, query strings, response bodies and account data are never
// written, and a logging problem never changes the sign-in result.
async function recordProofFailure(entry: ProofFailureEntry): Promise<void> {
  try {
    const directory = app.getPath('logs'), file = join(directory, 'security-check.log')
    await mkdir(directory, { recursive: true })
    const size = await stat(file).then(value => value.size, () => 0)
    if (size > maxLogBytes) await rename(file, `${file}.1`).catch(() => {})
    const line = JSON.stringify({ at: new Date().toISOString(), version: app.getVersion(), ...entry, detail: entry.detail.slice(0, 200) })
    await appendFile(file, `${line}\n`, { encoding: 'utf8', mode: 0o600 })
    console.warn(`[security-check] ${entry.step}${entry.detail ? `: ${entry.detail.slice(0, 200)}` : ''}`)
  } catch { /* Diagnostics are best effort. */ }
}

// How long the exchange took and which try carried it. No token, request or account data.
async function recordProofTiming(detail: string, elapsedMs: number, platform: 'macOS' | 'Windows'): Promise<void> {
  await recordProofFailure({ step: 'acquired' as ProofFailureStep, detail, blockedHosts: [], responses: [], elapsedMs, platform })
}

// The machine waking is when this is most often asked for, and Chromium answers ERR_INTERNET_DISCONNECTED
// in 90 milliseconds while the link is still coming up: the log has eleven of those in the thirteen
// seconds after a 761 second sleep, and then the exchange itself took 2.3. Waiting for the network to be
// there beats spending tries against one that is not.
async function whenOnline(signal: AbortSignal, deadlineMs: number): Promise<void> {
  const until = Date.now() + deadlineMs
  while (!net.isOnline() && Date.now() < until) {
    if (signal.aborted) throw new AuthenticationFailure('cancelled')
    await wait(500, signal)
  }
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((done, fail) => {
    const timer = setTimeout(() => { signal.removeEventListener('abort', stop); done() }, milliseconds)
    const stop = (): void => { clearTimeout(timer); fail(new AuthenticationFailure('cancelled')) }
    signal.addEventListener('abort', stop, { once: true }); if (signal.aborted) stop()
  })
}

// Web-origin attestation, not hardware or native binary attestation. The
// application server remains the authority for the token signature and App ID.
//
// A16 (§33, user «권장대로» 10-03 21:5x; B99): an account signed in on this computer is itself the proof — the server
// checks its session and gives the token (getMorseDesktopAppCheckToken), as Telegram Desktop needs nothing but its
// authorized session to work. The page is for the sign-in itself, and the window in view only before any account is
// signed in: once one is, a failed exchange waits (proofRetryDelay) and the account says «연결 중…» instead of
// showing the check again and again.
export class HostedWebAppProof implements DesktopAppProofProvider {
  private cached: AppCheckProof | null = null
  private stored: Promise<void> | null = null
  private renewal: Promise<unknown> | null = null
  private flight: Flight | null = null
  private readonly sessions = new Map<string, SessionProof>()
  private failures = 0
  private retryAt = 0
  // Whether the last failed exchange was refused (403) rather than lost — what its wait says.
  private refused = false
  constructor(private readonly origin: string, private readonly appId: string,
    private readonly platform: 'macOS' | 'Windows', private readonly store: ProofTokenStore | null = null,
    page?: (signal: AbortSignal, visible: boolean, deadlineMs: number) => Promise<AppCheckProof>) {
    // The page's check; a stand-in in the unit tests.
    this.page = page ?? ((signal, visible, deadlineMs) => this.attempt(signal, visible, deadlineMs))
    // The network coming back is worth a try at once (reconnect-now).
    reachability.subscribe(() => { this.retryAt = 0 })
  }
  private readonly page: (signal: AbortSignal, visible: boolean, deadlineMs: number) => Promise<AppCheckProof>
  // A signed-in account offers its session; the returned function takes it back (signed out, switched away, closed).
  useSession(uid: string, proof: SessionProof): () => void {
    this.sessions.set(uid, proof); this.retryAt = 0
    return () => { if (this.sessions.get(uid) === proof) this.sessions.delete(uid) }
  }
  get signedIn(): boolean { return this.sessions.size > 0 }

  async getProof(signal: AbortSignal): Promise<AppCheckProof> {
    if (signal.aborted) throw new AuthenticationFailure('cancelled')
    // A proof kept from the previous run is reused while it is still valid.
    this.stored ??= (async () => {
      const token = await this.store?.read().catch(() => null)
      if (!token || this.cached) return
      try { this.cached = proofFromToken(token, this.appId) } catch { /* expired or foreign proof */ }
    })()
    await this.stored
    if (signal.aborted) throw new AuthenticationFailure('cancelled')
    if (this.cached && this.cached.expiresAt > Date.now() + usableUntilBefore) {
      if (this.cached.expiresAt <= Date.now() + renewBefore) this.renewAhead()
      return this.cached
    }
    let flight = this.flight
    if (!flight || flight.controller.signal.aborted) {
      if (Date.now() < this.retryAt) throw Object.assign(new ProofWaiting(this.retryAt - Date.now(), this.refused), { proofStep: 'backoff' as ProofFailureStep })
      const controller = new AbortController()
      flight = { controller, consumers: 0, promise: Promise.resolve().then(() => this.counted(controller.signal)) }
      this.flight = flight
    }
    const owned = flight
    owned.consumers++
    return new Promise<AppCheckProof>((resolve, reject) => {
      let settled = false
      const finish = (proof?: AppCheckProof, error?: unknown): void => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', cancel)
        if (--owned.consumers === 0) {
          owned.controller.abort()
          if (this.flight === owned) this.flight = null
        }
        if (proof) resolve(proof)
        else reject(error)
      }
      const cancel = (): void => finish(undefined, new AuthenticationFailure('cancelled'))
      signal.addEventListener('abort', cancel, { once: true })
      owned.promise.then(proof => finish(proof), error => finish(undefined, error))
      if (signal.aborted) cancel()
    })
  }

  // One exchange, and what it does to the wait before the next (proofRetryDelay). A cancelled one says nothing.
  private async counted(signal: AbortSignal): Promise<AppCheckProof> {
    try {
      const proof = await this.acquire(signal)
      this.failures = 0; this.retryAt = 0; this.refused = false
      return proof
    } catch (error) {
      if (!signal.aborted && (error as AuthenticationFailure).code !== 'cancelled') {
        this.failures++; this.retryAt = Date.now() + proofRetryDelay(this.failures)
        this.refused = (error as AuthenticationFailure).code === 'app-proof-refused'
      }
      throw error
    }
  }
  // A16: a signed-in account's session first. Then the page, hidden only — the window in view is for the sign-in.
  private async bySession(signal: AbortSignal): Promise<AppCheckProof | null> {
    for (const [, ask] of [...this.sessions]) {
      const started = Date.now()
      try {
        const token = await ask(signal)
        if (!token) continue
        const proof = proofFromToken(token, this.appId)
        this.cached = proof; void this.store?.save(proof)
        void recordProofTiming('session', Date.now() - started, this.platform)
        return proof
      } catch (error) {
        if (signal.aborted) throw error
        void recordProofFailure({ step: 'session-failed', detail: (error as AuthenticationFailure).code ?? 'invalid', blockedHosts: [], responses: [], elapsedMs: Date.now() - started, platform: this.platform })
      }
    }
    return null
  }

  // reCAPTCHA Enterprise here is the score-based kind: nothing is asked of the person, so the page does its work
  // without being seen, as iOS's App Attest does its own. Only when that attempt is refused or runs out of time does
  // the window open — the same check, in view — so a sign-in is never worse off than before. The whole exchange stays
  // inside the 35 seconds the caller allows.
  private async acquire(signal: AbortSignal): Promise<AppCheckProof> {
    const started = Date.now()
    const stepOf = (error: unknown): ProofFailureStep | undefined => (error as { proofStep?: ProofFailureStep }).proofStep
    const done = (proof: AppCheckProof, how: string): AppCheckProof => { void recordProofTiming(how, Date.now() - started, this.platform); return proof }
    await whenOnline(signal, offlineWait)
    if (this.signedIn) {
      const proof = await this.bySession(signal)
      if (proof) return proof
      return done(await this.page(signal, false, hiddenDeadline), 'hidden-signed-in')
    }
    try {
      try { return done(await this.page(signal, false, hiddenDeadline), 'hidden') }
      catch (error) {
        const step = stepOf(error)
        if (signal.aborted || (step !== 'load-failed' && step !== 'renderer-gone')) throw error
        await whenOnline(signal, offlineWait)
        await wait(transientRetryDelay, signal)
        return done(await this.page(signal, false, hiddenDeadline), 'hidden-again')
      }
    } catch (error) {
      const step = stepOf(error)
      if (signal.aborted || !step || !['page-error', 'timeout', 'invalid-response'].includes(step)) throw error
      return done(await this.page(signal, true, visibleDeadline), 'visible')
    }
  }

  // «Try now»: the wait after a failed exchange is skipped and the check runs again (the person may have turned a VPN
  // off). A check already running is joined, not doubled.
  retryNow(signal: AbortSignal): Promise<AppCheckProof> {
    this.retryAt = 0
    return this.getProof(signal)
  }

  // The renewal runs on its own: whoever asked for the token gets the one in hand, and the exchange
  // that replaces it happens behind them.
  private renewAhead(): void {
    if (this.renewal) return
    const controller = new AbortController()
    const task = Promise.resolve().then(() => this.counted(controller.signal)).catch(() => {})
      .finally(() => { if (this.renewal === task) this.renewal = null })
    this.renewal = task
  }

  private attempt(signal: AbortSignal, visible: boolean, deadlineMs: number): Promise<AppCheckProof> {
    if (signal.aborted) return Promise.reject(new AuthenticationFailure('cancelled'))
    const requestId = randomUUID(), started = Date.now(), blocked = new Set<string>(), responses: ProofResponse[] = []
    // The App Check exchange's answer: 403 is a refusal (a low reCAPTCHA score), told apart from a lost check.
    let exchangeStatus: number | null = null, exchangeSeen: (() => void) | null = null
    const url = `${this.origin}/verify.html#${new URLSearchParams({ platform: this.platform, requestId })}`
    // One persistent partition keeps reCAPTCHA's cookies between checks, which its risk
    // assessment uses; other page storage is cleared after each check. Each request still
    // has its own requestId, so a stale page cannot complete a new one.
    const isolated = session.fromPartition('persist:morse-proof', { cache: false })
    isolated.setPermissionRequestHandler((_contents, _permission, answer) => answer(false))
    isolated.setPermissionCheckHandler(() => false)
    isolated.setDevicePermissionHandler(() => false)
    if (!guardedSessions.has(isolated)) { guardedSessions.add(isolated); isolated.on('will-download', event => event.preventDefault()) }
    isolated.webRequest.onBeforeRequest((details, answer) => {
      let allowed = false, target: URL | null = null
      try {
        target = new URL(details.url)
        const pathname = decodeURIComponent(target.pathname)
        allowed = target.protocol === 'https:' && (
          target.origin === this.origin ||
          (['www.google.com', 'www.gstatic.com', 'recaptcha.google.com'].includes(target.hostname) && target.pathname.startsWith('/recaptcha/')) ||
          (['firebaseappcheck.googleapis.com', 'content-firebaseappcheck.googleapis.com'].includes(target.hostname) && ['talky-a38c3', '123713400904'].some(project =>
            pathname === `/v1/projects/${project}/apps/${this.appId}:exchangeRecaptchaEnterpriseToken`)) ||
          (target.hostname === 'firebaseinstallations.googleapis.com' && target.pathname.startsWith('/v1/projects/talky-a38c3/installations'))
        )
      } catch { /* malformed URLs are denied */ }
      if (!allowed && blocked.size < 20) blocked.add(target?.hostname || 'invalid-url')
      answer({ cancel: !allowed })
    })
    // Which verification request the service refused (e.g. App Check exchange 403 or 429).
    const note = (details: { url: string; method: string; statusCode?: number; error?: string }): void => {
      if (responses.length >= 30) return
      try {
        const target = new URL(details.url), host = target.hostname
        const path = host.endsWith('firebaseappcheck.googleapis.com') ? target.pathname.split(':').pop() ?? ''
          : host === 'firebaseinstallations.googleapis.com' ? 'installations' : target.pathname.split('/').slice(0, 4).join('/')
        responses.push({ host, path: path.slice(0, 80), method: details.method, status: details.statusCode ?? 0, error: (details.error ?? '').slice(0, 80) })
        if (details.method === 'POST' && path === 'exchangeRecaptchaEnterpriseToken') { exchangeStatus = details.statusCode ?? 0; exchangeSeen?.() }
      } catch { /* malformed URLs are not recorded */ }
    }
    isolated.webRequest.onCompleted(details => note(details))
    isolated.webRequest.onErrorOccurred(details => note(details))
    const window = new BrowserWindow({
      width: 460, height: 380, show: false, title: tr('Morse 보안 확인'), resizable: false,
      autoHideMenuBar: true, backgroundColor: '#fbf8f2',
      webPreferences: {
        preload: join(__dirname, '../preload/app-proof.cjs'), session: isolated,
        sandbox: true, contextIsolation: true, nodeIntegration: false,
        webSecurity: true, allowRunningInsecureContent: false, webviewTag: false,
        devTools: false, navigateOnDragDrop: false, safeDialogs: true,
        // A page that is not shown must not be slowed down: reCAPTCHA's work runs on timers.
        backgroundThrottling: false,
      },
    })
    window.setMenu(null)
    window.webContents.setWindowOpenHandler(({ url: link }) => {
      if (['https://policies.google.com/privacy', 'https://policies.google.com/terms', `${this.origin}/THIRD_PARTY_NOTICES.txt`].includes(link)) {
        void shell.openExternal(link).catch(() => {})
      }
      return { action: 'deny' }
    })
    window.webContents.on('will-attach-webview', event => event.preventDefault())
    window.webContents.on('will-navigate', event => event.preventDefault())
    window.webContents.on('will-redirect', event => event.preventDefault())

    return new Promise<AppCheckProof>((resolve, reject) => {
      let settled = false
      const finish = (proof?: AppCheckProof, error = new AuthenticationFailure('app-proof')): void => {
        if (settled) return
        settled = true
        clearTimeout(deadline)
        signal.removeEventListener('abort', cancel)
        ipcMain.removeListener('morse:app-proof', receive)
        if (!window.isDestroyed()) window.destroy()
        void isolated.clearStorageData({ storages: ['filesystem', 'indexdb', 'localstorage', 'shadercache', 'serviceworkers', 'cachestorage'] }).catch(() => {})
        void isolated.closeAllConnections().catch(() => {})
        if (proof && !signal.aborted) { this.cached = proof; void this.store?.save(proof); resolve(proof) }
        else reject(error)
      }
      const fail = (step: ProofFailureStep, detail = ''): void => {
        if (settled) return
        void recordProofFailure({ step, detail, blockedHosts: [...blocked], responses: [...responses], elapsedMs: Date.now() - started, platform: this.platform })
        finish(undefined, Object.assign(new AuthenticationFailure(proofFailureCode(step, exchangeStatus)), { proofStep: step }))
      }
      // The page can tell its error before the exchange's answer is noted here (10-04 13:55: the first page-error had
      // no POST yet): it is given a moment to arrive, so a refusal is told as one.
      const pageFailed = (): void => {
        const detail = tr('reCAPTCHA Enterprise 또는 App Check 토큰 발급 실패')
        if (exchangeStatus !== null) { fail('page-error', detail); return }
        const late = setTimeout(() => { exchangeSeen = null; fail('page-error', detail) }, 800)
        exchangeSeen = () => { clearTimeout(late); exchangeSeen = null; fail('page-error', detail) }
      }
      const cancel = (): void => finish(undefined, new AuthenticationFailure('cancelled'))
      const receive = (event: IpcMainEvent, payload: unknown): void => {
        if (settled || window.isDestroyed() || event.sender !== window.webContents ||
            event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== url ||
            !payload || typeof payload !== 'object') return
        const data = payload as Record<string, unknown>
        if (data.requestId !== requestId) return
        if (data.kind === 'error') { pageFailed(); return }
        if (data.kind !== 'token' || data.appId !== this.appId || typeof data.token !== 'string' || data.token.length > 16384) {
          fail('invalid-response', data.kind === 'token' && data.appId !== this.appId ? 'App ID mismatch' : 'unexpected message'); return
        }
        try { finish(proofFromToken(data.token, this.appId)) } catch { fail('invalid-response', 'token claims') }
      }
      const deadline = setTimeout(() => fail('timeout', `${visible ? 'visible' : 'hidden'} ${deadlineMs / 1000}s`), deadlineMs)
      ipcMain.on('morse:app-proof', receive)
      signal.addEventListener('abort', cancel, { once: true })
      window.once('closed', () => fail('window-closed'))
      window.webContents.once('render-process-gone', (_event, details) => fail('renderer-gone', details.reason))
      window.webContents.on('did-fail-load', (_event, code, description, _validatedURL, isMainFrame) => { if (isMainFrame) fail('load-failed', `${description} (${code})`) })
      window.once('ready-to-show', () => { if (!settled && visible) window.show() })
      if (signal.aborted) { cancel(); return }
      void window.loadURL(url).catch(() => fail('load-failed', 'loadURL rejected'))
    })
  }
}
