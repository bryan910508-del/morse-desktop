import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PeerProfiles, publicProfilePath } from '../../src/main/accounts/peer-profiles'
import { registerUserpicCache, UserpicCache } from '../../src/main/accounts/userpic-cache'
import { CommentAuthors } from '../../src/main/accounts/channel-comments'
import { documents, type FirestoreDocument } from '../../src/main/network/firestore-values'
import type { FirestoreReader, ReadCredentials, WatchEvents } from '../../src/main/network/firestore-rpc'

// B266 ⑥ / B153 §4 «서로 연락처를 아직 모를 때»: mutual = this account's contact ∧ kept by them, decided when read; before
// an answer (opening, a refused read, offline) the last answer remembered for this account, and none if there never was.
const me = 'me1'
const doc = (name: string, fields: Record<string, unknown>): FirestoreDocument => ({ name, updateTime: { seconds: '1', nanos: 0 }, fields } as unknown as FirestoreDocument)
const text = (value: string) => ({ stringValue: value })
const profile = (uid: string, extra: Record<string, unknown> = {}) => doc(publicProfilePath(uid), { displayName: text(uid), photoURL: text(`gs://${uid}.jpg`), ...extra })
const kept = (uid: string) => doc(`${documents}/users/${uid}/contacts/${me}`, {})
const rows = (...docs: FirestoreDocument[]) => new Map(docs.map(item => [item.name, item]))
const privacy = (photo: string) => ({ privacy: { mapValue: { fields: { photo: text(photo) } } } })

async function setup(contacts: Set<string>, kind: 'contacts' | 'authors' = 'contacts') {
  const credentials: ReadCredentials = { signal: new AbortController().signal, authorize: async () => ({ idToken: 'id', appCheckToken: 'c', expiresAt: Date.now() + 60000 }) }
  const stored = new Map<string, string>()
  const cache = new UserpicCache((async (command: { kind: string; owner?: string; raw?: string | null }) => {
    if (command.kind === 'userpic-owners') return [...stored].map(([owner, raw]) => ({ owner, raw }))
    if (command.kind === 'userpic-owner') { if (command.raw) stored.set(command.owner!, command.raw); else stored.delete(command.owner!) }
    return null
  }) as never)
  await cache.load()
  registerUserpicCache(credentials, cache)
  const targets: { paths: string[]; events: WatchEvents }[] = []
  const reader = { watch(target: { documents: { documents: string[] } }, _s: AbortSignal, events: WatchEvents) { targets.push({ paths: target.documents.documents, events }); return () => {} } } as unknown as FirestoreReader
  const profiles = new PeerProfiles(me, credentials, credentials.signal, () => {}, undefined, kind, uid => contacts.has(uid))
  return { profiles, reader, targets, cache, credentials }
}

test('mutual is this account\'s contact and kept by them, decided when read — a person who only keeps this account is not', async () => {
  const contacts = new Set<string>()
  const { profiles, reader, targets, cache } = await setup(contacts)
  profiles.bind(reader, ['u1'])
  targets[0]!.events.snapshot(rows(profile('u1'), kept('u1')))
  assert.deepEqual([profiles.profile('u1')!.mutual, profiles.photo('u1'), cache.known('user:u1')], [false, '', ''], 'kept by them, not this account\'s contact: the default rule hides it')
  contacts.add('u1'); profiles.recheck()
  assert.deepEqual([profiles.profile('u1')!.mutual, profiles.photo('u1'), cache.known('user:u1')], [true, 'gs://u1.jpg', 'gs://u1.jpg'], 'joined the contacts: the same answer, decided again and remembered')
  contacts.delete('u1'); profiles.recheck()
  assert.deepEqual([profiles.photo('u1'), cache.known('user:u1')], ['', ''])
})

test('the decision table: everyone · contacts · nobody · none × mutual or not', async () => {
  const contacts = new Set(['c1', 'c2', 'c3', 'c4'])
  const { profiles, reader, targets } = await setup(contacts)
  profiles.bind(reader, ['c1', 'c2', 'c3', 'c4', 'n1'])
  targets[0]!.events.snapshot(rows(profile('c1', privacy('everyone')), profile('c2', privacy('contacts')), kept('c2'), profile('c3', privacy('nobody')), kept('c3'),
    profile('c4'), profile('n1', privacy('everyone'))))
  assert.deepEqual(['c1', 'c2', 'c3', 'c4', 'n1'].map(uid => [profiles.photo(uid), profiles.photoFor(uid, contacts.has(uid))]),
    [['gs://c1.jpg', 'gs://c1.jpg'], ['gs://c2.jpg', 'gs://c2.jpg'], ['', ''], ['', ''], ['gs://n1.jpg', 'gs://n1.jpg']])
})

test('before an answer, the last answer remembered; never answered, none — and an author\'s reader remembers too', async () => {
  const contacts = new Set<string>()
  const first = await setup(contacts)
  first.profiles.bind(first.reader, ['u1'])
  first.targets[0]!.events.snapshot(rows(profile('u1', privacy('everyone'))))
  assert.equal(first.cache.known('user:u1'), 'gs://u1.jpg')
  // Opening again (a new reader, nothing answered yet): what was remembered.
  const again = new PeerProfiles(me, first.credentials, first.credentials.signal, () => {}, undefined, 'contacts', uid => contacts.has(uid))
  again.bind(first.reader, ['u1'])
  assert.deepEqual([again.hasAnswer('u1'), again.remembered('u1'), again.remembered('never')], [false, 'gs://u1.jpg', ''])
  // Comment authors: not a contact — the picture shown to everyone, remembered; before the answer, the remembered one.
  const authors = new CommentAuthors(me, first.credentials, () => {})
  assert.equal(authors.photo('u1'), 'gs://u1.jpg', 'remembered, before the answer')
  assert.equal(authors.photo('never'), null)
  authors.contactPhoto = uid => uid === 'u1' ? '' : undefined
  assert.equal(authors.photo('u1'), null, 'a contact is drawn by the contacts\' own read')
})
