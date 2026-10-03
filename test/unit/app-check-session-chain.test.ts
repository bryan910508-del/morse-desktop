import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { AuthenticationController, type AuthenticatedAccountHooks, type AuthenticationSeams } from '../../src/main/auth/controller'
import type { AppCheckProof, DesktopAuthConfiguration, SavedCredential } from '../../src/main/auth/contracts'
import type { CredentialVault } from '../../src/main/auth/credential-vault'
import { HostedWebAppProof } from '../../src/main/auth/web-app-proof'

// A16 (§33; server 10-03 23:4x: Firebase Authentication has no App Check enforcement and securetoken is not a service
// App Check covers): a saved sign-in alone carries the account on, as in Telegram Desktop — the refresh token renews the
// ID token with no proof, and the ID token gets this app's token from the server (getMorseDesktopAppCheckToken). After a
// long sleep on a VPN exit (B99) the page is not needed; a renewal that fails waits before the next.
const uid = 'u1', sessionId = 'session-0001', authTime = 1700000000, projectId = 'talky-a38c3', appId = '1:123713400904:web:test'
const base64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
const idToken = () => `${base64({ alg: 'none' })}.${base64({ sub: uid, aud: projectId, iss: `https://securetoken.google.com/${projectId}`, morseAuthTime: authTime,
  exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`
const appCheckToken = () => ['h', base64({ sub: appId, iss: 'https://firebaseappcheck.googleapis.com/123713400904', aud: ['projects/123713400904'],
  exp: Math.floor(Date.now() / 1000) + 3600 }), 's'].join('.')

class QuietSocket extends EventEmitter {
  connected = false
  io = { engine: { transport: { name: 'websocket', writable: true }, once: () => {} } }
  connect(): this { return this }
  disconnect(): this { return this }
}

function rig(page: () => Promise<AppCheckProof>) {
  const pages: boolean[] = []
  const proof = new HostedWebAppProof('https://morse-desktop-auth.web.app', appId, 'macOS', null, async (_signal, visible) => { pages.push(visible); return page() })
  const configuration: DesktopAuthConfiguration = { apiKey: 'key', appId, projectId, projectNumber: '123713400904', platform: 'macOS', proof }
  const saved: SavedCredential = { version: 1, profile: { uid, userId: 'minji', displayName: '민지' }, sessionId, refreshToken: 'r1', authTime }
  const vault = { location: mkdtempSync(join(tmpdir(), 'morse-a16-')), ready: async () => {}, read: async () => ({ ...saved }), save: async () => {},
    remove: async () => {}, flush: async () => {} } as unknown as CredentialVault
  const calls: { name: string; appCheck: boolean; authorization: boolean }[] = []
  let renewal: () => Response = () => new Response(JSON.stringify({ id_token: idToken(), refresh_token: 'r2', expires_in: '3600', user_id: uid, project_id: '123713400904', token_type: 'Bearer' }), { status: 200 })
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const headers = (init.headers ?? {}) as Record<string, string>, name = String(url).startsWith('https://securetoken') ? 'securetoken' : String(url).split('/').pop()!
    calls.push({ name, appCheck: 'X-Firebase-AppCheck' in headers, authorization: 'Authorization' in headers })
    if (name === 'securetoken') return renewal()
    if (name === 'startMorseDeviceSession') return new Response(JSON.stringify({ result: { sessionId } }), { status: 200 })
    if (name === 'getMorseDesktopAppCheckToken') return new Response(JSON.stringify({ result: { token: appCheckToken(), expireTimeMillis: Date.now() + 3600000 } }), { status: 200 })
    throw new TypeError('fetch failed')
  }) as typeof fetch
  const hooks: AuthenticatedAccountHooks = { activated: () => {}, connection: () => {}, closed: () => {}, notificationHint: () => {}, reactionUpdated: () => {} }
  const seams: AuthenticationSeams = { openSocket: (() => new QuietSocket()) as unknown as AuthenticationSeams['openSocket'], watchSignIn: () => {} }
  const controller = new AuthenticationController(configuration, vault, '0.241.7', () => {}, hooks, uid, null, seams)
  return { controller, proof, pages, calls, failRenewal: () => { renewal = () => new Response(JSON.stringify({ error: { message: 'unavailable' } }), { status: 503 }) } }
}
const count = (calls: { name: string }[], name: string) => calls.filter(call => call.name === name).length

test('a restore proves the app with its saved sign-in: the token is renewed without a proof, and no page is needed', async () => {
  const { controller, pages, calls } = rig(async () => { throw new Error('page used') })
  await controller.restore()
  assert.equal(controller.connected, true)
  assert.deepEqual(pages, [], 'no reCAPTCHA page, hidden or in view')
  const renew = calls.find(call => call.name === 'securetoken')!
  assert.equal(renew.appCheck, false, 'the renewal carries no App Check header')
  const mint = calls.find(call => call.name === 'getMorseDesktopAppCheckToken')!
  assert.deepEqual([mint.authorization, mint.appCheck], [true, false], 'asked with the ID token, not a proof')
  await controller.close()
})

test('after a long sleep both tokens have run out: the ID token is renewed, then the session gives the app token — still no page', async t => {
  const { controller, proof, pages, calls } = rig(async () => { throw new Error('page used') })
  await controller.restore()
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() })
  t.mock.timers.tick(2 * 3600 * 1000)
  const renewals = count(calls, 'securetoken'), mints = count(calls, 'getMorseDesktopAppCheckToken')
  const next = await proof.getProof(new AbortController().signal)
  assert.ok(next.expiresAt > Date.now() + 30 * 60000)
  assert.equal(count(calls, 'securetoken'), renewals + 1, 'the ID token was renewed first')
  assert.equal(count(calls, 'getMorseDesktopAppCheckToken'), mints + 1)
  assert.deepEqual(pages, [])
  t.mock.timers.reset()
  await controller.close()
})

test('a renewal that fails waits before the next instead of asking again at once', async t => {
  const { controller, proof, pages, calls, failRenewal } = rig(async () => { throw Object.assign(new Error('refused'), { proofStep: 'page-error' }) })
  await controller.restore()
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() })
  t.mock.timers.tick(2 * 3600 * 1000)
  failRenewal()
  await assert.rejects(proof.getProof(new AbortController().signal))
  assert.deepEqual(pages, [false], 'signed in: the hidden page at most, never the window in view')
  const before = calls.length
  await assert.rejects(proof.getProof(new AbortController().signal), (error: unknown) => (error as { proofStep?: string }).proofStep === 'backoff')
  assert.equal(calls.length, before, 'nothing asked while waiting')
  t.mock.timers.reset()
  await controller.close()
})
