import type Database from 'better-sqlite3-multiple-ciphers'
import { chmodSync, existsSync, rmSync } from 'node:fs'
import { openEncryptedDatabase } from './encrypted-database'

// The account's file cache (tdesktop Main::Account::cachePath / cacheSettings, Storage::Cache::Database). A picture,
// video or file already fetched is kept here, sealed with the same local key, so opening it again draws it without
// asking the server: FileLoader::start() calls tryLoadLocal() first and finishes there on a hit. The defaults are the
// ones Telegram ships (Settings: totalSizeLimit 1 GB, totalTimeLimit one month, clearOnWrongKey), and the file holds
// only copies of objects the server already sent to this account.
export type MediaCacheCommand =
  | { kind: 'media-cache-read'; key: string }
  | { kind: 'media-cache-write'; key: string; data: Uint8Array }
  | { kind: 'media-cache-usage' }
  | { kind: 'media-cache-clear' }

export const maxMediaCacheBytes = 1024 * 1024 * 1024
export const maxMediaCacheEntries = 20000
export const maxMediaCacheAge = 31 * 24 * 60 * 60 * 1000
export const maxMediaEntryBytes = 50 * 1024 * 1024

const validKey = (key: unknown): string => {
  if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid media cache key')
  return key
}

export class MediaCacheStore {
  private db: Database.Database | null = null
  constructor(private readonly file: string, private readonly key: string, private readonly now: () => number = Date.now,
    private readonly limits = { bytes: maxMediaCacheBytes, entries: maxMediaCacheEntries, age: maxMediaCacheAge }) {}

  private open(): Database.Database {
    if (this.db) return this.db
    let db: Database.Database
    try { db = this.prepare() }
    catch {
      // clearOnWrongKey: a cache that cannot be opened holds nothing that cannot be fetched again.
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
      db.exec(`CREATE TABLE IF NOT EXISTS media_files (key TEXT PRIMARY KEY, data BLOB NOT NULL, size INTEGER NOT NULL, used_at INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS media_files_used ON media_files(used_at);`)
      return db
    } catch (error) { db.close(); throw error }
  }

  execute(command: MediaCacheCommand): unknown {
    const db = this.open()
    switch (command.kind) {
      case 'media-cache-read': {
        const key = validKey(command.key), stale = this.now() - this.limits.age
        const row = db.prepare('SELECT data, used_at FROM media_files WHERE key=?').get(key) as { data: Buffer; used_at: number } | undefined
        if (!row) return null
        // totalTimeLimit: an entry older than a month is treated as absent and removed.
        if (row.used_at < stale) { db.prepare('DELETE FROM media_files WHERE key=?').run(key); return null }
        db.prepare('UPDATE media_files SET used_at=? WHERE key=?').run(this.now(), key)
        return new Uint8Array(row.data)
      }
      case 'media-cache-write': {
        const key = validKey(command.key), data = Buffer.from(command.data)
        if (!data.length || data.length > maxMediaEntryBytes) throw new Error('Invalid media cache entry')
        db.transaction(() => {
          db.prepare('INSERT OR REPLACE INTO media_files(key,data,size,used_at) VALUES(?,?,?,?)').run(key, data, data.length, this.now())
          this.evict(db)
        })()
        return null
      }
      case 'media-cache-usage':
        return (db.prepare('SELECT COALESCE(SUM(size),0) AS bytes FROM media_files').get() as { bytes: number }).bytes
      case 'media-cache-clear':
        this.clear(); return null
    }
  }
  private evict(db: Database.Database): void {
    db.prepare('DELETE FROM media_files WHERE used_at < ?').run(this.now() - this.limits.age)
    let { bytes, count } = db.prepare('SELECT COALESCE(SUM(size),0) AS bytes, COUNT(*) AS count FROM media_files').get() as { bytes: number; count: number }
    const oldest = db.prepare('SELECT key, size FROM media_files ORDER BY used_at, key LIMIT 64')
    const remove = db.prepare('DELETE FROM media_files WHERE key=?')
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
      db.exec('DELETE FROM media_files;')
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
