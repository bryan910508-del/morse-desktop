import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { AuthenticationDomain } from '../../src/main/auth/domain'
import type { DesktopAuthConfiguration } from '../../src/main/auth/contracts'
import type { CredentialVault } from '../../src/main/auth/credential-vault'
import { reconnectingAtStart } from '../../src/renderer/src/auth/entry-screen'

// B193 (0.241.13 on the user's Mac): after the passcode the QR form flashed three or four times before the account
// opened. The form showed in every gap of the start — the saved list not read yet, an account's first «signed-out»
// before its restore, and its «signed-in» before its session was open.
const base = { starting: false, hasActive: false, adding: false, busy: false, manual: false, saved: [] }

test('the start reads as «connecting» through every gap until the first account is in the window', () => {
  assert.equal(reconnectingAtStart({ ...base, starting: true }), true, 'the saved list is still being read')
  assert.equal(reconnectingAtStart({ ...base, starting: true, saved: [{ phase: 'signed-out' }] }), true, 'an account before its restore begins')
  assert.equal(reconnectingAtStart({ ...base, saved: [{ phase: 'restoring' }] }), true)
  assert.equal(reconnectingAtStart({ ...base, saved: [{ phase: 'connecting' }] }), true)
  assert.equal(reconnectingAtStart({ ...base, saved: [{ phase: 'signed-in' }] }), true, 'signed in, its session not open yet')
})

test('the form comes only when nothing is coming, or the person asked for it', () => {
  assert.equal(reconnectingAtStart(base), false, 'no saved account')
  assert.equal(reconnectingAtStart({ ...base, saved: [{ phase: 'signed-out' }, { phase: 'error' }] }), false, 'the start is over and none reconnects')
  assert.equal(reconnectingAtStart({ ...base, starting: true, manual: true }), false, '«복구 코드로 연결하기» pressed')
  assert.equal(reconnectingAtStart({ ...base, starting: true, adding: true }), false, '«계정 추가» has its own screen')
  assert.equal(reconnectingAtStart({ ...base, starting: true, hasActive: true }), false, 'an account is open')
})

const appId = '1:123713400904:web:test'
const configuration: DesktopAuthConfiguration = { apiKey: 'key', appId, projectId: 'talky-a38c3', projectNumber: '123713400904', platform: 'macOS',
  proof: { getProof: async () => ({ token: 'proof', appId, expiresAt: Date.now() + 3600000 }) } }

test('the domain says «starting» from the first frame of start() until the first restore has settled', async () => {
  globalThis.fetch = (async () => { throw new TypeError('fetch failed') }) as typeof fetch
  let release: () => void = () => {}
  const listed = new Promise<void>(resolve => { release = resolve })
  const vault = { location: mkdtempSync(join(tmpdir(), 'morse-b193-')), ready: async () => {}, read: async () => null, save: async () => {}, remove: async () => {},
    flush: async () => {}, endingSessions: async () => [], saveEndingSessions: async () => [], active: async () => null,
    list: async () => { await listed; return ['uid-a'] }, accounts: async () => [] } as unknown as CredentialVault
  const frames: boolean[] = []
  let domain: AuthenticationDomain | null = null
  domain = new AuthenticationDomain(configuration, vault, '0.241.15', () => { if (domain) frames.push(domain.entrySnapshot.starting === true) }, {
    activated: () => {}, connection: () => {}, closed: () => {}, notificationHint: () => {}, reactionUpdated: () => {}, maxAccounts: () => 2, activeUid: () => null })
  await new Promise(resolve => setTimeout(resolve, 20))
  frames.length = 0
  const started = domain.start()
  assert.equal(domain.entrySnapshot.starting, true, 'set before the saved list is read')
  assert.equal(frames[0], true, 'the first frame of the start already says so')
  release()
  await started
  assert.equal(domain.entrySnapshot.starting, undefined, 'over once the first restore settled')
  assert.equal(frames.at(-1), false)
  await domain.close?.()
})
