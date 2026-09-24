import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setLanguage } from '../../src/shared/i18n'
import { subscriberCountFull, subscriberCountText } from '../../src/shared/channel-subscriber-count'

// Official Telegram's compactNumericCountString truncates the decimal digit and leaves it out when it is zero
// (submodules/TelegramPresentationData/Sources/NumericFormat.swift, commit
// 6ad963e5b62d354da79040f388ae2b9132fb17b8). Rounding, which Intl's compact notation does, reads a channel of
// 999,999 as a million.
test('a folded count truncates its decimal digit and drops a zero one', () => {
  setLanguage('en')
  assert.equal(subscriberCountText(1000), '1K')
  assert.equal(subscriberCountText(1500), '1.5K')
  assert.equal(subscriberCountText(12000), '12K')
  assert.equal(subscriberCountText(12999), '12.9K')
  assert.equal(subscriberCountText(999999), '999.9K')
  assert.equal(subscriberCountText(1000000), '1M')
  assert.equal(subscriberCountText(1250000), '1.2M')
  setLanguage('ko')
})

// The unit differs by language, which is what iOS got wrong: all three of its languages folded at 10,000 into a
// string that reads M in English, so a channel of 12,000 subscribers said 1.2M.
test('Korean folds into 만, English and Russian into K and M', () => {
  setLanguage('ko')
  assert.equal(subscriberCountText(1500), '1.5k명')
  assert.equal(subscriberCountText(12000), '1.2만명')
  assert.equal(subscriberCountText(250000), '25만명')
  setLanguage('ru')
  assert.equal(subscriberCountText(12000), '12K')
  assert.equal(subscriberCountText(1250000), '1,2 млн', 'Russian writes its decimal with a comma')
  setLanguage('ko')
})

test('a count below a thousand is spelled out with the word', () => {
  setLanguage('en')
  assert.equal(subscriberCountText(1), '1 subscriber')
  assert.equal(subscriberCountText(999), '999 subscribers')
  setLanguage('ko')
  assert.equal(subscriberCountText(999), '구독자 999명')
})

// Telegram groups the digits of an exact count: its plural formatter calls formatNumberWithGroupingSeparator
// (build-system/GenerateStrings/GenerateStrings.py:504).
test('an exact count groups its digits', () => {
  setLanguage('en')
  assert.equal(subscriberCountFull(12000), '12,000 subscribers')
  assert.equal(subscriberCountFull(1250000), '1,250,000 subscribers')
  setLanguage('ko')
  assert.equal(subscriberCountFull(12000), '구독자 12,000명')
  setLanguage('ru')
  assert.equal(subscriberCountFull(12000), `${(12000).toLocaleString('ru-RU')} подписчиков`)
  setLanguage('ko')
})
