import type Database from 'better-sqlite3-multiple-ciphers'
import { identifier } from '../../shared/validation'

export type ContactFlagCommand =
  | { kind: 'contact-flags-read' }
  | { kind: 'contact-flag-set'; uid: string; favorite?: boolean; archived?: boolean }

// iOS keeps a contact's «즐겨찾기» and «보관» on the device (AppState.setContactFavorite / MorseContactAccountState),
// so this device keeps its own.
export function executeContactFlag(db: Database.Database, command: ContactFlagCommand): unknown {
  if (command.kind === 'contact-flags-read') {
    const rows = db.prepare('SELECT peer_uid, favorite, archived FROM contact_flags').all() as { peer_uid: string; favorite: number; archived: number }[]
    return rows.flatMap(row => { try { return [{ uid: identifier(row.peer_uid), favorite: row.favorite === 1, archived: row.archived === 1 }] } catch { return [] } })
  }
  const uid = identifier(command.uid)
  if ((command.favorite === undefined && command.archived === undefined) || (command.favorite !== undefined && typeof command.favorite !== 'boolean') ||
    (command.archived !== undefined && typeof command.archived !== 'boolean')) throw new Error('Invalid contact flag')
  db.prepare('INSERT INTO contact_flags(peer_uid,favorite,archived) VALUES(?,0,0) ON CONFLICT(peer_uid) DO NOTHING').run(uid)
  if (command.favorite !== undefined) db.prepare('UPDATE contact_flags SET favorite=? WHERE peer_uid=?').run(command.favorite ? 1 : 0, uid)
  if (command.archived !== undefined) db.prepare('UPDATE contact_flags SET archived=? WHERE peer_uid=?').run(command.archived ? 1 : 0, uid)
  db.prepare('DELETE FROM contact_flags WHERE peer_uid=? AND favorite=0 AND archived=0').run(uid)
  return null
}
