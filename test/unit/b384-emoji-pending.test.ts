import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import './b384-dom-stub'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MessageView, type MessageLayout } from '../../src/renderer/src/history/message'
import { localChatMessage } from '../../src/renderer/src/history/local-media'
import type { LocalOutgoing } from '../../src/shared/delivery'

// B384 (user, review 10-14 14:4x): a message of emoji alone was drawn in a bubble while on its way and large with no bubble
// once the server's copy came — the row on its way never asked (message.tsx LocalMessageView drew bubble-text). tdesktop
// decides it from the text for a local message too (Element::refreshMedia, history_view_element.cpp:1755-1758).
const layout: MessageLayout = { date: false, unread: false, top: false, bottom: false, name: false, photo: false, gutter: false, roomOnly: false }
const going = (text: string): LocalOutgoing => ({ id: 'l1', chatId: 'c1', sequence: 1, text, createdAt: 1790121600000, state: 'queued' } as LocalOutgoing)
// B409: the row on its way is MessageView with its outgoing state (LocalMessageView is gone).
const none = (): void => {}
const draw = (item: LocalOutgoing) => renderToStaticMarkup(createElement(MessageView, { accountUid: 'me', chatId: 'c1', message: localChatMessage(item, 'me'), own: true, layout, read: 'sent',
  selecting: false, selected: false, highlighted: false, autoTranslate: false, onMenu: none, onReply: none, onJumpReply: none, onOpenMedia: none, onToggle: none, onReaction: none,
  outgoing: { item, onMenu: none } }))

test('a message of emoji alone is large with no bubble while it goes, at the size the server copy takes', () => {
  const one = draw(going('😀'))
  assert.match(one, /class="bubble emoji-only"/)
  assert.match(one, /<div class="bubble-emoji selectable" style="font-size:94px">😀<\/div>/)
  assert.doesNotMatch(one, /bubble-text/)
  assert.match(draw(going('😀😀😀')), /font-size:64px/, 'the same tiers as the confirmed row (94 × .69)')
})

test('words keep their bubble while they go', () => {
  for (const text of ['안녕 😀', 'ok', '1']) {
    const html = draw(going(text))
    assert.match(html, /bubble-text/); assert.doesNotMatch(html, /emoji-only/)
  }
})

test('the row on its way and the server\'s row take the one test and the one drawing', () => {
  const source = readFileSync('src/renderer/src/history/message.tsx', 'utf8')
  assert.equal((source.match(/emojiOnlyText\(/g) ?? []).length, 1, 'one test, in emojiOnlyBody')
  assert.match(source, /const emojiBody = plainText && !memo \? emojiOnlyBody\(message\.text\) : null, emojiOnly = emojiBody !== null/)
  assert.doesNotMatch(source, /LocalMessageView/, 'B409: one view draws both rows')
})
