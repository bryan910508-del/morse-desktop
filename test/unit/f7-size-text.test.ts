import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bytes } from '../../src/renderer/src/app/format'

// F7: sizes are written as tdesktop's Ui::FormatSizeText writes them (ui/text/format_values.cpp:54-68).
test('a size under 1 KB is in bytes, and KB and MB keep one decimal cut, not rounded', () => {
  assert.equal(bytes(0), '0 B')
  assert.equal(bytes(20), '20 B')
  assert.equal(bytes(1023), '1023 B')
  assert.equal(bytes(1024), '1.0 KB')
  assert.equal(bytes(1535), '1.4 KB')
  assert.equal(bytes(36681), '35.8 KB')
  assert.equal(bytes(1024 * 1024 - 1), '1023.9 KB')
  assert.equal(bytes(1024 * 1024), '1.0 MB')
  assert.equal(bytes(2189438), '2.0 MB')
  assert.equal(bytes(1.99 * 1024 * 1024 * 1024), '1.9 GB')
})
