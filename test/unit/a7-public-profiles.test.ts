import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ContactsSession } from '../../src/main/accounts/contacts'
import { decodePeerProfile, publicProfilePath } from '../../src/main/accounts/peer-profiles'
import { documents, type FirestoreDocument } from '../../src/main/network/firestore-values'
import type { FirestoreReader, WatchEvents } from '../../src/main/network/firestore-rpc'

// A7 §3-1 / §4 Desktop: others are read from the public profile the server makes (publicProfiles/{uid}), never from
// their account document. A profile that cannot be read leaves the contact usable under the name it was saved with.
const me = 'me1'
const doc = (name: string, fields: Record<string, unknown>): FirestoreDocument =>
  ({ name, updateTime: { seconds: '1', nanos: 0 }, createTime: { seconds: '1', nanos: 0 }, fields } as unknown as FirestoreDocument)
const text = (value: string) => ({ stringValue: value })
const publicProfile = (uid: string, fields: Record<string, unknown>): FirestoreDocument => doc(publicProfilePath(uid), fields)
const reciprocal = (uid: string): FirestoreDocument => doc(`${documents}/users/${uid}/contacts/${me}`, {})
const rows = (...docs: FirestoreDocument[]): Map<string, FirestoreDocument> => new Map(docs.map(item => [item.name, item]))

test('a public profile is read as the account document was: name, picture, and nothing once the account is gone', () => {
  assert.equal(publicProfilePath('u1'), `${documents}/publicProfiles/u1`)
  const full = publicProfile('u1', { userId: text('minji'), displayName: text(' 민지 '), photoURL: text('gs://p'), bio: text('안녕'), publicKey: text('k'),
    personalChannelId: text('c1'), accountDeleted: { booleanValue: false }, updatedAt: { timestampValue: '2026-10-01T00:00:00Z' } })
  assert.deepEqual(decodePeerProfile(full, true), { name: '민지', photo: 'gs://p', mutual: true, official: null, photoEveryone: '' })
  assert.equal(decodePeerProfile(publicProfile('u1', { accountDeleted: { booleanValue: true }, updatedAt: { timestampValue: '2026-10-01T00:00:00Z' } }), true), null,
    'a withdrawn account keeps only accountDeleted')
  assert.equal(decodePeerProfile(undefined, true), null, 'not made yet: unknown')
})

function session() {
  const targets: { paths: string[]; events: WatchEvents; stopped: boolean }[] = []
  const reader = {
    watch(target: { documents?: { documents: string[] }; query?: { parent: string } }, _signal: AbortSignal, events: WatchEvents) {
      const entry = { paths: target.documents?.documents ?? [`query:${target.query?.parent}`], events, stopped: false }
      targets.push(entry)
      return () => { entry.stopped = true }
    },
    close() {}
  } as unknown as FirestoreReader
  const auth = { signal: new AbortController().signal, authorize: async () => ({ idToken: 'id', appCheckToken: 'check', expiresAt: Date.now() + 60000 }) }
  const store = async <T,>(command: { kind: string }): Promise<T> =>
    (command.kind === 'contact-details' ? { nickname: '', note: '', version: '' } : []) as T
  const contacts = new ContactsSession(me, auth, () => {}, store as never, () => {}, () => reader)
  contacts.connection(true)
  const list = targets.find(target => target.paths[0] === `query:${documents}/users/${me}`)!
  list.events.snapshot(rows(doc(`${documents}/users/${me}/contacts/u1`, { displayName: text('민지(저장한 이름)') })))
  const profile = (requestId: string) => {
    contacts.open('u1', requestId)
    return targets.at(-1)!
  }
  return { contacts, targets, profile }
}

test('the profile pane reads the public profile, and the contact copy stands in when there is none to read', () => {
  const { contacts, targets, profile } = session()
  assert.ok(targets.some(target => target.paths.includes(publicProfilePath('u1'))), 'the list reads the public profile')
  assert.ok(!targets.some(target => target.paths.includes(`${documents}/users/u1`)), 'never the account document')

  const pane = profile('r1')
  assert.deepEqual(pane.paths, [publicProfilePath('u1'), `${documents}/users/u1/contacts/${me}`])
  pane.events.snapshot(rows(publicProfile('u1', { userId: text('minji'), displayName: text('민지'), bio: text('안녕'), personalChannelId: text('c1') }), reciprocal('u1')))
  let value = contacts.snapshot.profile!
  assert.equal(value.status, 'ready')
  assert.equal(value.visibility, 'visible')
  assert.deepEqual([value.displayName, value.userId, value.bio, value.personalChannelId], ['민지', 'minji', '안녕', 'c1'])

  // Not made yet (A7 §3-1: no document is «not yet», not «gone»): the contact opens under its saved name.
  pane.events.snapshot(rows(reciprocal('u1')))
  value = contacts.snapshot.profile!
  assert.equal(value.status, 'ready')
  assert.equal(value.visibility, 'unknown', 'nothing the profile would show is guessed')
  assert.equal(value.displayName, '민지(저장한 이름)')
  assert.equal(value.userId, '')
  assert.deepEqual(contacts.directPeer('r1'), { uid: 'u1', displayName: '민지(저장한 이름)' })

  // A withdrawn account is still told apart.
  pane.events.snapshot(rows(publicProfile('u1', { accountDeleted: { booleanValue: true } })))
  assert.equal(contacts.snapshot.profile!.status, 'unavailable')
})

test('a refused profile read leaves the contact usable under its saved name', () => {
  const { contacts, profile } = session()
  const pane = profile('r2')
  pane.events.state('error', { code: 'permission' } as never)
  const value = contacts.snapshot.profile!
  assert.equal(value.status, 'ready', 'the renderer gates (withContactProfile, ContactProfile) see a usable profile')
  assert.equal(value.displayName, '민지(저장한 이름)')
  assert.equal(value.visibility, 'unknown')
  assert.deepEqual(contacts.directPeer('r2'), { uid: 'u1', displayName: '민지(저장한 이름)' })
  assert.throws(() => contacts.copyId('r2'), 'no @id to copy that was never read')
})

// B153 (contracts/B153-official-profile-photo.md §4): the picture follows the person's own rule (privacy.photo); an
// official account shows its picture to anyone and has no @id line; everyone else keeps the mutual-contacts rule.
test('B153: an official account opens with its picture and no @id, mutual or not; an ordinary one is unchanged', () => {
  const { contacts, profile } = session()
  const pane = profile('r1')
  const everyone = { privacy: { mapValue: { fields: { photo: text('everyone') } } } }
  const official = { userId: text('morse'), displayName: text('Morse'), photoURL: text('gs://morse'), bio: text('공식'), official: text('support'), ...everyone }
  pane.events.snapshot(rows(publicProfile('u1', official)))
  let value = contacts.snapshot.profile!
  assert.deepEqual([value.visibility, value.photoShown, value.userId, value.bio], ['hidden', true, '', ''], 'not mutual: picture only')
  assert.throws(() => contacts.copyId('r1'), /복사/)
  pane.events.snapshot(rows(publicProfile('u1', official), reciprocal('u1')))
  value = contacts.snapshot.profile!
  assert.deepEqual([value.visibility, value.photoShown, value.userId, value.bio], ['visible', true, '', '공식'], 'mutual: the bio as before, still no @id')
  assert.throws(() => contacts.copyId('r1'), /복사/)
  // An ordinary account, no rule written: the mutual-contacts rule as before.
  const ordinary = { userId: text('minji'), displayName: text('민지'), photoURL: text('gs://p') }
  pane.events.snapshot(rows(publicProfile('u1', ordinary)))
  assert.deepEqual([contacts.snapshot.profile!.photoShown, contacts.snapshot.profile!.userId], [false, ''])
  pane.events.snapshot(rows(publicProfile('u1', ordinary), reciprocal('u1')))
  assert.deepEqual([contacts.snapshot.profile!.photoShown, contacts.snapshot.profile!.userId], [true, 'minji'])
  assert.equal(contacts.copyId('r1'), '@minji')
  // «nobody»: hidden even from a mutual contact; the @id still follows the mutual-contacts rule.
  pane.events.snapshot(rows(publicProfile('u1', { ...ordinary, privacy: { mapValue: { fields: { photo: text('nobody') } } } }), reciprocal('u1')))
  assert.deepEqual([contacts.snapshot.profile!.photoShown, contacts.snapshot.profile!.userId], [false, 'minji'])
})

// B178 §2-5: people a screen shows on rows of its own are read with the same public-profile reader while shown, and the
// snapshot carries the marks of the ones that have one; let go, they are not read any more.
test('B178: members, blocked people and a lookup are read for their mark while shown, and let go after', () => {
  const { contacts, targets } = session()
  const reads = (uid: string) => targets.filter(target => !target.stopped && target.paths.includes(publicProfilePath(uid)))
  contacts.showPeople('members', ['m1', me])
  const member = reads('m1')
  assert.equal(member.length, 1, 'a member on screen is read')
  assert.ok(!targets.some(target => !target.stopped && target.paths.includes(publicProfilePath(me))), 'never this account itself')
  member[0]!.events.snapshot(rows(publicProfile('m1', { displayName: text('Morse'), official: text('support') })))
  assert.deepEqual(contacts.snapshot.marks, { m1: 'support' })
  contacts.showPeople('members', [])
  assert.equal(reads('m1').length, 0, 'gone from the screen, no longer read')
  assert.deepEqual(contacts.snapshot.marks, {})
  assert.ok(reads('u1').length > 0, 'the contacts are still read')
})
