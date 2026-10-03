import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { legalLanguage, legalPageURL } from '../../src/shared/legal-links'

// 6A-3: the privacy policy, the community guidelines and the terms open in the app's language — Korean, English or
// Russian — and in English for any other; one function picks it for all three.
test('each page opens in the app language, at the address the site answers without a redirect', () => {
  assert.equal(legalPageURL('privacy', 'ko'), 'https://talky-a38c3.web.app/privacy/ko/')
  assert.equal(legalPageURL('community', 'en'), 'https://talky-a38c3.web.app/community/en/')
  assert.equal(legalPageURL('terms', 'ru'), 'https://talky-a38c3.web.app/terms/ru/')
})

test('any other language opens the English page', () => {
  for (const other of ['ja', 'de', 'ko-KR', '', 'EN']) assert.equal(legalLanguage(other), 'en', other)
  assert.equal(legalPageURL('terms', 'ja'), 'https://talky-a38c3.web.app/terms/en/')
})

test('the terms sit beside the privacy policy in settings, in each language', () => {
  const settings = readFileSync(join(process.cwd(), 'src/renderer/src/settings/settings-box.tsx'), 'utf8')
  const privacy = settings.indexOf("openPolicy('privacy')"), terms = settings.indexOf("openPolicy('terms')"), community = settings.indexOf("openPolicy('community')")
  assert.ok(privacy > 0 && terms > privacy && community > terms, 'privacy policy, terms, guidelines')
  for (const [lang, words] of [['en', 'Terms of Service'], ['ru', 'Условия использования']] as const) {
    const table = JSON.parse(readFileSync(join(process.cwd(), `src/shared/i18n/${lang}.json`), 'utf8')) as Record<string, string>
    assert.equal(table['이용약관'], words, lang)
  }
})
