import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

// 3-1c (user decision 2: Apple · Google · recovery code on every platform; contract survey
// reports/desktop/2026-10-04-google-signin-survey.md): Sign in with Google for a desktop app, as RFC 8252 and Google's
// «installed app» flow have it — the person's own browser, an answer to a loopback address on this computer, PKCE.
// Google refuses its sign-in inside an app's web view (disallowed_useragent), and Telegram Desktop has no Google
// sign-in to follow, so this is Morse's own.
//
// The OAuth client is the «Desktop app» kind in the Firebase project (talky-a38c3). Its secret is not a secret for an
// installed app (Google's guidance; the source is public): PKCE, the state and the one-time loopback protect the
// answer. Kept here as source constants, as the Apple Services ID is (apple-answer.ts): the «Morse Desktop» client
// (Desktop app type) made 2026-10-04 in talky-a38c3. Empty, Google sign-in is not offered.
// The official Morse Desktop puts its «Morse Desktop» Google client in when it is built (as tdesktop does with its
// api_id, config.h). To build your own, put in your own Google «Desktop app» OAuth client. Empty, Google sign-in is
// not offered.
export const googleDesktopClientId = ''
export const googleDesktopClientSecret = ''
export const googleConfigured = (): boolean => Boolean(googleDesktopClientId && googleDesktopClientSecret)

export const googleAuthorizeEndpoint = 'https://accounts.google.com/o/oauth2/v2/auth'
export const googleTokenEndpoint = 'https://oauth2.googleapis.com/token'
const issuers = ['https://accounts.google.com', 'accounts.google.com']

export interface GoogleIdentity { idToken: string }
export interface GoogleAttempt { verifier: string; challenge: string; state: string; nonce: string }

// A PKCE verifier (RFC 7636: 43-128 characters; 32 random bytes base64url = 43) and its S256 challenge, the state that
// ties the answer to this attempt, and the nonce the identity token must carry back.
export function newGoogleAttempt(): GoogleAttempt {
  const verifier = randomBytes(32).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url'), state: randomUUID(), nonce: randomBytes(16).toString('base64url') }
}

export function googleAuthorizeURL(clientId: string, redirectUri: string, attempt: GoogleAttempt): string {
  return `${googleAuthorizeEndpoint}?${new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'openid email profile',
    code_challenge: attempt.challenge, code_challenge_method: 'S256', state: attempt.state, nonce: attempt.nonce,
    prompt: 'select_account'
  })}`
}

// What came back to the loopback address: the code for this attempt, the person's «Cancel», Google's error — or a
// request that is not the answer at all (a browser asking for /favicon.ico), which is left unanswered.
export type GoogleAnswer =
  | { kind: 'code'; code: string }
  | { kind: 'cancelled' }
  | { kind: 'failed'; detail: string }
  | { kind: 'other' }
export function googleAnswer(path: string, state: string): GoogleAnswer {
  let url: URL
  try { url = new URL(path, 'http://127.0.0.1') } catch { return { kind: 'other' } }
  if (url.pathname !== '/') return { kind: 'other' }
  const query = url.searchParams
  if (query.get('state') !== state) return { kind: 'failed', detail: 'state' }
  const error = query.get('error')
  if (error) return error === 'access_denied' ? { kind: 'cancelled' } : { kind: 'failed', detail: error.slice(0, 40) }
  const code = query.get('code')
  if (!code || code.length > 2048) return { kind: 'failed', detail: 'code' }
  return { kind: 'code', code }
}

// The token endpoint's answer: the identity token, checked here before Firebase sees it — issued by Google, to this
// client, for this attempt (nonce), not expired. Its signature is Firebase's to check (signInWithIdp).
export function googleIdToken(body: unknown, clientId: string, nonce: string, now = Date.now()): string | null {
  const token = body && typeof body === 'object' ? (body as Record<string, unknown>).id_token : undefined
  if (typeof token !== 'string' || token.length > 16384) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  let claims: Record<string, unknown>
  try { claims = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as Record<string, unknown> } catch { return null }
  if (!issuers.includes(String(claims.iss)) || claims.aud !== clientId || claims.nonce !== nonce) return null
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= now || typeof claims.sub !== 'string' || !claims.sub) return null
  return token
}

// The page the browser shows once the answer is in: a sentence, nothing loaded from anywhere.
function answerPage(title: string, text: string): string {
  const escape = (value: string): string => value.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
  return `<!doctype html><meta charset="utf-8"><title>${escape(title)}</title><body style="font:16px -apple-system,system-ui,sans-serif;display:grid;place-items:center;height:90vh;margin:0"><p>${escape(text)}</p>`
}

// The loopback receiver (RFC 8252 §7.3, §8.3): 127.0.0.1 — an IP, not «localhost» — on a port the system picks, opened
// before the address is handed to the browser, so nothing else can take it first. It takes one answer for this
// attempt and closes; a request with another state is refused and the attempt fails (someone else's flow).
export class GoogleLoopback {
  private server: Server | null = null
  private settled = false
  readonly answer: Promise<GoogleAnswer>
  private resolve!: (answer: GoogleAnswer) => void
  constructor(private readonly state: string, private readonly words: { title: string; done: string; failed: string }) {
    this.answer = new Promise(resolve => { this.resolve = resolve })
  }
  async open(): Promise<string> {
    const server = createServer((request, response) => {
      const answer = this.settled ? { kind: 'other' as const } : googleAnswer(request.url ?? '', this.state)
      if (request.method !== 'GET' || answer.kind === 'other') { response.writeHead(this.settled ? 410 : 404).end(); return }
      this.settled = true
      // Closed once the page has gone out, so the browser is not left with a broken connection.
      response.once('finish', () => this.close())
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Connection': 'close' })
        .end(answerPage(this.words.title, answer.kind === 'code' ? this.words.done : this.words.failed))
      this.resolve(answer)
    })
    this.server = server
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve()) })
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  }
  close(): void {
    const server = this.server
    this.server = null
    if (server) { server.close(); server.closeAllConnections() }
  }
}
