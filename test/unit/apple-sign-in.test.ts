import assert from 'node:assert/strict'
import { test } from 'node:test'
import { appleAnswer, appleReturnURL } from '../../src/main/auth/apple-answer'
import { AuthenticationFailure, type DesktopAuthConfiguration } from '../../src/main/auth/contracts'
import { FirebaseAuthenticationAPI } from '../../src/main/auth/firebase-rest'

const form = (fields: Record<string, string>): Buffer => Buffer.from(new URLSearchParams(fields).toString())

test('the form Apple posts to the Return URL gives the identity token only for this request', () => {
  assert.deepEqual(appleAnswer(form({ state: 's1', code: 'c', id_token: 'a.b.c', user: '{"name":{}}' }), 's1'), { kind: 'token', idToken: 'a.b.c' })
  assert.deepEqual(appleAnswer(form({ state: 's1', error: 'user_cancelled_authorize' }), 's1'), { kind: 'cancelled' })
  assert.deepEqual(appleAnswer(form({ state: 's1', error: 'invalid_request' }), 's1'), { kind: 'failed', step: 'apple-error', detail: 'invalid_request' })
  assert.deepEqual(appleAnswer(form({ state: 'other', id_token: 'a.b.c' }), 's1'), { kind: 'failed', step: 'invalid-response', detail: 'state' })
  assert.deepEqual(appleAnswer(form({ state: 's1', id_token: 'not-a-jwt' }), 's1'), { kind: 'failed', step: 'invalid-response', detail: 'token' })
  assert.deepEqual(appleAnswer(null, 's1'), { kind: 'failed', step: 'invalid-response', detail: 'no form' })
})

const appId = '1:123713400904:web:test'
function api(): FirebaseAuthenticationAPI {
  const configuration: DesktopAuthConfiguration = { apiKey: 'key', appId, projectId: 'talky-a38c3', projectNumber: '123713400904',
    platform: process.platform === 'win32' ? 'Windows' : 'macOS', proof: { getProof: async () => ({ token: 'proof', appId, expiresAt: Date.now() + 3600000 }) } }
  return new FirebaseAuthenticationAPI(configuration)
}
function idToken(uid: string): string {
  const part = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${part({ alg: 'none' })}.${part({ sub: uid, aud: 'talky-a38c3', iss: 'https://securetoken.google.com/talky-a38c3', auth_time: 1700000000, exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`
}
interface Sent { url: string; headers: Record<string, string>; body: Record<string, unknown> }
function serve(answers: Array<[number, object]>): Sent[] {
  const sent: Sent[] = []
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    sent.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) as Record<string, unknown> })
    const [status, body] = answers.shift()!
    return new Response(JSON.stringify(body), { status })
  }) as typeof fetch
  return sent
}

test('Apple sign-in sends the identity token with the original nonce, as OAuthProvider.appleCredential does', async () => {
  const sent = serve([
    [200, { providerId: 'apple.com', localId: 'appleUid', idToken: idToken('appleUid'), refreshToken: 'refresh', expiresIn: '3600' }],
    [200, { users: [{ localId: 'appleUid' }] }]
  ])
  const tokens = await api().signInWithApple({ idToken: 'apple.id.token', rawNonce: 'raw' }, new AbortController().signal)
  assert.equal(tokens.uid, 'appleUid'); assert.equal(tokens.authTime, 1700000000); assert.equal(tokens.refreshToken, 'refresh')
  assert.match(sent[0]!.url, /accounts:signInWithIdp\?key=key$/)
  assert.equal(sent[0]!.headers['X-Firebase-AppCheck'], 'proof')
  assert.deepEqual(Object.fromEntries(new URLSearchParams(String(sent[0]!.body.postBody))), { id_token: 'apple.id.token', providerId: 'apple.com', nonce: 'raw' })
  assert.equal(sent[0]!.body.requestUri, appleReturnURL); assert.equal(sent[0]!.body.returnSecureToken, true)
  assert.match(sent[1]!.url, /accounts:lookup/)
})

test('a refused Apple token and the server answers of completeTalkyProfile become their own failures', async () => {
  serve([[400, { error: { code: 400, message: 'INVALID_IDP_RESPONSE : nonce', status: 'INVALID_ARGUMENT' } }]])
  await assert.rejects(api().signInWithApple({ idToken: 'a.b.c', rawNonce: 'raw' }, new AbortController().signal),
    (error: unknown) => error instanceof AuthenticationFailure && error.code === 'apple')
  const input = { userId: 'abcdefgh', backupCode: 'CODE-AAAA-BBBB-CCCC', publicKey: 'key', deviceVendorId: '00000000-0000-4000-8000-000000000000' }
  const sent = serve([[400, { error: { message: 'stale_apple_auth_identity', status: 'FAILED_PRECONDITION', details: { morseCode: 'stale_apple_auth_identity' } } }]])
  await assert.rejects(api().completeProfile(input, idToken('appleUid'), new AbortController().signal),
    (error: unknown) => error instanceof AuthenticationFailure && error.code === 'stale-identity')
  assert.match(sent[0]!.url, /asia-northeast3-talky-a38c3\.cloudfunctions\.net\/completeTalkyProfile$/)
  assert.equal(sent[0]!.headers.Authorization, `Bearer ${idToken('appleUid')}`)
  assert.deepEqual(sent[0]!.body, { data: { userId: 'abcdefgh', displayName: 'abcdefgh', backupCode: input.backupCode, publicKey: 'key', deviceVendorId: input.deviceVendorId } })
  serve([[409, { error: { message: 'Talky profile already exists.', status: 'ALREADY_EXISTS' } }]])
  await assert.rejects(api().completeProfile(input, idToken('appleUid'), new AbortController().signal),
    (error: unknown) => error instanceof AuthenticationFailure && error.code === 'id-taken')
  const session = serve([[200, { result: { sessionId: 'session' } }]])
  await api().startSession(idToken('appleUid'), 'session', '1.0.0', 'apple.com', new AbortController().signal)
  assert.equal((session[0]!.body.data as Record<string, unknown>).loginProvider, 'apple.com')
})
