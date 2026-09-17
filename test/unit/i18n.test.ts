import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveLanguage, setLanguage, sourceText, tr } from '../../src/shared/i18n'
import en from '../../src/shared/i18n/en.json'
import ru from '../../src/shared/i18n/ru.json'

// iOS LocalizationService: the saved language, else the system's when Morse has it, else Korean.
test('the language is the saved choice, then the system language, then Korean', () => {
  assert.equal(resolveLanguage('ru', ['en-US']), 'ru')
  assert.equal(resolveLanguage(null, ['en-GB', 'ko-KR']), 'en')
  assert.equal(resolveLanguage(undefined, ['ja-JP']), 'ko')
  assert.equal(resolveLanguage('fr', []), 'ko')
})

test('words are looked up by their Korean text, with numbered values and plural forms', () => {
  setLanguage('ko')
  assert.equal(tr('댓글 {0}개', [3]), '댓글 3개')
  setLanguage('en')
  assert.equal(tr('댓글 {0}개', [1]), '1 comment')
  assert.equal(tr('댓글 {0}개', ['1,204']), '1,204 comments')
  assert.equal(tr('없는 문장 {0}', ['x']), '없는 문장 x', 'a missing translation falls back to Korean')
  setLanguage('ru')
  assert.equal(tr('댓글 {0}개', [2]), '2 комментария')
  assert.equal(tr('댓글 {0}개', [5]), '5 комментариев')
  assert.equal(tr('댓글 {0}개', [21]), '21 комментарий')
  setLanguage('ko')
})

test('a translated message can be traced back to its Korean text', () => {
  setLanguage('en')
  assert.equal(sourceText(tr('마이크 권한을 먼저 확인해 주세요.')), '마이크 권한을 먼저 확인해 주세요.')
  assert.equal(sourceText(tr('만료 {0}', ['today'])), '만료 {0}')
  assert.equal(sourceText('not ours'), 'not ours')
  setLanguage('ko')
})

test('every translation keeps the values of its Korean text', () => {
  const holders = (text: string): string => [...new Set(text.match(/\{\d+\}/g) ?? [])].sort().join(',')
  for (const table of [en, ru] as Record<string, string | Record<string, string>>[]) {
    for (const [key, entry] of Object.entries(table)) {
      for (const text of typeof entry === 'string' ? [entry] : Object.values(entry)) {
        for (const holder of text.match(/\{\d+\}/g) ?? []) assert.ok(key.includes(holder), `${key} → ${text}`)
        if (typeof entry === 'string') assert.equal(holders(text), holders(key), key)
        assert.doesNotMatch(text, /[가-힣]/, key)
      }
    }
  }
})
