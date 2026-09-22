import { app, BrowserWindow, ipcMain, session, shell, type IpcMainEvent } from 'electron'
import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { AuthenticationFailure, type AppCheckProof, type DesktopAppProofProvider } from './contracts'
import type { ProofTokenStore } from './proof-token-store'
import { tr } from '../../shared/i18n'

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
type ProofFailureStep = 'page-error' | 'timeout' | 'load-failed' | 'renderer-gone' | 'invalid-response' | 'window-closed'
interface ProofResponse { host: string; path: string; method: string; status: number; error: string }
interface ProofFailureEntry { step: ProofFailureStep; detail: string; blockedHosts: string[]; responses: ProofResponse[]; elapsedMs: number; platform: 'macOS' | 'Windows' }

const maxLogBytes = 256 * 1024
// The exchange normally ends in a few seconds; the hidden try gives up first, and the window in view has the rest of
// the 35 seconds FirebaseRest allows a proof.
const hiddenDeadline = 12000, visibleDeadline = 20000
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

// Web-origin attestation, not hardware or native binary attestation. The
// application server remains the authority for the token signature and App ID.
export class HostedWebAppProof implements DesktopAppProofProvider {
  private cached: AppCheckProof | null = null
  private stored: Promise<void> | null = null
  private flight: Flight | null = null
  constructor(private readonly origin: string, private readonly appId: string,
    private readonly platform: 'macOS' | 'Windows', private readonly store: ProofTokenStore | null = null) {}

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
    if (this.cached && this.cached.expiresAt > Date.now() + 120000) return this.cached
    let flight = this.flight
    if (!flight || flight.controller.signal.aborted) {
      const controller = new AbortController()
      flight = { controller, consumers: 0, promise: Promise.resolve().then(() => this.acquire(controller.signal)) }
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

  // reCAPTCHA Enterprise here is the score-based kind: nothing is asked of the person, so the page does its work
  // without being seen, as iOS's App Attest does its own. Only when that attempt is refused or runs out of time does
  // the window open — the same check, in view — so a sign-in is never worse off than before. The whole exchange stays
  // inside the 35 seconds the caller allows.
  private async acquire(signal: AbortSignal): Promise<AppCheckProof> {
    try { return await this.attempt(signal, false, hiddenDeadline) }
    catch (error) {
      const step = (error as { proofStep?: ProofFailureStep }).proofStep
      if (signal.aborted || !step || !['page-error', 'timeout', 'invalid-response'].includes(step)) throw error
      return this.attempt(signal, true, visibleDeadline)
    }
  }

  private attempt(signal: AbortSignal, visible: boolean, deadlineMs: number): Promise<AppCheckProof> {
    if (signal.aborted) return Promise.reject(new AuthenticationFailure('cancelled'))
    const requestId = randomUUID(), started = Date.now(), blocked = new Set<string>(), responses: ProofResponse[] = []
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
        finish(undefined, Object.assign(new AuthenticationFailure(step === 'window-closed' ? 'cancelled' : 'app-proof'), { proofStep: step }))
      }
      const cancel = (): void => finish(undefined, new AuthenticationFailure('cancelled'))
      const receive = (event: IpcMainEvent, payload: unknown): void => {
        if (settled || window.isDestroyed() || event.sender !== window.webContents ||
            event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== url ||
            !payload || typeof payload !== 'object') return
        const data = payload as Record<string, unknown>
        if (data.requestId !== requestId) return
        if (data.kind === 'error') { fail('page-error', tr('reCAPTCHA Enterprise 또는 App Check 토큰 발급 실패')); return }
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
