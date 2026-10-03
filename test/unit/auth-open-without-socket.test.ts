import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { AuthenticationController, type AuthenticatedAccountHooks, type AuthenticationSeams } from '../../src/main/auth/controller'
import type { DesktopAuthConfiguration, SavedCredential } from '../../src/main/auth/contracts'
import type { CredentialVault } from '../../src/main/auth/credential-vault'
import { signInWord, type watchSignIn } from '../../src/main/auth/sign-in-watch'
import type { AccountAuthorization } from '../../src/main/messaging/outbox'
import { documents, type FirestoreDocument } from '../../src/main/network/firestore-values'
import type { ConnectionState } from '../../src/shared/model'

// A15-5 (§31, user «권장대로» 10-03 18:3x): an account opens on the server's word about its session and on Firestore,
// not on the message server's socket — where that socket never connects (B95) the account still opens, says
// «연결 중…» and sends through the callables; a socket that connects later is used again; and the sign-in being
// revoked ends the account the same way whether the socket or the Firestore watch noticed it.
const uid = 'u1', sessionId = 'session-0001', authTime = 1700000000, projectId = 'talky-a38c3'
const base64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
const idToken = () => `${base64({ alg: 'none' })}.${base64({ sub: uid, aud: projectId, iss: `https://securetoken.google.com/${projectId}`, morseAuthTime: authTime,
  exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`
const appId = '1:123713400904:web:test'
const configuration: DesktopAuthConfiguration = { apiKey: 'key', appId, projectId, projectNumber: '123713400904', platform: process.platform === 'win32' ? 'Windows' : 'macOS',
  proof: { getProof: async () => ({ token: 'proof', appId, expiresAt: Date.now() + 3600000 }) } }

class FakeSocket extends EventEmitter {
  connected = false
  registers: unknown[] = []
  io = { engine: { transport: { name: 'websocket', writable: true }, once: () => {} } }
  // A socket that is blocked never connects; one that gets through connects when the test says so.
  connect(): this { return this }
  arrive(): void { this.connected = true; super.emit('connect') }
  disconnect(): this { this.connected = false; return this }
  override emit(event: string, ...args: unknown[]): boolean {
    if (event === 'register') { this.registers.push(args[0]); return true }
    return super.emit(event, ...args)
  }
}

function rig(session: () => [number, object] = () => [200, { result: { sessionId } }]) {
  const saved: SavedCredential = { version: 1, profile: { uid, userId: 'minji', displayName: '민지' }, sessionId, refreshToken: 'r1', authTime }
  const removed: string[] = []
  const vault = { location: mkdtempSync(join(tmpdir(), 'morse-a15-5-')), ready: async () => {}, read: async () => ({ ...saved }), save: async () => {},
    remove: async (who: string) => { removed.push(who) }, flush: async () => {} } as unknown as CredentialVault
  const asked: string[] = []
  globalThis.fetch = (async (url: string) => {
    if (String(url).startsWith('https://securetoken.googleapis.com/')) return new Response(JSON.stringify({ id_token: idToken(), refresh_token: 'r2', expires_in: '3600',
      user_id: uid, project_id: '123713400904', token_type: 'Bearer' }), { status: 200 })
    if (String(url).endsWith('/startMorseDeviceSession')) { asked.push('startMorseDeviceSession'); const [status, body] = session(); return new Response(JSON.stringify(body), { status }) }
    throw new TypeError('fetch failed')
  }) as typeof fetch
  const opened: AccountAuthorization[] = [], states: ConnectionState[] = [], closed: [string, boolean][] = []
  const hooks: AuthenticatedAccountHooks = { activated: (_profile, credentials) => { opened.push(credentials) }, connection: (_uid, state) => { states.push(state) },
    closed: (who, purge) => { closed.push([who, purge]) }, notificationHint: () => {}, reactionUpdated: () => {} }
  const sockets: FakeSocket[] = []
  let ask: ((reason: string) => void) | null = null
  const seams: AuthenticationSeams = {
    openSocket: (() => { const socket = new FakeSocket(); sockets.push(socket); return socket }) as unknown as AuthenticationSeams['openSocket'],
    watchSignIn: ((_reader, _uid, _session, _authTime, _signal, onAsk) => { ask = onAsk }) as typeof watchSignIn
  }
  const controller = new AuthenticationController(configuration, vault, '0.241.6', () => {}, hooks, uid, null, seams)
  return { controller, opened, states, closed, removed, sockets, asked, ask: (reason: string) => ask!(reason) }
}
const until = async (done: () => boolean, ms = 3000) => { const end = Date.now() + ms; while (!done() && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 10)) }

test('a socket that never connects: the account opens at once, says it is connecting, and its sender is ready', async () => {
  const { controller, opened, states, sockets } = rig()
  const started = Date.now()
  await controller.restore()
  assert.ok(Date.now() - started < 5000, 'no 45 s wait for a registration')
  assert.equal(controller.connected, true)
  assert.equal(controller.snapshot.phase, 'signed-in')
  assert.equal(opened.length, 1)
  assert.equal(opened[0]!.sender.ready, true, 'sends go by the callable while the socket is away (send-fallback.ts)')
  await until(() => states.length > 0)
  assert.ok(states.includes('connecting') || states.includes('offline'), 'the list and the chat title say «연결 중…»')
  assert.equal(sockets.length, 1, 'the socket was started after the account opened')
  assert.equal(sockets[0]!.registers.length, 0)
  await controller.close()
})

test('a socket that connects later registers and the account says it is connected', async () => {
  const { controller, states, sockets } = rig()
  await controller.restore()
  sockets[0]!.arrive()
  await until(() => sockets[0]!.registers.length === 1)
  sockets[0]!.emit('registered', { ok: true, uid, clientProtocolVersion: 2, capabilities: ['durable-message-ack', 'session-bound-registration'] })
  await until(() => states.at(-1) === 'ready')
  assert.equal(states.at(-1), 'ready')
  assert.equal(controller.connected, true)
  await controller.close()
})

const revokedAnswer = (): [number, object] => [400, { error: { status: 'FAILED_PRECONDITION', message: 'session-revoked', details: { reason: 'session-revoked' } } }]

test('a revoked sign-in noticed on Firestore ends the account as the socket\'s refusal does: asked first, then cleared', async () => {
  let revoked = false
  const { controller, closed, removed, asked, ask } = rig(() => revoked ? revokedAnswer() : [200, { result: { sessionId } }])
  await controller.restore()
  ask('session-revoked')
  await until(() => asked.length === 2)
  assert.deepEqual(closed, [], 'the server confirmed the session: nothing is signed out')
  revoked = true
  ask('session-revoked')
  await until(() => closed.length > 0)
  assert.deepEqual(closed, [[uid, true]], 'signed out, and what this device kept for it is cleared')
  await until(() => removed.length > 0)
  assert.deepEqual(removed, [uid])
  assert.equal(controller.connected, false)
  await controller.close()
})

test('the same revocation coming through the socket ends the account the same way', async () => {
  let revoked = false
  const { controller, closed, removed, sockets } = rig(() => revoked ? revokedAnswer() : [200, { result: { sessionId } }])
  await controller.restore()
  sockets[0]!.arrive()
  await until(() => sockets[0]!.registers.length === 1)
  revoked = true
  sockets[0]!.emit('registrationFailed', { error: 'UNAUTHORIZED', reason: 'session-revoked' })
  await until(() => closed.length > 0)
  assert.deepEqual(closed, [[uid, true]])
  await until(() => removed.length > 0)
  assert.deepEqual(removed, [uid])
  await controller.close()
})

const doc = (name: string, fields: Record<string, unknown>): FirestoreDocument => ({ name, fields } as unknown as FirestoreDocument)
test('what the account and session documents say, as talky-server reads them for the socket (index.js:559-566)', () => {
  const account = doc(`${documents}/users/${uid}`, {}), session = (fields: Record<string, unknown>) => doc(`${documents}/users/${uid}/signInSessions/${sessionId}`, fields)
  assert.equal(signInWord(account, session({ authTime: { integerValue: String(authTime) } }), authTime), 'fine')
  assert.equal(signInWord(undefined, session({ authTime: { integerValue: String(authTime) } }), authTime), 'account-unavailable')
  assert.equal(signInWord(doc(account.name, { accountDeleted: { booleanValue: true } }), session({ authTime: { integerValue: String(authTime) } }), authTime), 'account-unavailable')
  assert.equal(signInWord(account, undefined, authTime), 'session-revoked', 'the session ended (its document deleted)')
  assert.equal(signInWord(account, session({ authTime: { integerValue: String(authTime) }, revokeRequestedAt: { timestampValue: '2026-10-03T00:00:00Z' } }), authTime), 'session-revoked')
  assert.equal(signInWord(account, session({ authTime: { integerValue: '1600000000' } }), authTime), 'session-revoked', 'another sign-in')
})

test('the watch asks when the documents say so or the reads are refused, and listens again a minute after a refusal', async t => {
  const { watchSignIn: watch, signInWatchRetryMs } = await import('../../src/main/auth/sign-in-watch')
  const { ReadFailure } = await import('../../src/main/network/firestore-values')
  const listens: { target: unknown; events: import('../../src/main/network/firestore-rpc').WatchEvents }[] = []
  const reader = { watch: (target: unknown, _signal: AbortSignal, events: import('../../src/main/network/firestore-rpc').WatchEvents) => { listens.push({ target, events }); return () => {} } } as unknown as import('../../src/main/network/firestore-rpc').FirestoreReader
  const asked: string[] = [], life = new AbortController()
  t.mock.timers.enable({ apis: ['setTimeout'] })
  watch(reader, uid, sessionId, authTime, life.signal, reason => asked.push(reason))
  const account = `${documents}/users/${uid}`, session = `${account}/signInSessions/${sessionId}`
  assert.deepEqual(listens[0]!.target, { documents: { documents: [account, session] } })
  listens[0]!.events.snapshot(new Map([[account, doc(account, {})], [session, doc(session, { authTime: { integerValue: String(authTime) } })]]))
  assert.deepEqual(asked, [], 'all is well')
  listens[0]!.events.snapshot(new Map([[account, doc(account, {})]]))
  assert.deepEqual(asked, ['session-revoked'])
  listens[0]!.events.state('error', new ReadFailure('permission', 'PERMISSION_DENIED'))
  assert.deepEqual(asked, ['session-revoked', 'read-refused'], 'a revoked generation makes every read refused (rules :393)')
  assert.equal(listens.length, 1)
  t.mock.timers.tick(signInWatchRetryMs)
  assert.equal(listens.length, 2, 'listening again')
  life.abort()
  listens[1]!.events.state('error', new ReadFailure('network', 'UNAVAILABLE'))
  t.mock.timers.tick(signInWatchRetryMs)
  assert.equal(listens.length, 2, 'an account gone listens no more')
  t.mock.timers.reset()
})
