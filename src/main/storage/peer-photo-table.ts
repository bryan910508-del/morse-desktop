import type Database from 'better-sqlite3-multiple-ciphers'
import { identifier } from '../../shared/validation'

// The profile pictures this device has seen of a person, newest first — what iOS keeps as `photo_history_<uid>`
// (ProfilePhotoHistory: the address moves to the front when it is seen again, and twenty are kept). Telegram shows a
// peer's photo album from the server; Morse's server keeps none, so the only album there can be is the one this
// device watched go by. Nothing here is a picture: only the address of one, which storage.rules leaves readable.
export type PeerPhotoCommand =
  | { kind: 'peer-photos-read'; uid: string }
  | { kind: 'peer-photo-seen'; uid: string; raw: string; at: number }
  | { kind: 'peer-photo-forget'; uid: string; raw: string }

export const maxPeerPhotos = 20
const maxPeople = 500
const maxAddress = 10000

const validRaw = (raw: unknown): string => {
  if (typeof raw !== 'string' || !raw || raw.length > maxAddress) throw new Error('Invalid photo address')
  return raw
}

export function executePeerPhoto(db: Database.Database, command: PeerPhotoCommand): unknown {
  const uid = identifier(command.uid)
  if (command.kind === 'peer-photos-read') {
    const rows = db.prepare('SELECT raw FROM peer_photos WHERE uid=? ORDER BY seen_at DESC, raw LIMIT ?').all(uid, maxPeerPhotos) as { raw: string }[]
    return rows.map(row => row.raw)
  }
  if (command.kind === 'peer-photo-forget') {
    db.prepare('DELETE FROM peer_photos WHERE uid=? AND raw=?').run(uid, validRaw(command.raw))
    return null
  }
  const raw = validRaw(command.raw)
  if (typeof command.at !== 'number' || !Number.isSafeInteger(command.at) || command.at <= 0) throw new Error('Invalid moment')
  db.transaction(() => {
    db.prepare('INSERT INTO peer_photos(uid,raw,seen_at) VALUES(?,?,?) ON CONFLICT(uid,raw) DO UPDATE SET seen_at=excluded.seen_at').run(uid, raw, command.at)
    // Twenty of one person, and the people this device stopped seeing give way to the ones it sees.
    db.prepare('DELETE FROM peer_photos WHERE uid=? AND raw NOT IN (SELECT raw FROM peer_photos WHERE uid=? ORDER BY seen_at DESC, raw LIMIT ?)').run(uid, uid, maxPeerPhotos)
    const people = (db.prepare('SELECT COUNT(DISTINCT uid) AS count FROM peer_photos').get() as { count: number }).count
    if (people > maxPeople) {
      db.prepare(`DELETE FROM peer_photos WHERE uid IN (
        SELECT uid FROM peer_photos GROUP BY uid ORDER BY MAX(seen_at) LIMIT ?)`).run(people - maxPeople)
    }
  })()
  return null
}
