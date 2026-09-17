import test from 'node:test'
import assert from 'node:assert/strict'
import { directChatId } from '../../src/main/messaging/direct-chat-id'

// The same vectors hold for the Railway server (morse-message-authority.js directChatId) and iOS
// (MorseDirectChatIdentity): the three must name one pair's dialog alike.
test('a pair has one id, whoever computes it', () => {
  assert.equal(directChatId('aVvAXLwnUlPnL86LBgKps7gDoee2', 'JvKUhd12RL8arvEUaN72'), 'direct_cf045eb1bdab124869de0d25ddec13d9')
  assert.equal(directChatId('JvKUhd12RL8arvEUaN72', 'aVvAXLwnUlPnL86LBgKps7gDoee2'), 'direct_cf045eb1bdab124869de0d25ddec13d9')
})
test('order is byte order, not alphabetical: - before _, upper case before lower case', () => {
  assert.equal(directChatId('user_a', 'user-b'), 'direct_0d3043c41341f493f928c8f4e7e66b54')
  assert.equal(directChatId('A', 'a'), 'direct_a409c621f70e8b9b892443f2f38bd7ab')
  assert.equal(directChatId('abc', 'abcd'), 'direct_67f7a67d4ce78479004bcc3804a4be94')
})
