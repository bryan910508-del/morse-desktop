import type Database from 'better-sqlite3-multiple-ciphers'
import { identifier } from '../../shared/validation'
import { contactDetailsEdit, type ContactDetails, type ContactDetailsEdit } from '../../shared/contact-details'

export type ContactDetailsCommand =
  | { kind: 'contact-labels' }
  | { kind: 'contact-details'; uid: string }
  | { kind: 'contact-details-save'; uid: string; edit: ContactDetailsEdit }

function details(db: Database.Database, uid: string): ContactDetails {
  return db.prepare('SELECT nickname,note,version FROM contact_details WHERE peer_uid=?').get(uid) as ContactDetails | undefined
    ?? { nickname: '', note: '', version: '' }
}
export function executeContactDetails(db: Database.Database, command: ContactDetailsCommand): unknown {
  if (command.kind === 'contact-labels') return db.prepare("SELECT peer_uid AS uid,nickname FROM contact_details WHERE nickname<>''").all()
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
    return { nickname: edit.nickname, note: edit.note, version: edit.operationId } satisfies ContactDetails
  })()
}
