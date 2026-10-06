import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { isValidElement } from 'react'
import { test } from 'node:test'
import { linkedParts } from '../../src/renderer/src/ui/linked-text'
import { gplURL, releaseSourceURL } from '../../src/shared/app-release'
import { setLanguage, tr } from '../../src/shared/i18n'

// B179, tdesktop about_box.cpp:127-129 / lng_about_text2: the about box says the licence and where the source is, in one
// line with two links, and nothing about where the code came from (that stays in LEGAL and THIRD_PARTY_NOTICES.txt).
const line = '이 프로그램은 {0} 3판 이상으로 배포됩니다. 소스 코드는 {1}에 있습니다.'

test('B179: the licence line puts its two links where each language\'s words need them', () => {
  for (const language of ['ko', 'en', 'ru'] as const) {
    setLanguage(language)
    const parts = linkedParts(tr(line), ['GPL', 'GitHub'])
    const links = parts.filter(isValidElement)
    assert.equal(links.length, 2, `${language}: two links`)
    assert.equal(parts.filter(part => typeof part === 'string').join('').includes('{'), false, `${language}: no placeholder left`)
    assert.equal(parts.some(part => typeof part === 'string' && /Telegram/.test(part)), false)
  }
  setLanguage('ko')
  assert.equal(gplURL, 'https://www.gnu.org/licenses/gpl-3.0.html')
  assert.match(releaseSourceURL, /^https:\/\/github\.com\//)
})

test('B179: the notices the link opens ship with the app, with LICENSE and LEGAL, and say where the code came from', () => {
  const files = (JSON.parse(readFileSync('package.json', 'utf8')) as { build: { files: string[] } }).build.files.join('\n')
  for (const name of ['LICENSE', 'LEGAL', 'THIRD_PARTY_NOTICES.txt']) assert.ok(files.includes(name), `${name} is packaged`)
  assert.ok(existsSync('resources/THIRD_PARTY_NOTICES.txt'))
  assert.match(readFileSync('resources/THIRD_PARTY_NOTICES.txt', 'utf8'), /derived from Telegram Desktop/)
  assert.match(readFileSync('LEGAL', 'utf8'), /The Telegram Desktop Authors/)
})
