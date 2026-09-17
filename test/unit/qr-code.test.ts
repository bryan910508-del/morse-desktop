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
