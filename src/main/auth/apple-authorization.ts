import { app, BrowserWindow, session, shell } from 'electron'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { appendFile, mkdir, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { AuthenticationFailure } from './contracts'
import { appleAnswer, appleReturnURL, appleServicesId, type AppleIdentity } from './apple-answer'
import { tr } from '../../shared/i18n'

type AppleFailureStep = 'load-failed' | 'renderer-gone' | 'timeout' | 'apple-error' | 'invalid-response'

const maxLogBytes = 256 * 1024
const guardedSessions = new WeakSet<Electron.Session>()
// Apple's sign-in page, its two-factor steps and the images they show.
function appleHost(hostname: string): boolean {
  return ['apple.com', 'cdn-apple.com', 'mzstatic.com'].some(domain => hostname === domain || hostname.endsWith(`.${domain}`))
}

// Local diagnostics for a sign-in that did not finish: the step, Apple's error code and blocked
// host names. Tokens, the Apple ID, form data and account data are never written.
async function recordAppleFailure(step: AppleFailureStep, detail: string, blockedHosts: string[], elapsedMs: number): Promise<void> {
  try {
    const directory = app.getPath('logs'), file = join(directory, 'apple-sign-in.log')
    await mkdir(directory, { recursive: true })
    const size = await stat(file).then(value => value.size, () => 0)
    if (size > maxLogBytes) await rename(file, `${file}.1`).catch(() => {})
    const line = JSON.stringify({ at: new Date().toISOString(), version: app.getVersion(), step, detail: detail.slice(0, 80), blockedHosts, elapsedMs })
    await appendFile(file, `${line}\n`, { encoding: 'utf8', mode: 0o600 })
  } catch { /* Diagnostics are best effort. */ }
}

function formBody(data: Electron.UploadData[] | undefined): Buffer | null {
  return !data?.length || data.some(part => !part.bytes) ? null : Buffer.concat(data.map(part => part.bytes))
}

// iOS MorseAppleSignInService.startAppleRequest: full name and email scopes, and the SHA-256 of a
// random nonce, whose original value Firebase checks against the identity token.
export function authorizeWithApple(signal: AbortSignal): Promise<AppleIdentity> {
  if (signal.aborted) return Promise.reject(new AuthenticationFailure('cancelled'))
  const rawNonce = randomBytes(32).toString('base64url'), state = randomUUID(), started = Date.now(), blocked = new Set<string>()
  const url = `https://appleid.apple.com/auth/authorize?${new URLSearchParams({
    client_id: appleServicesId, redirect_uri: appleReturnURL, response_type: 'code id_token', response_mode: 'form_post',
    scope: 'name email', state, nonce: createHash('sha256').update(rawNonce).digest('hex')
  })}`
  // An in-memory partition, cleared after each sign-in: nothing Apple stores outlives it.
  const isolated = session.fromPartition('morse-apple-sign-in', { cache: false })
  isolated.setPermissionRequestHandler((_contents, _permission, answer) => answer(false))
  isolated.setPermissionCheckHandler(() => false)
  isolated.setDevicePermissionHandler(() => false)
  if (!guardedSessions.has(isolated)) { guardedSessions.add(isolated); isolated.on('will-download', event => event.preventDefault()) }
  const window = new BrowserWindow({
    width: 520, height: 720, show: false, title: tr('Apple로 로그인'), autoHideMenuBar: true, backgroundColor: '#ffffff',
    webPreferences: {
      session: isolated, sandbox: true, contextIsolation: true, nodeIntegration: false,
      webSecurity: true, allowRunningInsecureContent: false, webviewTag: false,
      devTools: false, navigateOnDragDrop: false, safeDialogs: true
    }
  })
  window.setMenu(null)
  // Apple's own links (privacy, account help) open in the browser.
  window.webContents.setWindowOpenHandler(({ url: link }) => {
    try { const target = new URL(link); if (target.protocol === 'https:' && appleHost(target.hostname)) void shell.openExternal(target.href).catch(() => {}) } catch { /* ignored */ }
    return { action: 'deny' }
  })
  window.webContents.on('will-attach-webview', event => event.preventDefault())

  return new Promise<AppleIdentity>((resolve, reject) => {
    let settled = false
    const finish = (identity?: AppleIdentity, error = new AuthenticationFailure('apple')): void => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      signal.removeEventListener('abort', cancel)
      if (!window.isDestroyed()) window.destroy()
      void isolated.clearStorageData().catch(() => {})
      void isolated.closeAllConnections().catch(() => {})
      if (identity && !signal.aborted) resolve(identity)
      else reject(signal.aborted ? new AuthenticationFailure('cancelled') : error)
    }
    const fail = (step: AppleFailureStep, detail = '', offline = false): void => {
      if (settled) return
      void recordAppleFailure(step, detail, [...blocked], Date.now() - started)
      finish(undefined, new AuthenticationFailure(offline ? 'network' : 'apple'))
    }
    const cancel = (): void => finish(undefined, new AuthenticationFailure('cancelled'))
    isolated.webRequest.onBeforeRequest((details, respond) => {
      let target: URL | null = null
      try { target = new URL(details.url) } catch { /* malformed URLs are denied */ }
      if (target && `${target.origin}${target.pathname}` === appleReturnURL) {
        // Apple's answer never reaches the Firebase page.
        respond({ cancel: true })
        const answer = appleAnswer(details.method === 'POST' ? formBody(details.uploadData) : null, state)
        if (answer.kind === 'token') finish({ idToken: answer.idToken, rawNonce })
        else if (answer.kind === 'cancelled') cancel()
        else fail(answer.step, answer.detail)
        return
      }
      const allowed = target?.protocol === 'https:' && appleHost(target.hostname)
      if (!allowed && blocked.size < 20) blocked.add(target?.hostname || 'invalid-url')
      respond({ cancel: !allowed })
    })
    // Two-factor and account steps can take a while; an abandoned window closes after ten minutes.
    const deadline = setTimeout(() => fail('timeout'), 600000)
    signal.addEventListener('abort', cancel, { once: true })
    window.once('closed', cancel)
    window.webContents.once('render-process-gone', (_event, details) => fail('renderer-gone', details.reason))
    window.webContents.on('did-fail-load', (_event, code, description, validatedURL, isMainFrame) => {
      // The cancelled request to the Return URL is how the answer is read, not a failure.
      if (!isMainFrame || code === -3 || validatedURL.startsWith(appleReturnURL)) return
      // Chromium's connection errors (-100…-199, timeouts, a changed network) mean the Mac is offline.
      fail('load-failed', `${description} (${code})`, code === -7 || code === -21 || (code <= -100 && code > -200))
    })
    window.once('ready-to-show', () => { if (!settled) window.show() })
    void window.loadURL(url).catch(() => { /* reported by did-fail-load */ })
  })
}
