import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { GoogleLoopback, googleAnswer, googleAuthorizeURL, googleIdToken, newGoogleAttempt } from '../../src/main/auth/google-answer'
import { AuthenticationFailure, type DesktopAuthConfiguration } from '../../src/main/auth/contracts'
import { FirebaseAuthenticationAPI } from '../../src/main/auth/firebase-rest'

// 3-1c: Sign in with Google for a desktop app (RFC 8252, Google «installed app»): the person's browser, one answer to
// a loopback address on this computer, PKCE — then Firebase signInWithIdp, as Apple's path goes.

test('an attempt has a PKCE verifier, its S256 challenge, a state and a nonce of its own', () => {
  const attempt = newGoogleAttempt()
  assert.match(attempt.verifier, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(attempt.challenge, createHash('sha256').update(attempt.verifier).digest('base64url'))
  assert.notEqual(newGoogleAttempt().verifier, attempt.verifier)
  assert.notEqual(newGoogleAttempt().state, attempt.state)
  const url = new URL(googleAuthorizeURL('client.apps.googleusercontent.com', 'http://127.0.0.1:5555', attempt))
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth')
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    client_id: 'client.apps.googleusercontent.com', redirect_uri: 'http://127.0.0.1:5555', response_type: 'code', scope: 'openid email profile',
    code_challenge: attempt.challenge, code_challenge_method: 'S256', state: attempt.state, nonce: attempt.nonce, prompt: 'select_account'
  }, 'the verifier itself never goes to the browser')
})

test('the loopback answer is this attempt\'s code, the person\'s cancel, or a failure; other paths are not the answer', () => {
  assert.deepEqual(googleAnswer('/?state=s1&code=4%2F0abc&scope=openid', 's1'), { kind: 'code', code: '4/0abc' })
  assert.deepEqual(googleAnswer('/?state=s1&error=access_denied', 's1'), { kind: 'cancelled' })
  assert.deepEqual(googleAnswer('/?state=s1&error=invalid_request', 's1'), { kind: 'failed', detail: 'invalid_request' })
  assert.deepEqual(googleAnswer('/?state=other&code=x', 's1'), { kind: 'failed', detail: 'state' }, 'someone else\'s flow (CSRF)')
  assert.deepEqual(googleAnswer('/?state=s1', 's1'), { kind: 'failed', detail: 'code' })
  assert.deepEqual(googleAnswer('/favicon.ico', 's1'), { kind: 'other' })
})

test('the loopback takes one answer on 127.0.0.1 and closes; a stray request is not the answer', async () => {
  const loopback = new GoogleLoopback('s1', { title: 'Morse', done: 'done', failed: 'failed' })
  const base = await loopback.open()
  assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/)
  assert.equal((await fetch(`${base}/favicon.ico`)).status, 404)
  const page = await fetch(`${base}/?state=s1&code=c1`)
  assert.equal(page.status, 200)
  assert.match(await page.text(), /done/)
  assert.deepEqual(await loopback.answer, { kind: 'code', code: 'c1' })
  await new Promise(resolve => setTimeout(resolve, 50))
  await assert.rejects(fetch(`${base}/?state=s1&code=c2`), 'closed after the one answer')
})

const jwt = (claims: object): string => ['h', Buffer.from(JSON.stringify(claims)).toString('base64url'), 's'].join('.')
test('the identity token is checked before Firebase sees it: issuer, audience, nonce, expiry', () => {
  const good = { iss: 'https://accounts.google.com', aud: 'client', nonce: 'n1', sub: '1234', exp: Math.floor(Date.now() / 1000) + 600 }
  assert.equal(googleIdToken({ id_token: jwt(good) }, 'client', 'n1'), jwt(good))
  assert.equal(googleIdToken({ id_token: jwt({ ...good, iss: 'accounts.google.com' }) }, 'client', 'n1') !== null, true)
  assert.equal(googleIdToken({ id_token: jwt({ ...good, aud: 'another' }) }, 'client', 'n1'), null, 'another client\'s token')
  assert.equal(googleIdToken({ id_token: jwt({ ...good, nonce: 'n2' }) }, 'client', 'n1'), null, 'another attempt\'s token')
  assert.equal(googleIdToken({ id_token: jwt({ ...good, iss: 'https://evil.example' }) }, 'client', 'n1'), null)
  assert.equal(googleIdToken({ id_token: jwt({ ...good, exp: 1 }) }, 'client', 'n1'), null)
  assert.equal(googleIdToken({ access_token: 'x' }, 'client', 'n1'), null)
})

const appId = '1:123713400904:web:test'
function api(): FirebaseAuthenticationAPI {
  const configuration: DesktopAuthConfiguration = { apiKey: 'key', appId, projectId: 'talky-a38c3', projectNumber: '123713400904',
    platform: process.platform === 'win32' ? 'Windows' : 'macOS', proof: { getProof: async () => ({ token: 'proof', appId, expiresAt: Date.now() + 3600000 }) } }
  return new FirebaseAuthenticationAPI(configuration)
}
const firebaseToken = (uid: string): string => jwt({ sub: uid, aud: 'talky-a38c3', iss: 'https://securetoken.google.com/talky-a38c3', auth_time: 1700000000, exp: Math.floor(Date.now() / 1000) + 3600 })
function serve(answers: Array<[number, object]>): Record<string, unknown>[] {
  const sent: Record<string, unknown>[] = []
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)) as Record<string, unknown>)
    const [status, body] = answers.shift()!
    return new Response(JSON.stringify(body), { status })
  }) as typeof fetch
  return sent
}

test('Google signs in to Firebase with its identity token (no nonce), as Android\'s GoogleAuthProvider.getCredential', async () => {
  const sent = serve([
    [200, { providerId: 'google.com', localId: 'googleUid', idToken: firebaseToken('googleUid'), refreshToken: 'refresh', expiresIn: '3600' }],
    [200, { users: [{ localId: 'googleUid' }] }]
  ])
  const tokens = await api().signInWithIdp({ provider: 'google.com', idToken: 'google.id.token' }, new AbortController().signal)
  assert.equal(tokens.uid, 'googleUid')
  assert.deepEqual(Object.fromEntries(new URLSearchParams(String(sent[0]!.postBody))), { id_token: 'google.id.token', providerId: 'google.com' })
  assert.equal(sent[0]!.requestUri, 'http://127.0.0.1')
})

test('an email already used by an account made another way is refused, never linked; a refused token is Google\'s failure', async () => {
  serve([[200, { needConfirmation: true, providerId: 'google.com', email: 'a@example.com' }]])
  await assert.rejects(api().signInWithIdp({ provider: 'google.com', idToken: 'g' }, new AbortController().signal),
    (error: unknown) => error instanceof AuthenticationFailure && error.code === 'account-exists')
  serve([[400, { error: { code: 400, message: 'INVALID_IDP_RESPONSE', status: 'INVALID_ARGUMENT' } }]])
  await assert.rejects(api().signInWithIdp({ provider: 'google.com', idToken: 'g' }, new AbortController().signal),
    (error: unknown) => error instanceof AuthenticationFailure && error.code === 'google')
  serve([[200, { providerId: 'apple.com', localId: 'u', idToken: firebaseToken('u'), refreshToken: 'r', expiresIn: '3600' }]])
  await assert.rejects(api().signInWithIdp({ provider: 'google.com', idToken: 'g' }, new AbortController().signal),
    (error: unknown) => error instanceof AuthenticationFailure && error.code === 'google', 'another provider\'s answer')
})
