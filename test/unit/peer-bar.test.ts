import assert from 'node:assert/strict'
import { test } from 'node:test'
import { peerBarShown, peerBarWorthAsking, type PeerBarFacts } from '../../src/shared/peer-bar'

// B52 (Telegram R-64): the «차단 · 연락처 추가 · ×» bar over a 1:1 a stranger opened.
const base: PeerBarFacts = { accountUid: 'me', chatId: 'c1', kind: 'direct', createdBy: 'peer', peerUid: 'peer', contact: false, blocked: false, hidden: false }

test('a 1:1 the stranger opened shows the bar', () => {
  assert.equal(peerBarShown(base), true)
})

test('it does not show for a contact, a blocked or withdrawn person, a closed bar, a room I opened or an old room', () => {
  for (const [why, change] of Object.entries<Partial<PeerBarFacts>>({
    contact: { contact: true }, blocked: { blocked: true }, withdrawn: { peerDeleted: true }, closed: { hidden: true },
    'I opened it': { createdBy: 'me' }, 'made before createdBy': { createdBy: undefined }, group: { kind: 'group' }, secret: { kind: 'secret' },
    memo: { chatId: 'memo_me' }
  })) assert.equal(peerBarShown({ ...base, ...change }), false, why)
})

test('while something is not known yet it waits, and the setting is read only when it would matter', () => {
  assert.equal(peerBarShown({ ...base, contact: null }), false)
  assert.equal(peerBarShown({ ...base, blocked: null }), false)
  assert.equal(peerBarShown({ ...base, hidden: null }), false)
  assert.equal(peerBarWorthAsking({ ...base, hidden: null }), true)
  assert.equal(peerBarWorthAsking({ ...base, hidden: null, contact: true }), false)
})
