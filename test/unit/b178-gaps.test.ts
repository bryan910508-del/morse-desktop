import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PeerRowName, officialOf } from '../../src/renderer/src/ui/official-mark'
import { peopleSurfaces } from '../../src/main/accounts/contacts'

// B178 (10-07, three gaps found after the contract's lines): a non-contact's profile, a channel's subscribers and the
// chat folder's «채팅 추가» list now draw the mark as every other row of people does.
const row = (official: 'support' | 'system' | null) => renderToStaticMarkup(createElement(PeerRowName, { name: 'Morse', official }))

test('a row of people shows the mark when the person is official, and its kind is said', () => {
  assert.match(row('support'), /aria-label="공식 고객센터"/, 'the support account')
  assert.match(row('system'), /aria-label="공식 계정"/, 'the notice account')
  assert.doesNotMatch(row(null), /<svg/, 'anyone else: no mark')
})

test('a profile takes the contacts list\'s word for a contact, and the mark read for the profile otherwise', () => {
  assert.equal(officialOf('support', {}, 'u1'), 'support', 'a contact: the list says so')
  assert.equal(officialOf(null, { u1: 'system' }, 'u1'), 'system', 'not a contact (a group member opened from the list): read for the profile')
  assert.equal(officialOf(undefined, { u2: 'support' }, 'u1'), null, 'another person\'s mark is not this one\'s')
})

test('the profile and a channel\'s subscribers read their marks apart from the search and a group\'s members', () => {
  assert.deepEqual([...peopleSurfaces].sort(), ['blocked', 'lookup', 'members', 'profile', 'subscribers'],
    'a profile opened from the search results does not clear them when it closes; nor do subscribers clear a group\'s members')
})
