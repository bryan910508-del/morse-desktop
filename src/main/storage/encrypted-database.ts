import Database from 'better-sqlite3-multiple-ciphers'
import { closeSync, existsSync, openSync, readSync } from 'node:fs'

// The account database under the installation's local key (tdesktop Storage::Domain encrypts every local file with
// it). SQLite3 Multiple Ciphers takes the 32-byte key raw (x'…', ChaCha20-Poly1305 by default). A database written by
// an earlier version is still plain SQLite: it is encrypted in place once, which SQLite3 Multiple Ciphers only allows
// outside WAL mode, so its WAL is folded in and the rollback journal used for that one transaction.
const plainHeader = Buffer.from('SQLite format 3\0', 'latin1')
export type EncryptedDatabase = Database.Database

export function isPlainDatabase(file: string): boolean {
  if (!existsSync(file)) return false
  const handle = openSync(file, 'r')
  try {
    const header = Buffer.alloc(plainHeader.length)
    return readSync(handle, header, 0, header.length, 0) === header.length && header.equals(plainHeader)
  } finally { closeSync(handle) }
}
export function rawKey(key: string): string {
  if (!/^[0-9a-f]{64}$/.test(key)) throw new Error('Invalid local data key')
  return `x'${key}'`
}
export function openEncryptedDatabase(file: string, key: string): EncryptedDatabase {
  const literal = rawKey(key), plain = isPlainDatabase(file)
  const db = new Database(file)
  try {
    if (plain) {
      db.pragma('wal_checkpoint(TRUNCATE)')
      db.pragma('journal_mode = DELETE')
      db.pragma(`rekey = "${literal}"`)
    } else db.pragma(`key = "${literal}"`)
    // A wrong key answers SQLITE_NOTADB here, before anything is written.
    db.prepare('SELECT count(*) AS count FROM sqlite_master').get()
    return db
  } catch (error) { db.close(); throw error }
}
