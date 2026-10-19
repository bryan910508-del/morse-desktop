import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { presenceAfterMessage, presenceFromCopy } from '../../src/shared/presence'
import { incomingMessage } from '../../src/main/network/contracts'

// B467 (user 10-17 01:1x: a person had just sent a message and still read «어제 오후 8:50 접속»): a message that arrives
// live is its sender's activity at its time — TI updatePeerPresenceLastActivities (UpdatePeers.swift:491-512), tdesktop
// UserData::madeAction (data_user.cpp:548-561). The three apps' rule: only a moment older than the message moves.
const at = Date.UTC(2026, 9, 17, 0, 59, 30)
const seconds = Math.floor(at / 1000)

test('a moment older than the message moves to its time; a newer one, online, hidden and the rough ones stay', () => {
  assert.deepEqual(presenceAfterMessage({ s: 'present', t: seconds - 4 * 3600 }, at), { s: 'present', t: seconds })
  assert.equal(presenceAfterMessage({ s: 'present', t: seconds }, at), null, 'already that moment')
  assert.equal(presenceAfterMessage({ s: 'present', t: seconds + 5 }, at), null, 'never back')
  for (const s of ['online', 'hidden', 'lastWeek', 'lastMonth', 'longTimeAgo', 'none'] as const) assert.equal(presenceAfterMessage({ s }, at), null, s)
  assert.equal(presenceAfterMessage(undefined, at), null, 'nothing read yet: nothing made up')
})

test('a server copy after it: two moments keep the later; any other status is the copy\'s', () => {
  const moved = { s: 'present' as const, t: seconds }
  assert.deepEqual(presenceFromCopy(moved, { s: 'present', t: seconds - 600 }), moved, 'an older copy does not take it back')
  assert.deepEqual(presenceFromCopy(moved, { s: 'present', t: seconds + 60 }), { s: 'present', t: seconds + 60 })
  assert.deepEqual(presenceFromCopy(moved, { s: 'online' }), { s: 'online' })
  assert.deepEqual(presenceFromCopy(moved, { s: 'hidden' }), { s: 'hidden' }, 'a privacy change is the server\'s')
  assert.deepEqual(presenceFromCopy(undefined, { s: 'lastWeek' }), { s: 'lastWeek' })
})

test('only a person\'s live socket message counts — not a service line, a channel\'s post copy or a scheduled send', () => {
  const body = { id: 'm1', chatId: 'c1', senderId: 'peer', type: 'text', text: 'hi', createdAt: at }
  assert.equal(incomingMessage(body).wasScheduled, undefined)
  assert.equal(incomingMessage({ ...body, wasScheduled: true }).wasScheduled, true, 'server B467b wasScheduled')
  const controller = readFileSync('src/main/auth/controller.ts', 'utf8')
  assert.match(controller, /message\.senderId !== record\.profile\.uid\) \{[^]*?if \(!message\.system && message\.kind !== 'channelPost' && !message\.wasScheduled\) this\.accounts\.peerMessage\?\.\(record\.profile\.uid, message\.senderId, positionMilliseconds\(message\.position\)\)/)
  const presence = readFileSync('src/main/accounts/presence.ts', 'utf8')
  assert.match(presence, /messageSeen\(peerUid: string, at: number\): void \{\s*if \(this\.closed \|\| !this\.watched\.has\(peerUid\)\) return/, 'only people on screen')
  assert.equal((presence.match(/this\.values\.set\(/g) ?? []).length, 2, 'every copy goes through remember(), and messageSeen')
})
