import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { AuthenticationDomain } from '../../src/main/auth/domain'
import { AuthenticationFailure, type DesktopAuthConfiguration, type SavedCredential } from '../../src/main/auth/contracts'
import type { CredentialVault } from '../../src/main/auth/credential-vault'
import { proofRestoreTries, restoreRetryDelay, restoreRetryKind } from '../../src/main/auth/restore-retry'
import { HostedWebAppProof, type ProofAsking } from '../../src/main/auth/web-app-proof'
import { reachability } from '../../src/main/network/reachability'
const hostPlatform = process.platform === 'win32' ? 'Windows' as const : 'macOS' as const

// B522 (server: 403s from the check page's key at a multi-account Desktop's start): the version gate asked for the app's
// own proof before the saved accounts had their sessions, so the check page ran — in view when refused — and every
// restore waited on it; a restore that failed on the proof never tried again by itself.
const appId = '1:123713400904:web:test'

test('a restore the security check failed tries again a few times, then waits for the network or a wake', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const uid = 'uid-a'
  const idToken = ['h', Buffer.from(JSON.stringify({ sub: uid, aud: 'talky-a38c3', iss: 'https://securetoken.google.com/talky-a38c3', auth_time: 100,
    iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url'), 's'].join('.')
  globalThis.fetch = (async () => new Response(JSON.stringify({ user_id: uid, project_id: '123713400904', token_type: 'Bearer', id_token: idToken,
    refresh_token: 'r2', expires_in: '3600' }))) as typeof fetch
  const asked: string[] = []
  const configuration: DesktopAuthConfiguration = { apiKey: 'key', appId, projectId: 'talky-a38c3', projectNumber: '123713400904', platform: hostPlatform,
    proof: { getProof: async (_signal, purpose) => { asked.push(purpose ?? ''); throw new AuthenticationFailure('app-proof-refused') } } }
  const record: SavedCredential = { version: 1, profile: { uid, userId: 'a', displayName: 'A' }, sessionId: 'session-a', refreshToken: 'r1', authTime: 100 }
  const vault = { location: mkdtempSync(join(tmpdir(), 'morse-b522-')), ready: async () => {}, read: async () => ({ ...record }), save: async () => {}, remove: async () => {},
    flush: async () => {}, endingSessions: async () => [], saveEndingSessions: async () => [], active: async () => uid, list: async () => [uid], accounts: async () => [] } as unknown as CredentialVault
  const domain = new AuthenticationDomain(configuration, vault, '0.241.51', () => {}, {
    activated: () => {}, connection: () => {}, closed: () => {}, notificationHint: () => {}, reactionUpdated: () => {}, maxAccounts: () => 3, activeUid: () => null })
  const settle = async () => { for (let i = 0; i < 40; i++) await new Promise(resolve => setImmediate(resolve)) }
  await domain.start(); await settle()
  assert.deepEqual(asked, ['startMorseDeviceSession'], 'the restore asked once, for its session start')
  for (let attempt = 0; attempt < proofRestoreTries; attempt++) { t.mock.timers.tick(restoreRetryDelay(attempt)); await settle() }
  assert.equal(asked.length, 1 + proofRestoreTries, 'it waited and tried again, each time')
  t.mock.timers.tick(restoreRetryDelay(99) * 3); await settle()
  assert.equal(asked.length, 1 + proofRestoreTries, 'then it holds: a refusing network is not asked every two minutes')
  reachability.returned('system'); await settle()
  assert.equal(asked.length, 2 + proofRestoreTries, 'the network coming back tries again')
  domain.suspend(); domain.resume(); await settle()
  assert.equal(asked.length, 3 + proofRestoreTries, 'and so does a wake')
  await domain.close(); t.mock.timers.reset()
})

test('only a network or security-check failure is tried again by itself', () => {
  assert.deepEqual(['network', 'app-proof', 'app-proof-refused', 'revoked', 'protocol', null].map(restoreRetryKind), ['network', 'proof', 'proof', null, null, null])
})

test('the check\'s log says who asked and how many sessions could prove the app then', async () => {
  const seen: ProofAsking[] = []
  const proof = new HostedWebAppProof('https://morse-desktop-auth.web.app', appId, 'macOS', null, async (_signal, _visible, _deadline, asking) => {
    seen.push(asking!); throw Object.assign(new AuthenticationFailure('app-proof'), { proofStep: 'timeout' })
  })
  await assert.rejects(proof.getProof(new AbortController().signal, 'config:desktop'))
  assert.deepEqual(seen, [{ for: 'config:desktop', sessions: 0 }, { for: 'config:desktop', sessions: 0 }], 'hidden, then the window in view')
})

test('at start the version gate uses the check page only on a computer with no saved account', () => {
  const main = readFileSync('src/main/index.ts', 'utf8')
  assert.match(main, /const saved = \(await credentialVault\?\.list\(\)\.catch\(\(\) => \[\] as string\[\]\) \?\? \[\]\)\.length > 0\n\s*if \(!saved\) return await authentication\?\.publicConfig\('desktop', signal\)\.catch\(\(\) => null\) \?\? null\n\s*return await accounts\.active\?\.appConfig\('desktop'\)/)
  assert.ok(main.indexOf('readVersionGate(true)\n    setInterval') < main.indexOf('if (localKey.ready) startAccounts()'), 'still read at start, before the accounts start')
  const rest = readFileSync('src/main/auth/firebase-rest.ts', 'utf8')
  assert.match(rest, /this\.proof\(signal, `config:\$\{name\}`\)/)
  assert.match(rest, /this\.proof\(signal, name\)/)
})

test('with no saved account the QR switch is still read at start, with the app\'s own proof', async () => {
  const asked: string[] = []
  const configuration: DesktopAuthConfiguration = { apiKey: 'key', appId, projectId: 'talky-a38c3', projectNumber: '123713400904', platform: hostPlatform,
    proof: { getProof: async (_signal, purpose) => { asked.push(purpose ?? ''); throw new AuthenticationFailure('app-proof') } } }
  const vault = { location: mkdtempSync(join(tmpdir(), 'morse-b522-')), ready: async () => {}, read: async () => null, save: async () => {}, remove: async () => {},
    flush: async () => {}, endingSessions: async () => [], saveEndingSessions: async () => [], active: async () => null, list: async () => [], accounts: async () => [] } as unknown as CredentialVault
  const domain = new AuthenticationDomain(configuration, vault, '0.241.51', () => {}, {
    activated: () => {}, connection: () => {}, closed: () => {}, notificationHint: () => {}, reactionUpdated: () => {}, maxAccounts: () => 3, activeUid: () => null })
  for (let i = 0; i < 40; i++) await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(asked, ['config:qr_login'])
  await domain.close()
})
