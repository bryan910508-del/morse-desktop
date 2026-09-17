import type Database from 'better-sqlite3-multiple-ciphers'
import { chmodSync, existsSync, rmSync } from 'node:fs'
import { openEncryptedDatabase } from './encrypted-database'

// Storage::Cache::Database (tdesktop storage_account.cpp cacheSettings): pictures already fetched are kept in the account's
// own cache file, sealed with the local key, so a restart draws them without downloading them again. The file holds only
// copies of server pictures; one that cannot be opened is started again (clearOnWrongKey), and the oldest pictures give
// way when the size limit is reached.
export type UserpicCommand =
  | { kind: 'userpic-read'; key: string }
  | { kind: 'userpic-write'; key: string; mime: string; data: Uint8Array }
  | { kind: 'userpic-owners' }
  | { kind: 'userpic-owner'; owner: string; raw: string | null }
  | { kind: 'userpic-usage' }
  | { kind: 'userpic-clear' }

export const maxUserpicCacheBytes = 256 * 1024 * 1024
export const maxUserpicCacheEntries = 4000
export const maxUserpicBytes = 10 * 1024 * 1024
const maxOwners = 20000
const mimes = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

const validKey = (key: unknown): string => {
  if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid userpic key')
  return key
}
const validOwner = (owner: unknown): string => {
  if (typeof owner !== 'string' || !/^(user|group|channel):[A-Za-z0-9_.:-]{1,200}$/.test(owner)) throw new Error('Invalid userpic owner')
  return owner
}
const validRaw = (raw: unknown): string => {
  if (typeof raw !== 'string' || !raw || raw.length > 10000) throw new Error('Invalid userpic address')
  return raw
}

export class UserpicStore {
  private db: Database.Database | null = null
  constructor(private readonly file: string, private readonly key: string, private readonly now: () => number = Date.now,
    private readonly limits = { bytes: maxUserpicCacheBytes, entries: maxUserpicCacheEntries }) {}

  private open(): Database.Database {
    if (this.db) return this.db
    let db: Database.Database
    try { db = this.prepare() }
    catch {
      // A damaged cache holds nothing that cannot be fetched again.
      for (const part of [this.file, `${this.file}-wal`, `${this.file}-shm`]) if (existsSync(part)) rmSync(part, { force: true })
      db = this.prepare()
    }
    this.db = db
    return db
  }
  private prepare(): Database.Database {
    const db = openEncryptedDatabase(this.file, this.key)
    try {
      chmodSync(this.file, 0o600)
      db.pragma('journal_mode = WAL'); db.pragma('synchronous = NORMAL'); db.pragma('busy_timeout = 5000')
      db.exec(`CREATE TABLE IF NOT EXISTS userpics (key TEXT PRIMARY KEY, mime TEXT NOT NULL, data BLOB NOT NULL, size INTEGER NOT NULL, used_at INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS userpics_used ON userpics(used_at);
        CREATE TABLE IF NOT EXISTS userpic_owners (owner TEXT PRIMARY KEY, raw TEXT NOT NULL, confirmed_at INTEGER NOT NULL);`)
      return db
    } catch (error) { db.close(); throw error }
  }

  execute(command: UserpicCommand): unknown {
    const db = this.open()
    switch (command.kind) {
      case 'userpic-read': {
        const key = validKey(command.key)
        const row = db.prepare('SELECT mime, data FROM userpics WHERE key=?').get(key) as { mime: string; data: Buffer } | undefined
        if (!row) return null
        db.prepare('UPDATE userpics SET used_at=? WHERE key=?').run(this.now(), key)
        return { mime: row.mime, data: new Uint8Array(row.data) }
      }
      case 'userpic-write': {
        const key = validKey(command.key), data = Buffer.from(command.data)
        if (!mimes.has(command.mime) || !data.length || data.length > maxUserpicBytes) throw new Error('Invalid userpic')
        db.transaction(() => {
          db.prepare('INSERT OR REPLACE INTO userpics(key,mime,data,size,used_at) VALUES(?,?,?,?,?)').run(key, command.mime, data, data.length, this.now())
          this.evict(db)
        })()
        return null
      }
      case 'userpic-owners':
        return db.prepare('SELECT owner, raw FROM userpic_owners').all() as { owner: string; raw: string }[]
      case 'userpic-owner': {
        const owner = validOwner(command.owner)
        if (command.raw === null) db.prepare('DELETE FROM userpic_owners WHERE owner=?').run(owner)
        else db.transaction(() => {
          db.prepare('INSERT OR REPLACE INTO userpic_owners(owner,raw,confirmed_at) VALUES(?,?,?)').run(owner, validRaw(command.raw), this.now())
          const count = (db.prepare('SELECT COUNT(*) AS count FROM userpic_owners').get() as { count: number }).count
          if (count > maxOwners) db.prepare('DELETE FROM userpic_owners WHERE owner IN (SELECT owner FROM userpic_owners ORDER BY confirmed_at LIMIT ?)').run(count - maxOwners)
        })()
        return null
      }
      case 'userpic-usage':
        return (db.prepare('SELECT COALESCE(SUM(size),0) AS bytes FROM userpics').get() as { bytes: number }).bytes
      case 'userpic-clear':
        this.clear(); return null
    }
  }
  private evict(db: Database.Database): void {
    let { bytes, count } = db.prepare('SELECT COALESCE(SUM(size),0) AS bytes, COUNT(*) AS count FROM userpics').get() as { bytes: number; count: number }
    const oldest = db.prepare('SELECT key, size FROM userpics ORDER BY used_at, key LIMIT 64')
    const remove = db.prepare('DELETE FROM userpics WHERE key=?')
    while (bytes > this.limits.bytes || count > this.limits.entries) {
      const rows = oldest.all() as { key: string; size: number }[]
      if (!rows.length) break
      for (const row of rows) {
        if (bytes <= this.limits.bytes && count <= this.limits.entries) break
        remove.run(row.key); bytes -= row.size; count--
      }
    }
  }
  // Sign-out, a different account in the same folder, or «캐시 지우기». When the rows cannot be removed, the file goes.
  clear(): void {
    try {
      const db = this.open()
      db.exec('DELETE FROM userpics; DELETE FROM userpic_owners;')
      db.pragma('wal_checkpoint(TRUNCATE)'); db.exec('VACUUM')
    } catch {
      try { this.db?.close() } catch { /* Removed below. */ }
      this.db = null
      for (const part of [this.file, `${this.file}-wal`, `${this.file}-shm`]) rmSync(part, { force: true })
    }
  }
  close(): void {
    if (!this.db) return
    try { this.db.pragma('wal_checkpoint(TRUNCATE)') } catch { /* The file is a cache. */ }
    this.db.close(); this.db = null
  }
}
