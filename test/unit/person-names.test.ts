import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ContactsSession } from '../../src/main/accounts/contacts'
import { publicProfilePath } from '../../src/main/accounts/peer-profiles'
import { documents, type FirestoreDocument } from '../../src/main/network/firestore-values'
import type { FirestoreReader, WatchEvents } from '../../src/main/network/firestore-rpc'

// B48 / A11 §4 (Telegram R-60): one name per person on every screen — withdrawn first, then the name this account
// saved, then the person's public profile. The chat list asks the contacts for it, also for 1:1 peers who are not
// contacts, whose public profiles are followed too.
const me = 'me1'
const doc = (name: string, fields: Record<string, unknown>): FirestoreDocument =>
  ({ name, updateTime: { seconds: '1', nanos: 0 }, createTime: { seconds: '1', nanos: 0 }, fields } as unknown as FirestoreDocument)
const text = (value: string) => ({ stringValue: value })
const rows = (...docs: FirestoreDocument[]): Map<string, FirestoreDocument> => new Map(docs.map(item => [item.name, item]))
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

async function session(labels: { uid: string; nickname: string }[] = []) {
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
    (command.kind === 'contact-labels' ? labels : command.kind === 'contact-details' ? { nickname: '', note: '', version: '' } : []) as T
  const contacts = new ContactsSession(me, auth, () => {}, store as never, () => {}, () => reader)
  contacts.connection(true)
  await tick()
  const list = targets.find(target => target.paths[0] === `query:${documents}/users/${me}`)!
  list.events.snapshot(rows(doc(`${documents}/users/${me}/contacts/u1`, { displayName: text('민지 사본') })))
  return { contacts, targets, live: () => targets.filter(target => !target.stopped) }
}

test('a person is named by the saved name first, then the public profile; withdrawn comes before both', async () => {
  const { contacts, live } = await session([{ uid: 'u1', nickname: '민지(내가 저장)' }])
  assert.equal(contacts.personName('u1'), '민지(내가 저장)', 'the saved name, before anything is read')
  const target = live().find(item => item.paths.includes(publicProfilePath('u1')))!
  target.events.snapshot(rows(doc(publicProfilePath('u1'), { displayName: text('민지T') })))
  assert.equal(contacts.personName('u1'), '민지(내가 저장)', 'the person renaming does not replace the saved name')
  target.events.snapshot(rows(doc(publicProfilePath('u1'), { accountDeleted: { booleanValue: true } })))
  assert.equal(contacts.personName('u1'), '탈퇴한 계정')
})

test('a 1:1 peer who is not a contact is followed by public profile, and every change bumps the names revision', async () => {
  const { contacts, live } = await session()
  assert.equal(contacts.personName('x9'), '', 'unknown: the chat keeps its copy')
  const before = contacts.namesRevision
  contacts.followPeers(['x9', me])
  const target = live().find(item => item.paths.includes(publicProfilePath('x9')))
  assert.ok(target, 'the peer is read from their public profile')
  assert.ok(!target.paths.includes(publicProfilePath(me)), 'this account is not followed')
  target.events.snapshot(rows(doc(publicProfilePath('x9'), { displayName: text('지금 이름') })))
  assert.equal(contacts.personName('x9'), '지금 이름')
  assert.ok(contacts.namesRevision > before)
  const count = live().length
  contacts.followPeers(['x9'])
  assert.equal(live().length, count, 'the same peers start nothing new')
})
