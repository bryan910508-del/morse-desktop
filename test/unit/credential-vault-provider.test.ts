import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { CredentialVault } from '../../src/main/auth/credential-vault'

// B150: how this device signed in comes back from the vault for every kind, so a restart starts the session with it
// (startMorseDeviceSession loginProvider) — a Google sign-in was read back as none and restarted as «custom».
test('a saved sign-in keeps how it was made: Apple, Google or QR', async () => {
  const vault = new CredentialVault(mkdtempSync(join(tmpdir(), 'morse-b150-')))
  for (const provider of ['apple.com', 'google.com', 'qr', undefined] as const) {
    const uid = `u-${provider ?? 'code'}`.replace('.', '-')
    await vault.save({ version: 1, profile: { uid, userId: 'minji', displayName: '민지' }, sessionId: 'session-0001', refreshToken: 'r', authTime: 1, ...(provider ? { provider } : {}) })
    assert.equal((await vault.read(uid))?.provider, provider, String(provider))
  }
})
