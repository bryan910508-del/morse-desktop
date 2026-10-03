import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chatGone } from '../../src/renderer/src/window/chat-gone'
import { swipeAllowed } from '../../src/renderer/src/history/swipe-gesture'

// B76 (Telegram ChatData::setFlags, data_chat.cpp:136-146): the chat on screen closes once this account is no longer in
// it — the group was deleted or this account removed — and only then.
const ready = { listReady: true, present: false, pending: false }

test('a chat that was on screen and left this account closes', () => {
  assert.equal(chatGone(true, ready), true)
})

test('nothing closes before the chat was ever there, while the list is not ready, or for a 1:1 not created yet', () => {
  assert.equal(chatGone(false, ready), false, 'opened before the list knew it: wait for it')
  assert.equal(chatGone(true, { ...ready, listReady: false }), false, 'reloading, reconnecting or behind the passcode lock: the list is empty, not the chat gone')
  assert.equal(chatGone(true, { ...ready, pending: true }), false, 'a 1:1 waiting for its first message')
  assert.equal(chatGone(true, { ...ready, present: true }), false, 'still a row, or open unlisted (deleted here, or emptied for everyone)')
})

test('a swipe back works without a room; a reply needs one', () => {
  assert.equal(swipeAllowed('back', false), true, 'a gone chat or a 1:1 not created yet still closes with a swipe')
  assert.equal(swipeAllowed('back', true), true)
  assert.equal(swipeAllowed('reply', false), false)
  assert.equal(swipeAllowed('reply', true), true)
})
