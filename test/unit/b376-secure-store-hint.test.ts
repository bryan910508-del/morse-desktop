import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { localKeyUnreadableDetail, secureStoreReopenHint } from '../../src/shared/secure-store-hint'

// B376 (reports/desktop/2026-10-14-0.241.30-plan.md): Windows has no Keychain — safeStorage seals the key with the Windows
// account (DPAPI) — so the two places that tell the person what to do say it for the platform they run on.
test('macOS keeps the Keychain words; Windows speaks of its user account and never of a Keychain', () => {
  assert.match(localKeyUnreadableDetail('darwin'), /^키체인 접근을 거부했다면/)
  assert.equal(secureStoreReopenHint('darwin'), '키체인 접근을 허용한 뒤 앱을 다시 열어 주세요.')
  for (const text of [localKeyUnreadableDetail('win32'), secureStoreReopenHint('win32')]) {
    assert.ok(!text.includes('키체인'), text)
    assert.match(text, /Windows/)
  }
  assert.match(localKeyUnreadableDetail('win32'), /휴지통으로 옮겨지고, 저장된 계정은 다시 연결됩니다\.$/, 'what starting over does is the same')
})

test('both places take the words from the one function', () => {
  const main = readFileSync('src/main/index.ts', 'utf8'), outbox = readFileSync('src/main/messaging/outbox.ts', 'utf8')
  assert.match(main, /detail: localKeyUnreadableDetail\(process\.platform\)/)
  assert.match(outbox, /storageReason === 'key' \? secureStoreReopenHint\(process\.platform\)/)
  assert.ok(!/tr\('키체인/.test(main) && !/tr\('키체인/.test(outbox))
})
