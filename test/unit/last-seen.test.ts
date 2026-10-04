import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setLanguage } from '../../src/shared/i18n'
import { presenceChangeIn, presenceText, type PeerPresence } from '../../src/shared/presence'

// B111 (user report, rule «텔레그램 구조»): the three apps' words (contracts/B111 §3) on tdesktop's rules —
// OnlineText for a list and a title (data_peer_values.cpp:470-498: just now, N minutes, N hours within 12, today,
// yesterday, a date) and OnlineTextFull for a profile (:507-527: today, yesterday, a date with its time). A hidden last
// seen is «recently» (:85-86). English and Russian read «last seen …» / «был(а) …»; «just now» is not «recently».

const now = new Date(2026, 9, 4, 18, 0, 0).getTime()
const ago = (seconds: number): PeerPresence => ({ s: 'present', t: Math.floor(now / 1000) - seconds })
const text = (presence: PeerPresence, full = false) => presenceText(presence, now, full)?.text
const date = (seconds: number) => new Intl.DateTimeFormat('ko-KR', { dateStyle: 'short' }).format(now - seconds * 1000)
const time = (seconds: number) => new Intl.DateTimeFormat('ko-KR', { timeStyle: 'short' }).format(now - seconds * 1000)

test('B111: a list reads just now, minutes, hours within twelve, then today and yesterday', () => {
  setLanguage('ko')
  assert.equal(text(ago(20)), '방금 접속함')
  assert.equal(text(ago(5 * 60)), '5분 전 접속')
  assert.equal(text(ago(3 * 3600)), '3시간 전 접속')
  assert.equal(text(ago(13 * 3600)), `오늘 ${time(13 * 3600)} 접속`, 'beyond twelve hours, still today')
  assert.equal(text(ago(20 * 3600)), `어제 ${time(20 * 3600)} 접속`)
  assert.equal(text(ago(3 * 86400)), `${date(3 * 86400)} 접속`, 'a date alone')
})

test('B111: a profile reads today or yesterday at a time, and a date with its time — no minutes or hours ago', () => {
  setLanguage('ko')
  assert.equal(text(ago(5 * 60), true), `오늘 ${time(5 * 60)} 접속`)
  assert.equal(text(ago(3 * 86400), true), `${date(3 * 86400)} ${time(3 * 86400)} 접속`, 'the date and the time')
})

test('B111: hidden is «recently», the server\'s buckets keep their words', () => {
  setLanguage('ko')
  assert.equal(text({ s: 'hidden' }), '최근에 접속함')
  assert.equal(text({ s: 'lastWeek' }), '일주일 이내 접속')
  assert.equal(text({ s: 'longTimeAgo' }), '오래 전에 접속함')
})

test('B111: English and Russian say «last seen» / «был(а)», with Russian plural forms', () => {
  setLanguage('en')
  assert.equal(text(ago(20)), 'last seen just now')
  assert.equal(text(ago(60)), 'last seen 1 minute ago')
  assert.equal(text(ago(3 * 3600)), 'last seen 3 hours ago')
  assert.equal(text({ s: 'hidden' }), 'last seen recently')
  setLanguage('ru')
  assert.equal(text(ago(20)), 'был(а) только что')
  assert.notEqual(text(ago(20)), text({ s: 'hidden' }), '«just now» is not «recently»')
  assert.equal(text(ago(60)), 'был(а) 1 минуту назад')
  assert.equal(text(ago(3 * 60)), 'был(а) 3 минуты назад')
  assert.equal(text(ago(5 * 60)), 'был(а) 5 минут назад')
  assert.equal(text(ago(1 * 3600)), 'был(а) 1 час назад')
  assert.equal(text(ago(2 * 3600)), 'был(а) 2 часа назад')
  assert.equal(text(ago(11 * 3600)), 'был(а) 11 часов назад')
  assert.equal(text({ s: 'online' }), 'в сети')
  setLanguage('ko')
})

test('B111: the line is redrawn each minute within the hour and each hour within twelve', () => {
  assert.equal(presenceChangeIn(ago(30), now), 31_000)
  assert.equal(presenceChangeIn(ago(2 * 3600 + 10), now), (3600 - 10 + 1) * 1000)
  assert.equal(presenceChangeIn({ s: 'hidden' }, now), null)
})
