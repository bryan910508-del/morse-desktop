import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { AccountSession } from '../../src/main/accounts/session'
import { AuthenticationController, profileWriteDelayMs, type AuthenticatedAccountHooks, type AuthenticationSeams } from '../../src/main/auth/controller'
import type { DesktopAuthConfiguration, SavedCredential } from '../../src/main/auth/contracts'
import type { CredentialVault } from '../../src/main/auth/credential-vault'
import type { watchSignIn } from '../../src/main/auth/sign-in-watch'
import type { AccountProfile } from '../../src/shared/model'

// B488: an account's saved sign-in kept the name it had when it signed in, so an account not on screen showed that old
// name. tdesktop's account Session follows its own user (main_session.cpp:205-224) and writes it a second later
// (writeMapDelayed, storage_account.cpp:625-628) as it is when the write runs (writeMap :636-680); every account's row
// reads its own session's user (settings_information.cpp:803-818).
const uid = 'u1', sessionId = 'session-0001', authTime = 1700000000, projectId = 'talky-a38c3'
const base64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
const idToken = () => `${base64({ alg: 'none' })}.${base64({ sub: uid, aud: projectId, iss: `https://securetoken.google.com/${projectId}`, morseAuthTime: authTime,
  exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`
const appId = '1:123713400904:web:test'
const configuration: DesktopAuthConfiguration = { apiKey: 'key', appId, projectId, projectNumber: '123713400904', platform: process.platform === 'win32' ? 'Windows' : 'macOS',
  proof: { getProof: async () => ({ token: 'proof', appId, expiresAt: Date.now() + 3600000 }) } }
class FakeSocket extends EventEmitter {
  connected = false
  io = { engine: { transport: { name: 'websocket', writable: true }, once: () => {} } }
  connect(): this { return this }
  disconnect(): this { this.connected = false; return this }
}
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const until = async (done: () => boolean, ms = 3000) => { const end = Date.now() + ms; while (!done() && Date.now() < end) await wait(10) }

// A saved sign-in whose name is the one it signed in with; each write to the vault is kept, and a write can be held or refused.
function rig(name: Partial<AccountProfile> = {}) {
  const saved: SavedCredential = { version: 1, profile: { uid, userId: 'minji', displayName: '민지', ...name }, sessionId, refreshToken: 'r1', authTime }
  const saves: SavedCredential[] = []
  const vault = { location: mkdtempSync(join(tmpdir(), 'morse-b488-')), ready: async () => {}, read: async () => structuredClone(saved),
    save: async (record: SavedCredential) => { await control.gate; if (control.refuse) throw new Error('storage'); saves.push(structuredClone(record)) },
    remove: async () => {}, flush: async () => {} } as unknown as CredentialVault
  const control = { gate: Promise.resolve() as Promise<void>, refuse: false, lifetime: 3600, refreshed: 1 }
  globalThis.fetch = (async (url: string) => {
    if (String(url).startsWith('https://securetoken.googleapis.com/')) return new Response(JSON.stringify({ id_token: idToken(), refresh_token: `r${++control.refreshed}`,
      expires_in: String(control.lifetime), user_id: uid, project_id: '123713400904', token_type: 'Bearer' }), { status: 200 })
    if (String(url).endsWith('/startMorseDeviceSession')) return new Response(JSON.stringify({ result: { sessionId } }), { status: 200 })
    throw new TypeError('fetch failed')
  }) as typeof fetch
  const hooks: AuthenticatedAccountHooks = { activated: () => {}, connection: () => {}, closed: () => {}, notificationHint: () => {}, reactionUpdated: () => {} }
  const seams: AuthenticationSeams = {
    openSocket: (() => new FakeSocket()) as unknown as AuthenticationSeams['openSocket'],
    watchSignIn: (() => {}) as unknown as typeof watchSignIn
  }
  const controller = new AuthenticationController(configuration, vault, '0.241.43', () => {}, hooks, uid, null, seams)
  return { controller, saves, control }
}
const seen = (userId: string, displayName: string): AccountProfile => ({ uid, userId, displayName })
const settle = () => wait(profileWriteDelayMs + 150)

test('every list of accounts reads one rule: the session\'s own user as last read, else what the sign-in saved', () => {
  const told: AccountProfile[] = []
  const session = { profile: { uid, userId: 'minji', displayName: '민지' }, ownName: null as AccountProfile | null, events: { ownProfile: (profile: AccountProfile) => told.push(profile) },
    selfProfile: { snapshot: { status: 'loading', profile: null } as { status: string; profile: { userId: string; displayName: string } | null } } }
  const account = () => Object.getOwnPropertyDescriptor(AccountSession.prototype, 'account')!.get!.call(session) as AccountProfile
  const tell = () => (AccountSession.prototype as unknown as { tellOwnProfile(this: unknown): void }).tellOwnProfile.call(session)
  assert.deepEqual(account(), { uid, userId: 'minji', displayName: '민지' }, 'not read yet: the saved name')
  session.selfProfile.snapshot = { status: 'ready', profile: { userId: 'minji', displayName: '민지 새' } }
  tell(); tell()
  assert.deepEqual(told, [seen('minji', '민지 새')], 'told once per change')
  assert.equal(account().displayName, '민지 새')
  session.selfProfile.snapshot = { status: 'loading', profile: null }
  tell()
  assert.equal(account().displayName, '민지 새', 'a reconnect keeps the name last read')
  const read = (path: string) => readFileSync(join(__dirname, '../../src/main', path), 'utf8')
  const index = read('index.ts'), registry = read('accounts/registry.ts')
  assert.match(registry, /get profiles\(\): AccountProfile\[\] \{ return this\.all\.map\(session => session\.account\) \}/)
  assert.match(index, /accounts: accounts\.profiles, activeAccountUid/, 'no list of its own that only the active account corrects')
  assert.match(index, /const session = accounts\.get\(state\.uid\), own = session\?\.account/)
  assert.doesNotMatch(index, /selfProfile\.snapshot\.profile\b.*displayName|profile\?\.uid === account\.uid/)
  assert.match(index, /ownProfile: profile => authentication\?\.profileSeen\(uid, profile\)/)
})

test('a new name is taken at once and saved a second later, once; the same name is never saved', async () => {
  const { controller, saves } = rig()
  await controller.restore()
  const start = saves.length
  controller.profileSeen(seen('minji', '민지'))
  await settle()
  assert.equal(saves.length, start, 'the name it already has: no write')
  controller.profileSeen(seen('minji', '민지 하나'))
  assert.equal(controller.snapshot.account?.displayName, '민지 하나', 'shown before the write')
  controller.profileSeen(seen('minji2', '민지 둘'))
  await wait(profileWriteDelayMs / 2)
  assert.equal(saves.length, start, 'waits its second')
  await settle()
  assert.equal(saves.length, start + 1, 'two changes in a second: one write')
  assert.deepEqual(saves.at(-1)!.profile, seen('minji2', '민지 둘'))
  assert.equal(saves.at(-1)!.refreshToken, 'r2', 'the rest of the sign-in is as it was')
  await controller.close()
})

test('a token renewal and a new name never put back each other\'s old value', async () => {
  const { controller, saves, control } = rig()
  control.lifetime = 30
  await controller.restore()
  // A renewal whose write is held, then a name that comes while it waits.
  let release!: () => void
  control.gate = new Promise(resolve => { release = resolve })
  const before = control.refreshed
  const renewal = controller.creationIdToken(new AbortController().signal)
  await until(() => control.refreshed > before)
  controller.profileSeen(seen('minji', '민지 새'))
  await settle()
  release()
  await renewal
  await until(() => saves.at(-1)?.profile.displayName === '민지 새')
  await wait(50)
  assert.equal(saves.at(-1)!.profile.displayName, '민지 새', 'the last write has the new name')
  assert.ok(Number(saves.at(-1)!.refreshToken.slice(1)) > before, 'and the renewed token, not the one before it')
  assert.equal(controller.snapshot.account?.displayName, '민지 새', 'the renewal did not bring the old name back')
  // A renewal after the name carries it too.
  const later = control.refreshed
  await controller.creationIdToken(new AbortController().signal)
  await wait(50)
  assert.equal(saves.at(-1)!.profile.displayName, '민지 새')
  assert.ok(Number(saves.at(-1)!.refreshToken.slice(1)) > later)
  await controller.close()
})

test('a refused write leaves the name shown and the account open, and the next write carries it', async () => {
  const { controller, saves, control } = rig()
  control.lifetime = 30
  await controller.restore()
  await wait(50)
  const start = saves.length
  control.refuse = true
  controller.profileSeen(seen('minji', '민지 새'))
  await settle()
  assert.equal(saves.length, start)
  assert.equal(controller.snapshot.phase, 'signed-in', 'no sign-out, no error screen')
  assert.equal(controller.connected, true)
  assert.equal(controller.snapshot.account?.displayName, '민지 새')
  control.refuse = false
  await controller.creationIdToken(new AbortController().signal)
  assert.equal(saves.at(-1)!.profile.displayName, '민지 새', 'the token\'s write saved the name')
  await controller.close()
})

test('a value the saved sign-in cannot hold is not taken', async () => {
  const { controller, saves } = rig()
  await controller.restore()
  const start = saves.length
  controller.profileSeen(seen('', '이름'))
  controller.profileSeen(seen('minji', '가'.repeat(513)))
  controller.profileSeen(seen('x'.repeat(161), '이름'))
  await settle()
  assert.equal(saves.length, start)
  assert.equal(controller.snapshot.account?.displayName, '민지')
  await controller.close()
})

test('another account\'s profile, or one after the account closed, changes nothing', async () => {
  const { controller, saves } = rig()
  await controller.restore()
  const start = saves.length
  controller.profileSeen({ uid: 'u2', userId: 'other', displayName: '다른 사람' })
  await settle()
  assert.equal(saves.length, start)
  controller.profileSeen(seen('minji', '민지 새'))
  await controller.close()
  await settle()
  assert.equal(saves.length, start, 'a write still waiting when the account closed is dropped')
  controller.profileSeen(seen('minji', '민지 또'))
  await settle()
  assert.equal(saves.length, start)
})

test('an account saved by its recovery code with its userId for a name takes its own name once read', async () => {
  const { controller, saves } = rig({ displayName: 'minji' })
  await controller.restore()
  const start = saves.length
  controller.profileSeen(seen('minji', ''))
  await settle()
  assert.equal(saves.length, start, 'an empty name is the userId, as self-profile reads it: nothing new')
  controller.profileSeen(seen('minji', '민지'))
  await settle()
  assert.deepEqual(saves.at(-1)!.profile, seen('minji', '민지'))
  await controller.close()
})
