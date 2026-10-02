import assert from 'node:assert/strict'
import { test } from 'node:test'
import { locale } from '../../src/shared/i18n'
import { messageCopyText, selectedMessagesText } from '../../src/shared/message-copy'

// B53 (Telegram R-65): several chosen bubbles copy as one text.
const at = (seconds: number, id: string) => ({ seconds, nanoseconds: 0, id })
const message = (id: string, seconds: number, name: string, extra: Record<string, unknown> = {}) =>
  ({ id, kind: 'text' as const, text: `${id} 글`, encrypted: false, system: false, position: at(seconds, id), name, ...extra })
const when = (seconds: number) => new Intl.DateTimeFormat(locale(), { dateStyle: 'short', timeStyle: 'short' }).format(new Date(seconds * 1000))

test('several messages: chat order, one line each with date, time and name', () => {
  const chosen = [message('b', 200, '민지'), message('a', 100, '나')]
  assert.equal(selectedMessagesText(chosen, item => item.name), `[${when(100)}] 나: a 글\n[${when(200)}] 민지: b 글`)
})

test('one message is its words alone, and what has no words gives its kind and caption', () => {
  assert.equal(selectedMessagesText([message('a', 100, '나')], item => item.name), 'a 글')
  assert.equal(messageCopyText({ ...message('p', 1, ''), kind: 'image', text: '', caption: ' 바다 ' }), '[ 사진 ]\n바다')
  assert.equal(messageCopyText({ ...message('v', 1, ''), kind: 'voice', text: '' }), '[ 음성 메시지 ]')
})

test('what «텍스트 복사» leaves out is left out: encrypted and system messages', () => {
  const chosen = [message('a', 100, '나'), message('s', 150, '', { system: true }), message('e', 160, '민지', { encrypted: true })]
  assert.equal(selectedMessagesText(chosen, item => item.name), 'a 글', 'only one is left, so its words alone')
  assert.equal(selectedMessagesText([message('e', 1, '', { encrypted: true })], item => item.name), '', 'nothing to copy')
})
