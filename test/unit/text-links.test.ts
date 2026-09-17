import assert from 'node:assert/strict'
import { test } from 'node:test'
import { channelShareCard, classifyLink, findTextLinks, linkTarget, suspiciousLink } from '../../src/shared/text-links'

// Links are found as Telegram Desktop's ParseEntities finds url and email entities.
const texts = (text: string): string[] => findTextLinks(text).map(link => link.text)

test('web addresses with and without a protocol are links, and trailing punctuation stays outside', () => {
  assert.deepEqual(texts('see https://example.com/a?b=1, ok'), ['https://example.com/a?b=1'])
  assert.deepEqual(texts('go to www.naver.com.'), ['www.naver.com'])
  assert.deepEqual(texts('google.com/search?q=morse!'), ['google.com/search?q=morse'])
  assert.deepEqual(texts('(https://en.wikipedia.org/wiki/Morse_(code))'), ['https://en.wikipedia.org/wiki/Morse_(code)'])
  assert.deepEqual(texts('주소는 example.co.kr 입니다'), ['example.co.kr'])
})

test('a name with an unknown top domain, a bad protocol or a word joined in front is not a link', () => {
  assert.deepEqual(texts('file.txt and report.docx'), [])
  assert.deepEqual(texts('javascript://example.com'), [])
  assert.deepEqual(texts('key=example.com'), [])
  assert.deepEqual(texts('abc_example.com'), ['abc_example.com'], 'an underscore is part of a domain label')
  assert.deepEqual(texts('example.com.hello'), [], 'the domain has to end before a path')
})

test('an email address is one entity and opens a mail window', () => {
  const [link] = findTextLinks('write to help.desk@morse.com please')
  assert.equal(link?.kind, 'email')
  assert.equal(link?.text, 'help.desk@morse.com')
  assert.equal(linkTarget(link!), 'mailto:help.desk@morse.com')
  assert.equal(linkTarget(findTextLinks('naver.com')[0]!), 'https://naver.com')
})

test('an emoji right after a link ends it', () => {
  assert.deepEqual(texts('https://example.com/path😀 next'), ['https://example.com/path'])
})

test('a domain with non-Latin letters is suspicious and asks first', () => {
  assert.equal(suspiciousLink('https://example.com/путь'), false)
  assert.equal(suspiciousLink('https://аpple.com'), true)
  assert.equal(suspiciousLink('https://apple.com'), false)
})

test('Morse web addresses open inside the app like the iOS router', () => {
  assert.deepEqual(classifyLink('https://talky-a38c3.web.app/i/abcdefgh12345678'), { kind: 'invite', url: 'https://talky-a38c3.web.app/i/abcdefgh12345678' })
  assert.deepEqual(classifyLink('https://talky-a38c3.web.app/channel/ch1/post/p1'), { kind: 'channel', url: 'https://talky-a38c3.web.app/channel/ch1/post/p1', channelId: 'ch1' })
  assert.equal(classifyLink('https://talky-a38c3.web.app/u/abcd2345').kind, 'external')
  assert.equal(classifyLink('https://example.com/channel/ch1').kind, 'external')
})

test('a channel share becomes a card that keeps only the words before the address', () => {
  const card = channelShareCard('📢 [모스 소식] 채널을 공유했어요\nhttps://talky-a38c3.web.app/channel/abc123')
  assert.deepEqual(card, { channelId: 'abc123', channelName: '모스 소식', url: 'https://talky-a38c3.web.app/channel/abc123', bodyText: '📢 [모스 소식] 채널을 공유했어요' })
  assert.equal(channelShareCard('[모스 소식] https://talky-a38c3.web.app/channel/abc123'), null)
})
