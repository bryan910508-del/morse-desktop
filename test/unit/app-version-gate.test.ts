import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { AuthenticationController } from '../../src/main/auth/controller'
import type { CredentialVault } from '../../src/main/auth/credential-vault'
import { AppVersionGate, compareVersions, releasesURL, versionGateRefreshMs, versionRequirement } from '../../src/main/platform/app-version-gate'

// app_config/desktop with the fields iOS and Android read (Android AppVersionRequirement.kt): below minVersion the app
// is blocked; below currentVersion the updater is asked to check; a failed or malformed read keeps the last decision.
const text = (value: string) => ({ stringValue: value })
const doc = (fields: Record<string, unknown>) => ({ fields })

test('versions are compared by dot segments as numbers; a missing segment is 0', () => {
  assert.equal(compareVersions('0.241.9', '0.241.10'), -1)
  assert.equal(compareVersions('0.241.10', '0.241.10'), 0)
  assert.equal(compareVersions('0.242', '0.241.10'), 1)
  assert.equal(compareVersions('1.0', '1.0.0'), 0)
})

test('only a valid minimum is required; a bad address or message does not discard it', () => {
  assert.equal(versionRequirement(null), null)
  assert.equal(versionRequirement(doc({})), null)
  assert.equal(versionRequirement(doc({ minVersion: text('0.241.x') })), null)
  assert.equal(versionRequirement(doc({ minVersion: { integerValue: '1' } })), null)
  assert.deepEqual(versionRequirement(doc({ minVersion: text('0.241.10') })), { minVersion: '0.241.10', currentVersion: null, storeUrl: releasesURL, messages: {} })
  assert.deepEqual(versionRequirement(doc({ minVersion: text('0.241.10'), currentVersion: text('0.242.0'), storeUrl: text('https://example.com/morse'),
    updateMessage: { mapValue: { fields: { ko: text('업데이트해 주세요'), en: text('Please update') } } } })),
  { minVersion: '0.241.10', currentVersion: '0.242.0', storeUrl: 'https://example.com/morse', messages: { ko: '업데이트해 주세요', en: 'Please update' } })
  assert.equal(versionRequirement(doc({ minVersion: text('1'), storeUrl: text('http://example.com') }))?.storeUrl, releasesURL, 'https only')
  assert.deepEqual(versionRequirement(doc({ minVersion: text('1'), updateMessage: { mapValue: { fields: { ko: text('a'), en: { booleanValue: true } } } } }))?.messages, {},
    'iOS takes the whole map as text or none of it')
})

test('below the minimum the window is blocked, in the app language, then ko, then en, else the app\'s own words', async () => {
  const gate = new AppVersionGate('0.241.9', () => {}, () => {})
  assert.deepEqual(gate.snapshot('ko'), { blocked: false, message: null, storeUrl: releasesURL }, 'no document: open')
  await gate.refresh(async () => doc({ minVersion: text('0.241.10'), updateMessage: { mapValue: { fields: { ko: text('가'), en: text('A') } } } }))
  assert.deepEqual(gate.snapshot('ru'), { blocked: true, message: '가', storeUrl: releasesURL })
  assert.equal(gate.snapshot('en').message, 'A')
  const open = new AppVersionGate('0.241.10', () => {}, () => {})
  await open.refresh(async () => doc({ minVersion: text('0.241.10') }))
  assert.equal(open.snapshot('ko').blocked, false, 'the minimum itself runs')
})

test('a failed, missing or malformed read keeps the last decision', async () => {
  const gate = new AppVersionGate('0.241.9', () => {}, () => {})
  await gate.refresh(async () => doc({ minVersion: text('0.241.10') }))
  for (const read of [async () => { throw new Error('offline') }, async () => null, async () => doc({ minVersion: text('x') })]) {
    await gate.refresh(read, true)
    assert.equal(gate.snapshot('ko').blocked, true)
  }
})

test('read again at most every 12 hours unless forced; a newer current version asks the updater once', async () => {
  const clock = { now: 1_000_000 }
  let reads = 0, newer = 0, changed = 0
  const gate = new AppVersionGate('0.241.10', () => { changed++ }, () => { newer++ }, () => clock.now)
  const read = async () => { reads++; return doc({ minVersion: text('0.241.9'), currentVersion: text('0.241.11') }) }
  await gate.refresh(read)
  await gate.refresh(read)
  assert.equal(reads, 1)
  await gate.refresh(read, true)
  assert.equal(reads, 2, 'an account opening or the start reads at once')
  clock.now += versionGateRefreshMs
  await gate.refresh(read)
  assert.equal(reads, 3)
  assert.equal(newer, 1, 'the same newer version is asked about once')
  assert.equal(changed, 1, 'the same document changes nothing')
  assert.equal(gate.snapshot('ko').blocked, false)
})

test('a version the server turned away is said so, with «업데이트», on the sign-in screen and the account\'s row', async () => {
  const vault = { location: mkdtempSync(join(tmpdir(), 'morse-gate-')), ready: async () => {}, read: async () => null, flush: async () => {} } as unknown as CredentialVault
  const hooks = { activated: () => {}, connection: () => {}, closed: () => {}, notificationHint: () => {}, reactionUpdated: () => {} }
  const controller = new AuthenticationController(null, vault, '0.241.10', () => {}, hooks, 'u1')
  const inner = controller as unknown as { failure: string | null; set(phase: string, message: string): void }
  inner.failure = 'update-required'; inner.set('error', 'x')
  assert.equal(controller.snapshot.updateRequired, true)
  inner.failure = 'network'; inner.set('error', 'x')
  assert.equal(controller.snapshot.updateRequired, undefined)
  await controller.close()
})
