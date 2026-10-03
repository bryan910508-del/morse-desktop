import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { AuthenticationFailure, type DesktopAuthConfiguration } from '../../src/main/auth/contracts'
import { FirebaseAuthenticationAPI, failureFromBody } from '../../src/main/auth/firebase-rest'
import { decodeQrIssue, decodeQrRedeem, newQrAttempt, qrSwitchOn } from '../../src/main/auth/qr-login'
import { qrLoginLink } from '../../src/shared/auth'

// A13 §2.1 · 08 §3 (Telegram auth.exportLoginToken / importLoginToken, tdesktop intro/intro_qr.cpp): this computer
// shows a code a phone of the account approves; the secret stays here and only its hash goes out until the redeem.
const token = 'A'.repeat(43)

test('an attempt keeps a 32-byte secret and sends only its SHA-256', () => {
  const attempt = newQrAttempt()
  assert.match(attempt.secret, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(attempt.binding, createHash('sha256').update(Buffer.from(attempt.secret, 'base64url')).digest('base64url'))
  assert.notEqual(newQrAttempt().secret, attempt.secret)
})

test('the issue and redeem answers are read strictly', () => {
  assert.deepEqual(decodeQrIssue({ state: 'pending', token, refreshAfterMs: 30000 }), { state: 'pending', token, refreshAfterMs: 30000 })
  assert.deepEqual(decodeQrIssue({ state: 'approved', pollAfterMs: 50 }), { state: 'waiting', pollAfterMs: 1000 }, 'polling no faster than once a second')
  assert.throws(() => decodeQrIssue({ state: 'pending', token: 'short' }), AuthenticationFailure)
  assert.deepEqual(decodeQrRedeem({ state: 'pending', pollAfterMs: 2000 }), { state: 'waiting', pollAfterMs: 2000 })
  assert.deepEqual(decodeQrRedeem({ state: 'approved', customToken: 'ct', uid: 'u1', userId: 'minji', displayName: '민지', sessionId: 'session-0001' }),
    { state: 'approved', profile: { uid: 'u1', userId: 'minji', displayName: '민지' }, customToken: 'ct', sessionId: 'session-0001' })
  assert.throws(() => decodeQrRedeem({ state: 'approved', customToken: 'ct', uid: 'u1', userId: 'minji', sessionId: 'x' }), AuthenticationFailure, 'a server session id is required')
  assert.deepEqual(decodeQrRedeem({ state: 'password-needed', hint: '고양이', passwordCheck: {} }), { state: 'password-needed', hint: '고양이' })
})

test('the server switch is on only when it says so', () => {
  assert.equal(qrSwitchOn({ fields: { enabled: { booleanValue: true } } }), true)
  assert.equal(qrSwitchOn({ fields: { enabled: { booleanValue: false } } }), false)
  assert.equal(qrSwitchOn({ fields: {} }), false)
  assert.equal(qrSwitchOn(null), false)
})

test('a switched-off or finished attempt has its own failure; other kinds read as before', () => {
  const body = (reason: string, status = 'FAILED_PRECONDITION') => ({ error: { status, message: 'refused', details: { reason } } })
  assert.equal(failureFromBody(body('qr-login-disabled'), 400, 'qr').code, 'qr-disabled')
  for (const reason of ['expired', 'approval-cancelled', 'approver-signed-out', 'attempt-missing', 'account-unavailable'])
    assert.equal(failureFromBody(body(reason), 400, 'qr').code, 'qr-expired', reason)
  assert.equal(failureFromBody(body('poll-too-fast', 'RESOURCE_EXHAUSTED'), 429, 'qr').code, 'rate-limited')
  assert.equal(failureFromBody(body('qr-login-disabled'), 400, 'plain').code, 'protocol', 'only the QR callables read these reasons')
})

const appId = '1:123713400904:web:test'
function api(): FirebaseAuthenticationAPI {
  const configuration: DesktopAuthConfiguration = { apiKey: 'key', appId, projectId: 'talky-a38c3', projectNumber: '123713400904',
    platform: process.platform === 'win32' ? 'Windows' : 'macOS', proof: { getProof: async () => ({ token: 'proof', appId, expiresAt: Date.now() + 3600000 }) } }
  return new FirebaseAuthenticationAPI(configuration)
}
interface Sent { url: string; method: string; headers: Record<string, string>; body: Record<string, unknown> | null }
function serve(answers: Array<[number, object]>): Sent[] {
  const sent: Sent[] = []
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    sent.push({ url, method: String(init.method), headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null })
    const [status, body] = answers.shift()!
    return new Response(JSON.stringify(body), { status })
  }) as typeof fetch
  return sent
}

test('the QR callables carry this app\'s proof and never an account\'s Authorization; the secret goes only to redeem', async () => {
  const sent = serve([[200, { result: { state: 'pending', token, refreshAfterMs: 30000 } }], [200, { result: { state: 'pending', pollAfterMs: 2000 } }]])
  const attempt = newQrAttempt()
  assert.equal((await api().issueLoginCode(attempt.binding, ['u1', 'u2'], '0.241.6', new AbortController().signal)).state, 'pending')
  assert.match(sent[0]!.url, /asia-northeast3-talky-a38c3\.cloudfunctions\.net\/exportMorseLoginToken$/)
  assert.equal(sent[0]!.headers['X-Firebase-AppCheck'], 'proof')
  assert.equal(sent[0]!.headers.Authorization, undefined)
  const data = sent[0]!.body!.data as Record<string, unknown>
  assert.equal(data.binding, attempt.binding)
  assert.deepEqual(data.exceptUids, ['u1', 'u2'])
  assert.ok(!JSON.stringify(sent[0]!.body).includes(attempt.secret), 'the issue never carries the secret')
  assert.equal((await api().redeemLoginCode(attempt.secret, new AbortController().signal)).state, 'waiting')
  assert.match(sent[1]!.url, /\/redeemMorseLoginToken$/)
  assert.deepEqual(sent[1]!.body, { data: { secret: attempt.secret } })
  assert.equal(sent[1]!.headers.Authorization, undefined)
})

test('the switch is read before any sign-in, with the app\'s proof only; anything but «on» is off', async () => {
  let sent = serve([[200, { fields: { enabled: { booleanValue: true } } }]])
  assert.equal(await api().qrLoginEnabled(new AbortController().signal), true)
  assert.equal(sent[0]!.method, 'GET')
  assert.match(sent[0]!.url, /firestore\.googleapis\.com\/v1\/projects\/talky-a38c3\/databases\/\(default\)\/documents\/app_config\/qr_login\?key=key$/)
  assert.equal(sent[0]!.headers['X-Firebase-AppCheck'], 'proof')
  assert.equal(sent[0]!.headers.Authorization, undefined)
  sent = serve([[404, { error: { status: 'NOT_FOUND' } }]])
  assert.equal(await api().qrLoginEnabled(new AbortController().signal), false)
  globalThis.fetch = (async () => { throw new Error('offline') }) as typeof fetch
  assert.equal(await api().qrLoginEnabled(new AbortController().signal), false)
})

test('the code carries only morse://login with the 43-character token (08 §3.2)', () => {
  assert.equal(qrLoginLink(token), `morse://login?token=${token}`)
  assert.throws(() => qrLoginLink('short'))
  assert.throws(() => qrLoginLink(`${token}&x=1`))
})
