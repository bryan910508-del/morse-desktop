import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decodePeerProfile, PeerProfiles, registerPeerProfiles } from '../../src/main/accounts/peer-profiles'
import { DirectAvatar } from '../../src/main/accounts/direct-avatar'
import { pathFor } from '../../src/main/accounts/profile-photo'
import type { FirestoreReader, WatchEvents } from '../../src/main/network/firestore-rpc'
import { documents, type FirestoreDocument } from '../../src/main/network/firestore-values'
import { photoVisible } from '../../src/shared/profile-photo'

// B153 (contracts/B153-official-profile-photo.md §4–§5): one question for every picture of someone else —
// not gone ∧ (privacy.photo = everyone ∨ (privacy.photo ∉ {everyone, nobody} ∧ mutual contacts)).
test('the picture rule, over every privacy value, both contact states and a gone account', () => {
  const expected: Record<string, [boolean, boolean]> = {
    everyone: [true, true], contacts: [true, false], nobody: [false, false], '': [true, false], friends: [true, false]
  }
  for (const [privacy, [whenMutual, whenNot]] of Object.entries(expected)) {
    assert.equal(photoVisible({ deleted: false, privacy, mutual: true }), whenMutual, `${privacy || 'none'} mutual`)
    assert.equal(photoVisible({ deleted: false, privacy, mutual: false }), whenNot, `${privacy || 'none'} not mutual`)
    for (const mutual of [true, false]) assert.equal(photoVisible({ deleted: true, privacy, mutual }), false, `${privacy || 'none'} gone`)
  }
})

const profile = (fields: Record<string, unknown>): FirestoreDocument => ({ name: `${documents}/publicProfiles/u1`, fields } as unknown as FirestoreDocument)
const official = (photo: string, extra: Record<string, unknown> = {}) => profile({ displayName: { stringValue: 'Morse' }, photoURL: { stringValue: 'gs://morse' },
  official: { stringValue: 'support' }, ...(photo ? { privacy: { mapValue: { fields: { photo: { stringValue: photo } } } } } : {}), ...extra })

test('the list, the chat header and every avatar show an official account\'s picture to someone who is not its contact', () => {
  assert.deepEqual(decodePeerProfile(official('everyone'), false), { name: 'Morse', photo: 'gs://morse', mutual: false, official: 'support', photoEveryone: 'gs://morse' })
  assert.equal(decodePeerProfile(official(''), false)?.photo, '', 'no rule written: the mutual-contacts rule, as before')
  assert.equal(decodePeerProfile(official('nobody'), true)?.photo, '', 'nobody: hidden even from a mutual contact')
  assert.equal(decodePeerProfile(official('everyone', { accountDeleted: { booleanValue: true } }), false), null, 'a gone account shows nothing')
  assert.equal(decodePeerProfile(official('Everyone'), false)?.photo, '', 'only the exact value opens it')
})

// B180: a 1:1 with someone not on the contact list (the official notice account, the support account) has a picture too —
// only what that person shows to everyone. «They put me on their list» alone is not mutual, so it opens nothing.
test('B180: someone not on the contact list shows only an «everyone» picture; a contact keeps their rule', () => {
  const watches: { paths: string[]; events: WatchEvents }[] = []
  const reader = { watch(target: { documents: { documents: string[] } }, _signal: AbortSignal, events: WatchEvents) { watches.push({ paths: target.documents.documents, events }); return () => {} } } as unknown as FirestoreReader
  const auth = { signal: new AbortController().signal }
  const peers = new PeerProfiles('me', auth, auth.signal, () => {})
  const uids = ['everyone', 'contacts', 'nobody', 'none', 'gone']
  peers.bind(reader, uids)
  const person = (uid: string, privacy: string, extra: Record<string, unknown> = {}): [string, FirestoreDocument] => [`${documents}/publicProfiles/${uid}`,
    { name: `${documents}/publicProfiles/${uid}`, fields: { displayName: { stringValue: uid }, photoURL: { stringValue: `gs://${uid}` },
      ...(privacy ? { privacy: { mapValue: { fields: { photo: { stringValue: privacy } } } } } : {}), ...extra } } as unknown as FirestoreDocument]
  // Each of them has put this account on their own list (the reciprocal document exists).
  const reciprocal = (uid: string): [string, FirestoreDocument] => [`${documents}/users/${uid}/contacts/me`, { name: `${documents}/users/${uid}/contacts/me`, fields: {} } as unknown as FirestoreDocument]
  const rows = new Map([person('everyone', 'everyone'), person('contacts', 'contacts'), person('nobody', 'nobody'), person('none', ''),
    person('gone', 'everyone', { accountDeleted: { booleanValue: true } }), ...uids.map(reciprocal)])
  for (const watch of watches) watch.events.snapshot(new Map([...rows].filter(([name]) => watch.paths.includes(name))))
  const expect: Record<string, [string, string]> = { everyone: ['gs://everyone', 'gs://everyone'], contacts: ['gs://contacts', ''], nobody: ['', ''], none: ['gs://none', ''], gone: ['', ''] }
  for (const [uid, [asContact, asStranger]] of Object.entries(expect)) {
    assert.equal(peers.photoFor(uid, true), asContact, `${uid} on the contact list`)
    assert.equal(peers.photoFor(uid, false), asStranger, `${uid} not on it`)
  }
  peers.close()
})

test('B180: the official account\'s address, as the server tool writes it, is read as its own profile photo', () => {
  const written = 'https://firebasestorage.googleapis.com/v0/b/talky-a38c3.firebasestorage.app/o/profile_photos%2Fmorse-system%2F90d11bb89da1e9c0.jpg?alt=media&token=t0k3n'
  assert.equal(pathFor(written, 'morse-system'), 'profile_photos/morse-system/90d11bb89da1e9c0.jpg')
  assert.equal(pathFor(written, 'someone-else'), null, 'another person\'s folder is not this person\'s picture')
  assert.equal(pathFor('profile_photos/morse-system/90d11bb89da1e9c0.jpg', 'morse-system'), null, 'a bare path is not an address')
})

test('B180 / B178 ①: a new chat with the support account, not a contact, reads its official mark from the profile', () => {
  let watch: WatchEvents | null = null
  const reader = { watch(_target: unknown, _signal: AbortSignal, events: WatchEvents) { watch = events; return () => {} } } as unknown as FirestoreReader
  const auth = { signal: new AbortController().signal } as never
  const peers = new PeerProfiles('me', auth, (auth as { signal: AbortSignal }).signal, () => {})
  registerPeerProfiles(auth, peers)
  peers.bind(reader, ['support'])
  watch!.snapshot(new Map([[`${documents}/publicProfiles/support`, { name: `${documents}/publicProfiles/support`,
    fields: { displayName: { stringValue: 'Morse 고객센터' }, official: { stringValue: 'support' } } } as unknown as FirestoreDocument]]))
  const binding = { uid: 'support', reader, personalURL: null, contact: false }
  const avatar = new DirectAvatar(binding, auth, () => binding, async () => new Response(null), () => {})
  assert.equal(avatar.profileOfficial, 'support')
  assert.equal(avatar.profileName, 'Morse 고객센터')
  avatar.close(); peers.close()
})
