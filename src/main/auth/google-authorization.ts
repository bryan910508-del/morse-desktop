import { app, shell } from 'electron'
import { appendFile, mkdir, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { AuthenticationFailure } from './contracts'
import { GoogleLoopback, googleAuthorizeURL, googleConfigured, googleDesktopClientId, googleDesktopClientSecret, googleIdToken, googleTokenEndpoint,
  newGoogleAttempt, type GoogleIdentity } from './google-answer'
import { tr } from '../../shared/i18n'

type GoogleFailureStep = 'not-configured' | 'loopback' | 'browser' | 'timeout' | 'google-error' | 'exchange' | 'invalid-response'
const maxLogBytes = 256 * 1024
// The person signs in in their own browser; one that is left there ends after five minutes.
const answerDeadline = 5 * 60000

// Local diagnostics for a Google sign-in that did not finish: the step and Google's error code. The code, the tokens
// and the Google account are never written.
async function recordGoogleFailure(step: GoogleFailureStep, detail: string, elapsedMs: number): Promise<void> {
  try {
    const directory = app.getPath('logs'), file = join(directory, 'google-sign-in.log')
    await mkdir(directory, { recursive: true })
    const size = await stat(file).then(value => value.size, () => 0)
    if (size > maxLogBytes) await rename(file, `${file}.1`).catch(() => {})
    const line = JSON.stringify({ at: new Date().toISOString(), version: app.getVersion(), step, detail: detail.slice(0, 80), elapsedMs })
    await appendFile(file, `${line}\n`, { encoding: 'utf8', mode: 0o600 })
  } catch { /* Diagnostics are best effort. */ }
}

// Sign in with Google in the person's browser (google-answer.ts): the loopback address first, then the browser, the
// one answer, and the code exchanged here in main for the identity token — nothing of it reaches the window.
export async function authorizeWithGoogle(signal: AbortSignal): Promise<GoogleIdentity> {
  const started = Date.now()
  const fail = async (step: GoogleFailureStep, detail = '', code: 'google' | 'network' | 'cancelled' = 'google'): Promise<never> => {
    if (code !== 'cancelled') void recordGoogleFailure(step, detail, Date.now() - started)
    throw new AuthenticationFailure(code)
  }
  if (signal.aborted) throw new AuthenticationFailure('cancelled')
  if (!googleConfigured()) return fail('not-configured')
  const attempt = newGoogleAttempt()
  const loopback = new GoogleLoopback(attempt.state, {
    title: 'Morse', done: tr('로그인을 받았어요. 이 창을 닫고 Morse 로 돌아가세요.'), failed: tr('로그인을 마치지 못했어요. Morse 로 돌아가 다시 시도해 주세요.')
  })
  try {
    let redirectUri: string
    try { redirectUri = await loopback.open() } catch (error) { return await fail('loopback', (error as NodeJS.ErrnoException).code ?? '') }
    try { await shell.openExternal(googleAuthorizeURL(googleDesktopClientId, redirectUri, attempt)) }
    catch { return await fail('browser') }
    let timer: ReturnType<typeof setTimeout> | undefined
    const ended = new Promise<'timeout' | 'cancelled'>(resolve => {
      timer = setTimeout(() => resolve('timeout'), answerDeadline)
      signal.addEventListener('abort', () => resolve('cancelled'), { once: true })
    })
    const answer = await Promise.race([loopback.answer, ended]).finally(() => clearTimeout(timer))
    if (answer === 'timeout') return await fail('timeout')
    if (answer === 'cancelled' || signal.aborted) return await fail('browser', '', 'cancelled')
    if (answer.kind === 'cancelled') return await fail('google-error', 'access_denied', 'cancelled')
    if (answer.kind !== 'code') return await fail('google-error', answer.kind === 'failed' ? answer.detail : '')
    // The code is worth nothing without this attempt's verifier (PKCE); exchanged once, here.
    let response: Response
    try {
      response = await fetch(googleTokenEndpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, redirect: 'error', credentials: 'omit', cache: 'no-store',
        signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
        body: new URLSearchParams({ code: answer.code, code_verifier: attempt.verifier, client_id: googleDesktopClientId,
          client_secret: googleDesktopClientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }).toString()
      })
    } catch { return await fail('exchange', 'network', signal.aborted ? 'cancelled' : 'network') }
    const body = await response.json().catch(() => null) as Record<string, unknown> | null
    if (!response.ok) return await fail('exchange', `${response.status} ${typeof body?.error === 'string' ? body.error : ''}`)
    const idToken = googleIdToken(body, googleDesktopClientId, attempt.nonce)
    if (!idToken) return await fail('invalid-response', 'id_token')
    return { idToken }
  } finally { loopback.close() }
}
