import assert from 'node:assert/strict'
import { test } from 'node:test'
import { qrcodegen } from '../../vendor/qrcodegen/qrcodegen'

// The profile address fits a small code at medium error correction, as iOS's CIQRCodeGenerator draws it.
test('a profile address becomes a QR code with finder patterns in its corners', () => {
  const code = qrcodegen.QrCode.encodeText('https://talky-a38c3.web.app/u/abcd2345', qrcodegen.QrCode.Ecc.MEDIUM)
  assert.ok(code.size >= 21 && code.size <= 37, `size ${code.size}`)
  for (const [x, y] of [[0, 0], [code.size - 1, 0], [0, code.size - 1]]) assert.equal(code.getModule(x!, y!), true)
  assert.equal(code.errorCorrectionLevel, qrcodegen.QrCode.Ecc.MEDIUM)
})

// A13 · 08 §3.2: the sign-in code (morse://login?token=, 63 characters) at quartile correction is version 6, 41 modules
// — the size tdesktop's intro_qr.cpp:146 keeps room for — leaving the logo in its middle well inside what it restores.
test('the sign-in code is drawn at quartile correction, 41 modules', async () => {
  const { qrPath } = await import('../../src/renderer/src/boxes/profile-share-box')
  const path = qrPath(`morse://login?token=${'A'.repeat(43)}`, 'QUARTILE')
  assert.equal(path.size, 41)
  assert.equal(path.modules, 45, 'with the two-module quiet zone')
  assert.ok(qrPath('x').size < path.size, 'medium stays the default')
})
