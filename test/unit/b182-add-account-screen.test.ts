import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { AuthenticationDomain } from '../../src/main/auth/domain'
import type { DesktopAuthConfiguration } from '../../src/main/auth/contracts'
import type { CredentialVault } from '../../src/main/auth/credential-vault'
import { qrShown } from '../../src/shared/auth'

// B182 (again, 0.241.11 on the user's Mac): «계정 추가» with the QR switch off showed the QR area for a moment. Before
// the screen's QR start made the adding controller, the domain's own entry snapshot said nothing of the QR — drawn —
// and the controller made then said «not drawn». The screen must stay, and the QR area must never be drawn.
const appId = '1:123713400904:web:test'
const configuration: DesktopAuthConfiguration = { apiKey: 'key', appId, projectId: 'talky-a38c3', projectNumber: '123713400904', platform: 'macOS',
  proof: { getProof: async () => ({ token: 'proof', appId, expiresAt: Date.now() + 3600000 }) } }

function rig(switchOn: boolean | (() => boolean | null)) {
  const answer = typeof switchOn === 'function' ? switchOn : () => switchOn
  globalThis.fetch = (async (url: string) => {
    if (String(url).includes('/app_config/qr_login')) {
      const on = answer()
      if (on === null) throw new TypeError('fetch failed')
      return new Response(JSON.stringify({ fields: { enabled: { booleanValue: on }, testing: { booleanValue: true } } }), { status: 200 })
    }
    if (String(url).includes('/app_config/')) return new Response('{}', { status: 404 })
    throw new TypeError('fetch failed')
  }) as typeof fetch
  const vault = { location: mkdtempSync(join(tmpdir(), 'morse-b182b-')), ready: async () => {}, read: async () => null, save: async () => {}, remove: async () => {}, flush: async () => {},
    endingSessions: async () => [], saveEndingSessions: async () => {}, list: async () => [], accounts: async () => [] } as unknown as CredentialVault
  const frames: { adding: boolean; qrDrawn: boolean }[] = []
  let domain: AuthenticationDomain | null = null
  domain = new AuthenticationDomain(configuration, vault, '0.241.11', () => { if (domain) frames.push({ adding: domain.addingRequested, qrDrawn: qrShown(domain.entrySnapshot) }) }, {
    activated: () => {}, connection: () => {}, closed: () => {}, notificationHint: () => {}, reactionUpdated: () => {}, maxAccounts: () => 2, activeUid: () => null })
  return { domain, frames }
}
const settle = () => new Promise(resolve => setTimeout(resolve, 50))

test('B182: «계정 추가» with the QR switch off stays on screen and never draws the QR area', async () => {
  const { domain, frames } = rig(false)
  await settle()
  frames.length = 0 // the screen opens here; what came before is the window without it
  domain.beginAdd()
  assert.equal(domain.addingRequested, true)
  assert.equal(domain.entrySnapshot.qrOff, true, 'before the QR start made a controller: not drawn')
  await domain.signInWithQr().catch(() => {})
  await settle()
  assert.equal(domain.addingRequested, true, 'the screen stays')
  assert.equal(domain.entrySnapshot.qrOff, true)
  assert.equal(frames.some(frame => frame.qrDrawn), false, `no frame drew the QR: ${JSON.stringify(frames)}`)
  assert.equal(frames.some(frame => !frame.adding), false, 'no frame left the screen')
  await domain.close?.()
})

test('B182: with the switch on, the screen known to be on draws the QR from its first frame', async () => {
  const { domain } = rig(true)
  await settle()
  domain.beginAdd()
  assert.equal(domain.entrySnapshot.qrOff, false)
  assert.equal(qrShown(domain.entrySnapshot), true)
  await domain.close?.()
})

test('B182: the screen draws nothing for a snapshot that does not say «on»', () => {
  assert.equal(qrShown({}), false, 'no value: hidden')
  assert.equal(qrShown({ qrOff: undefined }), false)
  assert.equal(qrShown({ qrOff: true }), false)
  assert.equal(qrShown({ qrOff: false }), true)
})

test('B182: a switch unreadable at start is read again on «계정 추가», and the QR is drawn once it is on', async () => {
  let reachable = false
  const { domain } = rig(() => reachable ? true : null)
  await settle()
  assert.equal(domain.entrySnapshot.qrOff, true, 'unreadable at start: not drawn')
  reachable = true
  domain.beginAdd()
  assert.equal(qrShown(domain.entrySnapshot), false, 'not yet read again')
  await settle()
  assert.equal(qrShown(domain.entrySnapshot), true, 'read again on «계정 추가»: drawn')
  await domain.close?.()
})
