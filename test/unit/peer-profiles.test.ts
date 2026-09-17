import assert from 'node:assert/strict'
import { test } from 'node:test'
import { contactNames, decodePeerProfile, PeerProfiles, peerProfileGroup } from '../../src/main/accounts/peer-profiles'
import { registerUserpicCache, UserpicCache } from '../../src/main/accounts/userpic-cache'
import type { UserpicCommand } from '../../src/main/storage/userpic-cache-table'
import { documents, type FirestoreDocument } from '../../src/main/network/firestore-values'
import type { FirestoreReader, WatchEvents } from '../../src/main/network/firestore-rpc'

// Data::Session keeps one PeerData per person from one stream of peer data: the current name, the picture and whether
// this person still has this account as a contact. No row opens a read of its own.
const me = 'me1'
const user = (uid: string, fields: Record<string, unknown>): FirestoreDocument => ({
  name: `${documents}/users/${uid}`, updateTime: { seconds: '1', nanos: 0 }, fields
} as unknown as FirestoreDocument)
const named = (uid: string, name: string, photo = ''): FirestoreDocument => user(uid, { displayName: { stringValue: name }, ...(photo ? { photoURL: { stringValue: photo } } : {}) })
const reciprocal = (uid: string): FirestoreDocument => ({ name: `${documents}/users/${uid}/contacts/${me}`, fields: {} } as unknown as FirestoreDocument)
const rows = (...docs: FirestoreDocument[]): Map<string, FirestoreDocument> => new Map(docs.map(doc => [doc.name, doc]))

function fakeReader() {
  const targets: { paths: string[]; max: number; events: WatchEvents; stopped: boolean }[] = []
  const reader = {
    watch(target: { documents: { documents: string[] } }, _signal: AbortSignal, events: WatchEvents, max: number) {
      const entry = { paths: target.documents.documents, max, events, stopped: false }
      targets.push(entry)
      return () => { entry.stopped = true }
    }
  } as unknown as FirestoreReader
  return { reader, targets, live: () => targets.filter(target => !target.stopped) }
}
function peerProfiles(owners: { owner: string; raw: string }[] = []) {
  const auth = { signal: new AbortController().signal } as unknown as { signal: AbortSignal }
  const commands: UserpicCommand[] = []
  const cache = new UserpicCache(async <T,>(command: UserpicCommand): Promise<T> => {
    commands.push(command)
    return (command.kind === 'userpic-owners' ? owners : null) as T
  })
  registerUserpicCache(auth, cache)
  let changes = 0
  const profiles = new PeerProfiles(me, auth, auth.signal, () => { changes++ })
  return { profiles, cache, commands, auth, changes: () => changes }
}
const contacts = (count: number): string[] => Array.from({ length: count }, (_, index) => `u${String(index).padStart(3, '0')}`)

test('a person is read as name, picture and whether this account is still their contact', () => {
  assert.deepEqual(decodePeerProfile(named('u1', '  민지 ', 'gs://x'), true), { name: '민지', photo: 'gs://x', mutual: true })
  assert.deepEqual(decodePeerProfile(named('u1', '민지', 'gs://x'), false), { name: '민지', photo: '', mutual: false }, 'no longer mutual hides the picture')
  assert.equal(decodePeerProfile(user('u1', { displayName: { stringValue: '탈퇴' }, accountDeleted: { booleanValue: true } }), true), null)
  assert.equal(decodePeerProfile(undefined, true), null)
  const item = { uid: 'u1', displayName: '예전 이름' }
  assert.deepEqual(contactNames(item, undefined, '새 이름'), { displayName: '새 이름', originalName: '새 이름' })
  assert.deepEqual(contactNames(item, '별칭', '새 이름'), { displayName: '별칭', originalName: '새 이름' })
  assert.deepEqual(contactNames(item, '', ''), { displayName: '예전 이름', originalName: '예전 이름' })
})

test('every contact is read by the account, five people and ten documents a target', async () => {
  const { reader, targets } = fakeReader()
  const { profiles, cache, commands, changes } = peerProfiles()
  await cache.load()
  const all = contacts(12)
  profiles.bind(reader, all)
  assert.equal(peerProfileGroup, 5)
  assert.deepEqual(targets.map(target => target.paths.length), [10, 10, 4])
  assert.deepEqual(targets[0]!.paths, [...contacts(5).map(uid => `${documents}/users/${uid}`), ...contacts(5).map(uid => `${documents}/users/${uid}/contacts/${me}`)])
  assert.equal(profiles.hasAnswer('u000'), false)
  targets[0]!.events.snapshot(rows(named('u000', '민지', 'gs://photo1'), reciprocal('u000'), named('u001', '지훈', 'gs://photo2')))
  assert.deepEqual(profiles.profile('u000'), { name: '민지', photo: 'gs://photo1', mutual: true })
  assert.deepEqual(profiles.profile('u001'), { name: '지훈', photo: '', mutual: false }, 'a person who removed this account shows no picture')
  assert.equal(profiles.profile('u002'), null, 'a person whose document is missing is not shown')
  assert.equal(profiles.hasAnswer('u002'), true, 'the answer covers every person of the target')
  assert.equal(profiles.name('u000'), '민지')
  assert.equal(profiles.photo('u000'), 'gs://photo1')
  assert.equal(changes(), 1)
  assert.deepEqual(commands.filter(command => command.kind === 'userpic-owner').map(command => command.kind === 'userpic-owner' ? [command.owner, command.raw] : null),
    [['user:u000', 'gs://photo1']], 'only a picture this account may see is confirmed')
  targets[0]!.events.snapshot(rows(named('u000', '민지', 'gs://photo1'), reciprocal('u000'), named('u001', '지훈')))
  assert.equal(changes(), 1, 'the same peer data is not announced again')
  targets[0]!.events.reconnecting!()
  assert.deepEqual(profiles.profile('u000'), { name: '민지', photo: 'gs://photo1', mutual: true }, 'a re-listen keeps what is known')
  targets[0]!.events.snapshot(rows(named('u000', '민지'), named('u001', '지훈')))
  assert.equal(profiles.photo('u000'), '', 'the picture goes when the contact is no longer mutual')
  assert.deepEqual(commands.at(-1), { kind: 'userpic-owner', owner: 'user:u000', raw: null })
})

test('adding or removing a contact restarts only that target, and a refused read leaves those people unknown', async () => {
  const { reader, targets, live } = fakeReader()
  const { profiles, cache } = peerProfiles()
  await cache.load()
  const all = contacts(10)
  profiles.bind(reader, all)
  targets[1]!.events.snapshot(rows(named('u005', '민지', 'gs://p'), reciprocal('u005')))
  profiles.bind(reader, all)
  assert.equal(targets.length, 2, 'the same contacts start nothing new')
  profiles.bind(reader, [...all, 'u900'])
  assert.equal(targets.length, 3)
  assert.deepEqual(targets[2]!.paths, [`${documents}/users/u900`, `${documents}/users/u900/contacts/${me}`])
  profiles.bind(reader, [...all.filter(uid => uid !== 'u000'), 'u900'])
  assert.equal(targets[0]!.stopped, true)
  assert.equal(targets[1]!.stopped, false, 'the other target keeps reading')
  assert.equal(profiles.name('u005'), '민지')
  assert.equal(live().length, 3)
  targets[1]!.events.state('error')
  assert.equal(profiles.profile('u005'), null)
  assert.equal(profiles.hasAnswer('u005'), false, 'unknown again, so the row falls back to what was confirmed')
  profiles.bind(reader, [...all.filter(uid => uid !== 'u000'), 'u900'])
  assert.ok(live().some(target => target.paths.includes(`${documents}/users/u005`)), 'the refused target is read again')
  profiles.close()
  assert.equal(live().length, 0)
})
