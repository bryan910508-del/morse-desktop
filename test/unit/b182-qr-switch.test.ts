import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { AuthenticationController, type AuthenticatedAccountHooks } from '../../src/main/auth/controller'
import type { DesktopAuthConfiguration } from '../../src/main/auth/contracts'
import type { CredentialVault } from '../../src/main/auth/credential-vault'

// B182: «계정 추가» drew the QR panel before it read app_config/qr_login, and took it away once it read «off» — a release
// build, where the switch is on only for test builds, showed the panel for a moment every time. tdesktop decides its
// first step before drawing it (intro_start.cpp:34). The QR is drawn only once the switch is known to be on; the last
// reading is carried to the next sign-in screen, so a known «on» draws at once and a known «off» never draws.
const appId = '1:123713400904:web:test'
const configuration: DesktopAuthConfiguration = { apiKey: 'key', appId, projectId: 'talky-a38c3', projectNumber: '123713400904', platform: 'macOS',
  proof: { getProof: async () => ({ token: 'proof', appId, expiresAt: Date.now() + 3600000 }) } }
const vault = () => ({ location: mkdtempSync(join(tmpdir(), 'morse-b182-')), ready: async () => {}, read: async () => null, save: async () => {}, remove: async () => {}, flush: async () => {} } as unknown as CredentialVault)

function rig(known: boolean | null, switchDoc: object | null) {
  const readings: boolean[] = [], drawn: boolean[] = []
  globalThis.fetch = (async (url: string) => {
    if (String(url).includes('/app_config/qr_login')) return switchDoc ? new Response(JSON.stringify(switchDoc), { status: 200 }) : new Response('{}', { status: 404 })
    throw new TypeError('fetch failed')
  }) as typeof fetch
  const hooks: AuthenticatedAccountHooks = { activated: () => {}, connection: () => {}, closed: () => {}, notificationHint: () => {}, reactionUpdated: () => {},
    qrSwitch: { known: () => known, changed: on => { readings.push(on) } } }
  let controller: AuthenticationController | null = null
  controller = new AuthenticationController(configuration, vault(), '0.241.11', () => { if (controller) drawn.push(controller.snapshot.qrOff !== true) }, hooks, null, null)
  return { controller, readings, drawn }
}

test('B182: with the switch off (a release build), the QR panel is never drawn, not even for a moment', async () => {
  const { controller, readings, drawn } = rig(null, { fields: { enabled: { booleanValue: false }, testing: { booleanValue: true } } })
  assert.equal(controller.snapshot.qrOff, true, 'not known yet: not drawn')
  await controller.signInWithQr([]).catch(() => {})
  assert.deepEqual(readings, [false], 'the reading goes to the device for the next screen')
  assert.equal(drawn.includes(true), false, 'no snapshot ever drew it')
  assert.equal(controller.snapshot.qrOff, true)
  // Unreadable is off too (A13 D-6), and stays not drawn.
  const unreadable = rig(null, null)
  await unreadable.controller.signInWithQr([]).catch(() => {})
  assert.equal(unreadable.drawn.includes(true), false)
  assert.deepEqual(unreadable.readings, [false])
})

test('B182: a switch already known on is drawn at once on the next sign-in screen; known off is not', () => {
  assert.notEqual(rig(true, null).controller.snapshot.qrOff, true, 'known on: drawn from the first frame — nothing moves later')
  assert.equal(rig(false, null).controller.snapshot.qrOff, true, 'known off: never drawn')
  assert.equal(rig(null, null).controller.snapshot.qrOff, true, 'unknown: not drawn until read')
})
