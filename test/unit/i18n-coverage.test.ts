import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import en from '../../src/shared/i18n/en.json'
import ru from '../../src/shared/i18n/ru.json'

// The app's words are written in Korean and looked up by that text, so a word never added to en.json and ru.json
// is shown in Korean to everyone. Nothing tied the tables to the tr() calls in the source, and 42 words had drifted
// out of them — the whole sticker pack sheet, leaving a group, and the inquiry and notification failures.
const files = (base: string): string[] => readdirSync(base).flatMap(name => {
  const path = join(base, name)
  if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : files(path)
  return /\.tsx?$/.test(name) && !path.includes(`i18n${'/'}`) ? [path] : []
})

const escapes: Record<string, string> = { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"', '`': '`' }
const decode = (raw: string): string => raw.replace(/\\(u[0-9a-fA-F]{4}|.)/gs, (_, c: string) =>
  c.startsWith('u') ? String.fromCharCode(parseInt(c.slice(1), 16)) : escapes[c] ?? c)

test('every Korean word passed to tr() is in the English and Russian tables', () => {
  const missing: string[] = []
  for (const path of files('src')) {
    const source = readFileSync(path, 'utf8').replace(/^[ \t]*\/\/.*$/gm, '')
    for (const [, , raw] of source.matchAll(/\btr\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/gs)) {
      const key = decode(raw as string)
      if (!/[가-힣]/.test(key)) continue
      const gaps = [key in en ? '' : 'en', key in ru ? '' : 'ru'].filter(Boolean)
      if (gaps.length) missing.push(`${path}: ${JSON.stringify(key)} → ${gaps.join(', ')}`)
    }
  }
  assert.deepEqual([...new Set(missing)], [], 'a word with no translation is shown in Korean')
})
