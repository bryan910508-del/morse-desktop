import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ContactsSession } from '../../src/main/accounts/contacts'
import { publicProfilePath } from '../../src/main/accounts/peer-profiles'
import { documents, type FirestoreDocument } from '../../src/main/network/firestore-values'
import type { FirestoreReader, WatchEvents } from '../../src/main/network/firestore-rpc'

// B266: anyone this account meets opens as a person (tdesktop showPeer → showPeerInfo for every user,
// window_session_controller.cpp:2846-2847). What is shown follows A7 §3-1 and B153 §4: the name to anyone, the picture by
// its own rule, the @id, bio and linked channel to mutual contacts only — mutual meaning this account's contact AND the
// person keeping this account. Only a contact has a note, a personal photo, editing and deleting.
const me = 'me1'
const doc = (name: string, fields: Record<string, unknown>): FirestoreDocument =>
  ({ name, updateTime: { seconds: '1', nanos: 0 }, createTime: { seconds: '1', nanos: 0 }, fields } as unknown as FirestoreDocument)
const text = (value: string) => ({ stringValue: value })
const publicProfile = (uid: string, fields: Record<string, unknown>): FirestoreDocument => doc(publicProfilePath(uid), fields)
const reciprocal = (uid: string): FirestoreDocument => doc(`${documents}/users/${uid}/contacts/${me}`, {})
const contactRow = (uid: string, name: string): FirestoreDocument => doc(`${documents}/users/${me}/contacts/${uid}`, { displayName: text(name) })
const rows = (...docs: FirestoreDocument[]): Map<string, FirestoreDocument> => new Map(docs.map(item => [item.name, item]))
const everyone = { privacy: { mapValue: { fields: { photo: text('everyone') } } } }

function session() {
  const targets: { paths: string[]; events: WatchEvents; stopped: boolean }[] = []
  const added: { uid: string; userId: string; displayName: string; photoURL: string }[] = []
  const reader = {
    watch(target: { documents?: { documents: string[] }; query?: { parent: string } }, _signal: AbortSignal, events: WatchEvents) {
      const entry = { paths: target.documents?.documents ?? [`query:${target.query?.parent}`], events, stopped: false }
      targets.push(entry)
      return () => { entry.stopped = true }
    },
    async addContact(owner: string, peer: { uid: string; userId: string; displayName: string; photoURL: string }) { assert.equal(owner, me); added.push(peer); return 'added' as const },
    close() {}
  } as unknown as FirestoreReader
  const auth = { signal: new AbortController().signal, authorize: async () => ({ idToken: 'id', appCheckToken: 'check', expiresAt: Date.now() + 60000 }) }
  const details: string[] = []
  const store = async <T,>(command: { kind: string; uid?: string }): Promise<T> => {
    if (command.kind === 'contact-details') { details.push(command.uid!); return { nickname: '별명', note: '메모', version: 'v1' } as T }
    return [] as T
  }
  const contacts = new ContactsSession(me, auth, () => {}, store as never, () => {}, () => reader)
  contacts.connection(true)
  const list = targets.find(target => target.paths[0] === `query:${documents}/users/${me}`)!
  list.events.snapshot(rows(contactRow('u1', '민지')))
  return { contacts, targets, list, added, details }
}
const settle = () => new Promise(resolve => setImmediate(resolve))

test('a person who is not a contact opens: the name, the picture by its rule, no @id, bio or channel, no note', async () => {
  const { contacts, targets, details } = session()
  contacts.open('u2', 'r1', '전달 머리의 이름')
  const pane = targets.at(-1)!
  assert.deepEqual(pane.paths, [publicProfilePath('u2'), `${documents}/users/u2/contacts/${me}`], 'the public profile, never the account document')
  // Even when the person keeps this account, it is not mutual until this account keeps them too.
  pane.events.snapshot(rows(publicProfile('u2', { userId: text('jiho'), displayName: text('지호'), photoURL: text('gs://j'), bio: text('소개'), personalChannelId: text('c2') }), reciprocal('u2')))
  await settle()
  let value = contacts.snapshot.profile!
  assert.deepEqual([value.status, value.contact, value.visibility, value.displayName, value.userId, value.bio, value.personalChannelId, value.photoShown],
    ['ready', false, 'hidden', '지호', '', '', '', false])
  assert.deepEqual([value.local.nickname, value.local.note, value.contactVersion], ['', '', ''], 'a note is a contact\'s')
  assert.deepEqual(details, [], 'no contact details are read for a person who is not a contact')
  assert.throws(() => contacts.copyId('r1'))
  // B153: a picture shown to everyone is shown to them too.
  pane.events.snapshot(rows(publicProfile('u2', { userId: text('jiho'), displayName: text('지호'), photoURL: text('gs://j'), ...everyone })))
  value = contacts.snapshot.profile!
  assert.deepEqual([value.photoShown, value.userId], [true, ''])
})

test('no public profile to read: the opening screen\'s name; a withdrawn account; this account itself', () => {
  const { contacts, targets } = session()
  contacts.open('u3', 'r1', ' 그룹에서 본 이름 ')
  targets.at(-1)!.events.snapshot(rows())
  assert.deepEqual([contacts.snapshot.profile!.status, contacts.snapshot.profile!.displayName, contacts.snapshot.profile!.visibility], ['ready', '그룹에서 본 이름', 'unknown'])
  targets.at(-1)!.events.snapshot(rows(publicProfile('u3', { accountDeleted: { booleanValue: true } })))
  assert.equal(contacts.snapshot.profile!.status, 'unavailable')
  assert.throws(() => contacts.chatPeer('r1'), 'a withdrawn account gets no chat')
  assert.throws(() => contacts.open(me, 'r2'), 'this account is not a person to open')
})

test('the person joins and leaves the contacts while open: the same profile is drawn again', async () => {
  const { contacts, targets, list, details } = session()
  contacts.open('u2', 'r1')
  const pane = targets.at(-1)!
  pane.events.snapshot(rows(publicProfile('u2', { userId: text('jiho'), displayName: text('지호'), bio: text('소개') }), reciprocal('u2')))
  assert.equal(contacts.snapshot.profile!.visibility, 'hidden')
  list.events.snapshot(rows(contactRow('u1', '민지'), contactRow('u2', '지호')))
  await settle()
  let value = contacts.snapshot.profile!
  assert.deepEqual([value.contact, value.visibility, value.userId, value.bio, value.local.nickname, value.displayName], [true, 'visible', 'jiho', '소개', '별명', '별명'])
  assert.deepEqual(details, ['u2'])
  assert.ok(!pane.stopped, 'the same watch goes on')
  list.events.snapshot(rows(contactRow('u1', '민지')))
  value = contacts.snapshot.profile!
  assert.deepEqual([value.contact, value.visibility, value.userId, value.local.nickname, value.displayName], [false, 'hidden', '', '', '지호'])
})

test('«메시지 보내기» opens anyone opened (iOS openChat, Android prepareChat); a contact keeps its saved name', () => {
  const { contacts, targets } = session()
  contacts.open('u2', 'r1')
  assert.throws(() => contacts.chatPeer('r1'), 'not read yet')
  targets.at(-1)!.events.snapshot(rows(publicProfile('u2', { displayName: text('지호') })))
  assert.deepEqual(contacts.chatPeer('r1'), { uid: 'u2', displayName: '지호' })
  assert.throws(() => contacts.chatPeer('other'), 'another selection')
  assert.throws(() => contacts.directPeer('r1'), 'a contact\'s story handle stays a contact\'s')
  contacts.open('u1', 'r2')
  targets.at(-1)!.events.state('error', { code: 'permission' } as never)
  assert.deepEqual(contacts.chatPeer('r2'), { uid: 'u1', displayName: '민지' })
})

test('«연락처에 추가» from a profile saves its public name and @id, the picture only when this account may see it', async () => {
  const { contacts, targets, added } = session()
  contacts.open('u2', 'r1')
  const pane = targets.at(-1)!
  pane.events.snapshot(rows(publicProfile('u2', { userId: text('jiho'), displayName: text('지호'), photoURL: text('gs://j') })))
  assert.deepEqual(contacts.profileContact('r1'), { uid: 'u2', userId: 'jiho', displayName: '지호', photoURL: '' })
  pane.events.snapshot(rows(publicProfile('u2', { userId: text('jiho'), displayName: text('지호'), photoURL: text('gs://j'), ...everyone })))
  const first = contacts.addFromProfile('r1'), second = contacts.addFromProfile('r1')
  assert.equal(first, second, 'one save at a time')
  assert.deepEqual(await first, { outcome: 'added', message: '내 연락처에 추가했습니다.' })
  assert.deepEqual(added, [{ uid: 'u2', userId: 'jiho', displayName: '지호', photoURL: 'gs://j' }])
  contacts.open('u1', 'r2')
  targets.at(-1)!.events.snapshot(rows(publicProfile('u1', { displayName: text('민지') })))
  assert.throws(() => contacts.profileContact('r2'), /이미 연락처/)
  contacts.open('u4', 'r3', '이름')
  targets.at(-1)!.events.snapshot(rows())
  assert.throws(() => contacts.profileContact('r3'), 'nothing read to save them with')
})
