import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PresenceHold } from '../../src/main/accounts/presence-hold'
import { peerPresence, presenceText } from '../../src/shared/presence'
import { AccountPresence } from '../../src/main/accounts/presence'

// The copy the server keeps for this viewer has no expiry when it says «online», so a person just put on screen is
// shown only once resolvePeerPresences has answered; any other copy is shown at once.
const online = peerPresence({ s: 'online' })
const present = peerPresence({ s: 'present', t: 1_750_000_000 })

test('a copy that says online waits for the server, and every other copy is shown at once', () => {
  const hold = new PresenceHold()
  hold.start('peer1')
  assert.equal(hold.receive('peer1', online), null, 'an old copy must not say online')
  assert.deepEqual(hold.receive('peer1', present), present, 'a copy with its own time is shown')
  assert.deepEqual(hold.receive('peer1', online), online, 'once shown, later online is live')
  hold.start('peer2')
  assert.deepEqual(hold.answered('peer2', online), online)
  assert.deepEqual(hold.receive('peer2', online), online, 'the server answered, so this person is no longer held')
})

test('an answer that never comes releases the copy instead of hiding the person', () => {
  const hold = new PresenceHold()
  hold.start('peer1')
  assert.equal(hold.receive('peer1', online), null)
  assert.deepEqual(hold.settled('peer1'), online, 'the call settled, so what was held is shown')
  assert.equal(hold.settled('peer1'), null, 'nothing is held twice')
  hold.start('peer2')
  assert.equal(hold.settled('peer2'), null, 'no copy arrived, so there is nothing to show')
  hold.start('peer3')
  assert.equal(hold.receive('peer3', online), null)
  hold.forget('peer3')
  assert.deepEqual(hold.receive('peer3', online), online, 'a person taken off screen starts over')
  assert.equal(presenceText(online)?.online, true)
  hold.clear()
})

// presence/{uid} is one place for the whole account: another device signing off writes it offline while this window is
// still here, so this window watches its own place and writes itself online again (Telegram keeps an account online
// while any of its sessions says so).
test('a window that should be online writes itself back when another device signs the account off', () => {
  const credentials = { signal: new AbortController().signal } as unknown as Parameters<typeof AccountPresence>[1]
  const presence = new AccountPresence('me1', credentials, () => {})
  const state = presence as unknown as { closed: boolean; connected: boolean; online: boolean; reassert(value: unknown): boolean }
  state.connected = true; state.online = true
  assert.equal(state.reassert(false), true, 'the account reads offline while this window is here')
  assert.equal(state.reassert(null), true, 'a place cleared by another device is the same case')
  assert.equal(state.reassert(true), false, 'two windows online write nothing')
  state.online = false
  assert.equal(state.reassert(false), false, 'a window that should be offline never writes itself back')
  state.online = true; state.connected = false
  assert.equal(state.reassert(false), false, 'a window without a connection writes nothing')
  state.connected = true; state.closed = true
  assert.equal(state.reassert(false), false)
})

// The server's Telegram buckets: beyond a month is «a long time ago», not an empty subtitle.
test('a last seen beyond a month reads as a long time ago', () => {
  assert.deepEqual(peerPresence({ s: 'longTimeAgo' }), { s: 'longTimeAgo' })
  assert.deepEqual(presenceText(peerPresence({ s: 'longTimeAgo' })), { text: '오래 전', online: false })
  assert.deepEqual(presenceText(peerPresence({ s: 'lastMonth' })), { text: '한 달 이내', online: false })
  assert.equal(presenceText(peerPresence({ s: 'someday' })), null, 'an unknown code still shows nothing')
})

// MorsePeerPresenceStore (iOS 99981c96): a person no longer watched keeps a last seen with its moment, which goes on
// ageing, but not an «online» that nothing refreshes any more.
test('an online nobody watches any more is forgotten, a last seen is kept', () => {
  const credentials = { signal: new AbortController().signal } as unknown as ConstructorParameters<typeof AccountPresence>[1]
  let changes = 0
  const presence = new AccountPresence('me1', credentials, () => { changes++ })
  const state = presence as unknown as { watched: Map<string, () => void>; values: Map<string, unknown>; surfaces: Map<string, string[]>; reconcile(): void }
  let stopped = 0
  state.watched.set('peer1', () => { stopped++ }); state.values.set('peer1', online)
  state.watched.set('peer2', () => { stopped++ }); state.values.set('peer2', present)
  state.surfaces.set('dialogs', [])
  state.reconcile()
  assert.equal(stopped, 2, 'both watches end')
  assert.deepEqual(presence.snapshot(), { peer2: present }, 'the online copy goes, the last seen stays')
  assert.equal(changes, 1, 'the window is told once')
})
