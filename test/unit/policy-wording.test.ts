import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { autoDeleteMonthsOf } from '../../src/shared/account-tools'

// Privacy policy v2 (approved 10-03): what the app says matches what the policy says.
const source = (path: string): string => readFileSync(join(process.cwd(), path), 'utf8')

test('an account with no stored auto-delete choice reads as «끔», and no option is called the default', () => {
  assert.equal(autoDeleteMonthsOf(undefined), 0, 'D4: not deleted for being away unless chosen')
  assert.equal(autoDeleteMonthsOf(6), 6)
  assert.equal(autoDeleteMonthsOf(3.7), 3)
  assert.ok(!source('src/renderer/src/settings/settings-box.tsx').includes('(기본)'))
})

test('the export, support and help texts say what the policy says', () => {
  const settings = source('src/renderer/src/settings/settings-box.tsx'), support = source('src/renderer/src/settings/support-boxes.tsx')
  assert.ok(settings.includes("tr('처리에 최대 1분이 걸려요. 메시지는 담기지 않아요.')"), 'the export has no messages at all, encrypted or not')
  assert.ok(!settings.includes('E2E 암호화되어 포함되지'))
  assert.ok(!support.includes('영업일'), 'no business-day promise; reports are seen within 24 hours')
  assert.ok(support.includes("tr('신고는 운영자가 24시간 안에 확인합니다.')"))
  assert.equal(support.split('secretOnPhones()').length - 1, 2, 'the FAQ answer and the guide both say secret chats are on the phone apps only')
})

test('every new text has its English and Russian', () => {
  for (const lang of ['en', 'ru']) {
    const table = JSON.parse(source(`src/shared/i18n/${lang}.json`)) as Record<string, string>
    for (const key of ['180일 미접속 시', '처리에 최대 1분이 걸려요. 메시지는 담기지 않아요.', '비밀 대화는 휴대폰 앱에서만 쓸 수 있어요.', '신고는 운영자가 24시간 안에 확인합니다.'])
      assert.ok(table[key], `${lang}: ${key}`)
  }
})

// §27: the server counts a month as 30 days, so twelve months are 360 days (privacy policy v2 §5.2, iOS §40).
test('twelve months of absence read as 360 days, as the server counts them', () => {
  const settings = source('src/renderer/src/settings/settings-box.tsx')
  assert.ok(settings.includes("tr('360일 미접속 시')") && !settings.includes('365일 미접속'))
  for (const lang of ['en', 'ru']) assert.ok((JSON.parse(source(`src/shared/i18n/${lang}.json`)) as Record<string, string>)['360일 미접속 시'], lang)
})
