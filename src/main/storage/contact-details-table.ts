import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3-multiple-ciphers'
import { identifier } from '../../shared/validation'
import { contactDetailsEdit, contactNameLimit, contactNoteLimit, type ContactDetails, type ContactDetailsEdit } from '../../shared/contact-details'

export type ContactDetailsCommand =
  | { kind: 'contact-labels' }
  | { kind: 'contact-details'; uid: string }
  | { kind: 'contact-details-save'; uid: string; edit: ContactDetailsEdit }
  | { kind: 'contact-name-pending' }
  | { kind: 'contact-name-server'; entries: ServerContactName[] }
  | { kind: 'contact-name-uploaded'; uid: string; operationId: string }
  | { kind: 'contact-name-refused'; uid: string; operationId: string; entries: ServerContactName[] }
export interface ServerContactName { uid: string; name: string; note: string; version: string }
export interface PendingContactName { uid: string; nickname: string; note: string; operationId: string }

function details(db: Database.Database, uid: string): ContactDetails {
  return db.prepare('SELECT nickname,note,version FROM contact_details WHERE peer_uid=?').get(uid) as ContactDetails | undefined
    ?? { nickname: '', note: '', version: '' }
}
// A11: the saved names also live on the server (users/{me}/contactNames/{peer}), so every device of the account shows
// the same. contact_name_sync says, per person, whether this device's saved name is the server's ('synced') or a save
// still to be sent ('pending', with the operation id it goes under). A saved name with no row is from before A11: it is
// sent once, unless the server already has one, which wins (A11 §4 «옮기기»).
const syncState = (db: Database.Database, uid: string): { state: string; operation_id: string } | undefined =>
  db.prepare('SELECT state,operation_id FROM contact_name_sync WHERE peer_uid=?').get(uid) as { state: string; operation_id: string } | undefined
function markPending(db: Database.Database, uid: string, operationId: string): void {
  db.prepare(`INSERT INTO contact_name_sync(peer_uid,state,operation_id) VALUES(?,'pending',?)
    ON CONFLICT(peer_uid) DO UPDATE SET state='pending',operation_id=excluded.operation_id`).run(uid, operationId)
}
function mergeServer(db: Database.Database, entries: ServerContactName[]): void {
  const server = new Map(entries.map(entry => [identifier(entry.uid), entry]))
  const local = db.prepare('SELECT peer_uid AS uid,nickname,note,version FROM contact_details').all() as (ContactDetails & { uid: string })[]
  for (const [uid, entry] of server) {
    if (syncState(db, uid)?.state === 'pending') continue
    const name = entry.name.slice(0, contactNameLimit), note = entry.note.slice(0, contactNoteLimit)
    // The same name and note keep their version, so an edit opened on it still saves. A new one gets the server's,
    // written as an identifier: the next edit sends it back as its expected version.
    const same = local.find(row => row.uid === uid && row.nickname === name && row.note === note && /^[A-Za-z0-9_-]{1,160}$/.test(row.version))
    if (!same) db.prepare(`INSERT INTO contact_details(peer_uid,nickname,note,version) VALUES(?,?,?,?)
      ON CONFLICT(peer_uid) DO UPDATE SET nickname=excluded.nickname,note=excluded.note,version=excluded.version`).run(uid, name, note, `server-${entry.version.replace(/[^A-Za-z0-9_-]/g, '-')}`)
    db.prepare(`INSERT INTO contact_name_sync(peer_uid,state,operation_id) VALUES(?,'synced','')
      ON CONFLICT(peer_uid) DO UPDATE SET state='synced',operation_id=''`).run(uid)
  }
  for (const row of local) {
    if (server.has(row.uid)) continue
    const sync = syncState(db, row.uid)
    if (sync?.state === 'synced') {
      // Taken away on another device: the server no longer has it.
      db.prepare('DELETE FROM contact_details WHERE peer_uid=?').run(row.uid)
      db.prepare('DELETE FROM contact_name_sync WHERE peer_uid=?').run(row.uid)
    } else if (!sync && (row.nickname || row.note)) {
      const nickname = row.nickname.slice(0, contactNameLimit), note = row.note.slice(0, contactNoteLimit)
      if (nickname !== row.nickname || note !== row.note) db.prepare('UPDATE contact_details SET nickname=?,note=? WHERE peer_uid=?').run(nickname, note, row.uid)
      markPending(db, row.uid, row.version || randomUUID())
    }
  }
}
export function executeContactDetails(db: Database.Database, command: ContactDetailsCommand): unknown {
  if (command.kind === 'contact-labels') return db.prepare("SELECT peer_uid AS uid,nickname FROM contact_details WHERE nickname<>''").all()
  if (command.kind === 'contact-name-pending') return db.prepare(`SELECT s.peer_uid AS uid,COALESCE(d.nickname,'') AS nickname,COALESCE(d.note,'') AS note,s.operation_id AS operationId
    FROM contact_name_sync s LEFT JOIN contact_details d ON d.peer_uid=s.peer_uid WHERE s.state='pending' ORDER BY s.peer_uid LIMIT 200`).all() as PendingContactName[]
  if (command.kind === 'contact-name-server') { db.transaction(() => mergeServer(db, command.entries))(); return null }
  // B63: the server refused this save for good — it is no longer waiting, and the server's list (the last one read)
  // says again what this device shows: the server's name, or none where the server has none.
  if (command.kind === 'contact-name-refused') {
    db.transaction(() => {
      const ended = db.prepare("UPDATE contact_name_sync SET state='synced',operation_id='' WHERE peer_uid=? AND state='pending' AND operation_id=?")
        .run(identifier(command.uid), command.operationId).changes
      if (ended) mergeServer(db, command.entries)
    })()
    return null
  }
  if (command.kind === 'contact-name-uploaded') {
    db.prepare("UPDATE contact_name_sync SET state='synced',operation_id='' WHERE peer_uid=? AND state='pending' AND operation_id=?").run(identifier(command.uid), command.operationId)
    return null
  }
  const uid = identifier(command.uid)
  if (command.kind === 'contact-details') return details(db, uid)
  const edit = contactDetailsEdit(command.edit)
  return db.transaction(() => {
    const old = details(db, uid)
    // A repeated local save after a lost IPC reply can only acknowledge the
    // exact same operation and contents. A newer edit cannot be overwritten.
    if (old.version === edit.operationId) {
      if (old.nickname === edit.nickname && old.note === edit.note) return old
      throw Object.assign(new Error('Contact edit identity conflict'), { deliveryCode: 'conflict' })
    }
    if (old.version !== edit.expectedVersion) throw Object.assign(new Error('Contact details changed'), { deliveryCode: 'conflict' })
    const count = db.prepare('SELECT COUNT(*) AS count FROM contact_details').get() as { count: number }
    if (!old.version && count.count >= 10000) throw Object.assign(new Error('Contact details capacity'), { deliveryCode: 'capacity' })
    db.prepare(`INSERT INTO contact_details(peer_uid,nickname,note,version) VALUES(?,?,?,?)
      ON CONFLICT(peer_uid) DO UPDATE SET nickname=excluded.nickname,note=excluded.note,version=excluded.version`)
      .run(uid, edit.nickname, edit.note, edit.operationId)
    markPending(db, uid, edit.operationId)
    return { nickname: edit.nickname, note: edit.note, version: edit.operationId } satisfies ContactDetails
  })()
}
