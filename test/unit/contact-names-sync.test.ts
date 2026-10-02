import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import Database from 'better-sqlite3-multiple-ciphers'
import { ContactNamesSync, decodeContactNames } from '../../src/main/accounts/contact-names-sync'
import { executeContactDetails, type ContactDetailsCommand, type PendingContactName } from '../../src/main/storage/contact-details-table'
import { documents, type FirestoreDocument } from '../../src/main/network/firestore-values'
import { contactDetailsEdit } from '../../src/shared/contact-details'
import type { WatchEvents } from '../../src/main/network/firestore-rpc'

// Contract A11: the names and notes this account saved are kept on the server, users/{me}/contactNames/{peer}, the
// same on every device of the account. A save goes to the device and then to the server; the server's list becomes the
// device's copy unless a save is still on its way; a name saved before A11 goes up once, only where the server has none.
const me = 'me1'
function database(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE contact_details (peer_uid TEXT PRIMARY KEY, nickname TEXT NOT NULL, note TEXT NOT NULL, version TEXT NOT NULL);
    CREATE TABLE contact_name_sync (peer_uid TEXT PRIMARY KEY, state TEXT NOT NULL, operation_id TEXT NOT NULL DEFAULT '');`)
  return db
}
const run = <T,>(db: Database.Database, command: ContactDetailsCommand): T => executeContactDetails(db, command) as T
const save = (db: Database.Database, uid: string, nickname: string, note = '') => {
  const old = run<{ version: string }>(db, { kind: 'contact-details', uid })
  return run<{ version: string }>(db, { kind: 'contact-details-save', uid, edit: { operationId: randomUUID(), expectedVersion: old.version, nickname, note } })
}
const names = (db: Database.Database) => run<{ uid: string; nickname: string }[]>(db, { kind: 'contact-labels' }).map(row => [row.uid, row.nickname])
const pending = (db: Database.Database) => run<PendingContactName[]>(db, { kind: 'contact-name-pending' }).map(row => row.uid)
const server = (uid: string, name: string, note = '') => ({ uid, name, note, version: '5:0' })

test('a name saved on this device alone goes up once, unless the server has one, which wins', () => {
  const db = database()
  // Before A11: two names saved on this desktop only (no sync rows).
  db.prepare("INSERT INTO contact_details VALUES('a','에이','', 'v1'),('b','비','메모','v2')").run()
  run(db, { kind: 'contact-name-server', entries: [server('b', '비(아이폰에서)')] })
  assert.deepEqual(names(db), [['a', '에이'], ['b', '비(아이폰에서)']], 'the server wins for b')
  assert.deepEqual(pending(db), ['a'], 'a goes up')
})

test('a save on its way is not overwritten, and once sent the server is the copy; taken away elsewhere, it goes', () => {
  const db = database()
  const saved = save(db, 'a', '새 이름')
  run(db, { kind: 'contact-name-server', entries: [server('a', '옛 이름')] })
  assert.deepEqual(names(db), [['a', '새 이름']], 'the save waiting to go is kept')
  const [row] = run<PendingContactName[]>(db, { kind: 'contact-name-pending' })
  assert.deepEqual([row?.uid, row?.nickname, row?.operationId], ['a', '새 이름', saved.version])
  run(db, { kind: 'contact-name-uploaded', uid: 'a', operationId: saved.version })
  assert.deepEqual(pending(db), [])
  run(db, { kind: 'contact-name-server', entries: [server('a', '다른 기기에서 바꿈')] })
  assert.deepEqual(names(db), [['a', '다른 기기에서 바꿈']])
  run(db, { kind: 'contact-name-server', entries: [] })
  assert.deepEqual(names(db), [], 'removed on another device')
})

test('a name read from the server can be edited again, and the same name read again keeps its version', () => {
  const db = database()
  run(db, { kind: 'contact-name-server', entries: [server('a', '서버 이름')] })
  const read = run<{ version: string }>(db, { kind: 'contact-details', uid: 'a' })
  // The renderer sends the version back as the edit's expected version, which must be an identifier.
  const edit = contactDetailsEdit({ operationId: randomUUID(), expectedVersion: read.version, nickname: '', note: '' })
  run(db, { kind: 'contact-details-save', uid: 'a', edit })
  assert.deepEqual(names(db), [], 'cleared')
  run(db, { kind: 'contact-name-uploaded', uid: 'a', operationId: edit.operationId })
  const saved = save(db, 'b', '비')
  run(db, { kind: 'contact-name-uploaded', uid: 'b', operationId: saved.version })
  run(db, { kind: 'contact-name-server', entries: [server('b', '비')] })
  assert.equal(run<{ version: string }>(db, { kind: 'contact-details', uid: 'b' }).version, saved.version, 'an edit opened before the read still saves')
})

test('the server list is read before anything is sent, and a failed send goes again under its id', async () => {
  const db = database()
  save(db, 'a', '에이')
  const sent: { peer: string; name: string; operationId: string }[] = []
  let events: WatchEvents | null = null, fail = true
  const reader = {
    watch: (_target: unknown, _signal: AbortSignal, value: WatchEvents) => { events = value; return () => {} },
    setContactName: async (_uid: string, peer: string, value: { name: string; note: string; operationId: string }) => {
      sent.push({ peer, name: value.name, operationId: value.operationId })
      if (fail) { fail = false; throw Object.assign(new Error('offline'), { code: 'network' }) }
    }
  }
  let merged = 0
  const sync = new ContactNamesSync(me, async <T,>(command: ContactDetailsCommand) => executeContactDetails(db, command) as T, () => { merged++ })
  sync.bind(reader as never, new AbortController().signal)
  sync.kick()
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(sent.length, 0, 'nothing goes before the server list is read')
  events!.snapshot(new Map())
  await new Promise(resolve => setTimeout(resolve, 2300))
  assert.equal(merged, 1)
  assert.deepEqual(sent.map(item => [item.peer, item.name]), [['a', '에이'], ['a', '에이']], 'sent, failed, sent again')
  assert.equal(sent[0]!.operationId, sent[1]!.operationId, 'under the same id')
  assert.deepEqual(pending(db), [])
  sync.close()
})

test('the server list is read with its limits', () => {
  const doc = (peer: string, fields: Record<string, unknown>): FirestoreDocument =>
    ({ name: `${documents}/users/${me}/contactNames/${peer}`, updateTime: { seconds: '7', nanos: 0 }, fields } as unknown as FirestoreDocument)
  const read = decodeContactNames([doc('a', { name: { stringValue: ' 민지 ' }, note: { stringValue: '메모' } }), doc('b', { name: { stringValue: 'x'.repeat(65) } }), doc('c', { note: { stringValue: 'n' } })], me)
  assert.deepEqual(read.map(item => [item.uid, item.name, item.note]), [['a', '민지', '메모']])
})
