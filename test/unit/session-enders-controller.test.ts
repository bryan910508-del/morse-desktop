import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { AuthenticationController, type AuthenticatedAccountHooks, type AuthenticationSeams } from '../../src/main/auth/controller'
import type { DesktopAuthConfiguration, SavedCredential } from '../../src/main/auth/contracts'
import type { CredentialVault } from '../../src/main/auth/credential-vault'
import type { EndingSession } from '../../src/main/auth/session-enders'
import type { watchSignIn } from '../../src/main/auth/sign-in-watch'

// Where this device leaves a session behind (auth/session-enders.ts): a sign-out whose request did not get through,
// the sign-out of a saved account that is not connected, and a saved sign-in of the same account replaced by one with
// another session. Each is written down with its own credential, and only after the credential left the vault.
const uid = 'u1', sessionId = 'session-0001', authTime = 1700000000, projectId = 'talky-a38c3', appId = '1:123713400904:web:test'
const base64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
const idToken = () => `${base64({ alg: 'none' })}.${base64({ sub: uid, aud: projectId, iss: `https://securetoken.google.com/${projectId}`, morseAuthTime: authTime,
  exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`
const configuration: DesktopAuthConfiguration = { apiKey: 'key', appId, projectId, projectNumber: '123713400904', platform: process.platform === 'win32' ? 'Windows' : 'macOS',
  proof: { getProof: async () => ({ token: 'proof', appId, expiresAt: Date.now() + 3600000 }) } }
class FakeSocket extends EventEmitter {
  connected = false
  io = { engine: { transport: { name: 'websocket', writable: true }, once: () => {} } }
  connect(): this { return this }
  disconnect(): this { this.connected = false; return this }
  override emit(event: string, ...args: unknown[]): boolean { return event === 'register' ? true : super.emit(event, ...args) }
}
const saved: SavedCredential = { version: 1, profile: { uid, userId: 'minji', displayName: '민지' }, sessionId, refreshToken: 'r1', authTime }

function rig(signOut: () => Response | never) {
  const events: string[] = [], ended: EndingSession[] = []
  let stored: SavedCredential | null = { ...saved }
  const vault = { location: mkdtempSync(join(tmpdir(), 'morse-enders-')), ready: async () => {}, read: async () => stored && { ...stored }, save: async () => {},
    remove: async () => { events.push('removed'); stored = null }, flush: async () => {} } as unknown as CredentialVault
  globalThis.fetch = (async (url: string) => {
    if (String(url).startsWith('https://securetoken.googleapis.com/')) return new Response(JSON.stringify({ id_token: idToken(), refresh_token: 'r2', expires_in: '3600',
      user_id: uid, project_id: '123713400904', token_type: 'Bearer' }), { status: 200 })
    if (String(url).endsWith('/startMorseDeviceSession')) return new Response(JSON.stringify({ result: { sessionId } }), { status: 200 })
    if (String(url).endsWith('/revokeMorseDeviceSession')) return signOut()
    throw new TypeError('fetch failed')
  }) as typeof fetch
  const hooks: AuthenticatedAccountHooks = { activated: () => {}, connection: () => {}, closed: () => {}, notificationHint: () => {}, reactionUpdated: () => {},
    endSession: async entry => { events.push('written'); ended.push(entry) }, endSessionsNow: () => { events.push('now') } }
  const seams: AuthenticationSeams = {
    openSocket: (() => new FakeSocket()) as unknown as AuthenticationSeams['openSocket'],
    watchSignIn: (() => {}) as unknown as typeof watchSignIn
  }
  return { controller: new AuthenticationController(configuration, vault, '0.241.10', () => {}, hooks, uid, null, seams), events, ended }
}
const offline = (): never => { throw new TypeError('fetch failed') }

test('a sign-out that does not get through leaves its session for its own credential to end, written after the vault let go', async () => {
  const { controller, events, ended } = rig(offline)
  await controller.restore()
  await controller.signOut()
  assert.deepEqual(events, ['removed', 'written', 'now'])
  assert.deepEqual(ended.map(entry => [entry.uid, entry.sessionId, entry.authTime]), [[uid, sessionId, authTime]])
  assert.match(controller.snapshot.message, /확인하지 못했습니다/)
  await controller.close()
})

test('a sign-out the server answers leaves nothing behind', async () => {
  for (const answer of [() => new Response(JSON.stringify({ result: { ok: true } }), { status: 200 }),
    () => new Response(JSON.stringify({ error: { status: 'PERMISSION_DENIED', message: 'Sign in again.', details: { reason: 'session-revoked' } } }), { status: 403 })]) {
    const { controller, ended } = rig(answer)
    await controller.restore()
    await controller.signOut()
    assert.deepEqual(ended, [])
    await controller.close()
  }
})

test('signing out a saved account that is not connected ends its session too (tdesktop waits for auth.logOut)', async () => {
  const { controller, events, ended } = rig(offline)
  await controller.signOut()
  assert.deepEqual(events, ['removed', 'written', 'now'])
  assert.equal(ended[0]?.sessionId, sessionId)
  await controller.close()
})

test('a saved sign-in of the same account replaced by another session is left behind; the same session or another account is not', async () => {
  const { controller, ended } = rig(offline)
  const leaveBehind = (previous: SavedCredential | null, next: SavedCredential): Promise<boolean> =>
    (controller as unknown as { leaveBehind(p: SavedCredential | null, n: SavedCredential): Promise<boolean> }).leaveBehind(previous, next)
  const qr = { ...saved, sessionId: '0123456789abcdef0123456789abcdef', refreshToken: 'r-qr', provider: 'qr' as const }
  assert.equal(await leaveBehind(saved, qr), true)
  assert.equal(await leaveBehind(saved, { ...saved, refreshToken: 'r-new' }), false, 'the same session signed in again')
  assert.equal(await leaveBehind({ ...saved, profile: { ...saved.profile, uid: 'u2' } }, qr), false, 'another account')
  assert.equal(await leaveBehind(null, qr), false)
  assert.deepEqual(ended.map(entry => [entry.sessionId, entry.refreshToken]), [[sessionId, 'r1']])
  await controller.close()
})
