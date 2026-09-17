import { createHash, createHmac, randomBytes } from 'node:crypto'
import type { UserpicCommand } from '../storage/userpic-cache-table'
import { maxUserpicBytes } from '../storage/userpic-cache-table'

// PeerData::userpicCloudImage is one picture that every list, box and profile paints. Here every surface that shows the
// same picture names it by the same address for this run of the app, so the window draws the image it already has
// instead of fetching it again under a new name. The address says nothing outside this run.
const runSecret = randomBytes(32)
export function photoToken(scope: string, raw: string): string {
  return createHmac('sha256', runSecret).update(scope).update('\n').update(raw).digest('hex').slice(0, 48)
}
export const userpicRoute = '__userpic'
export const userpicURL = (token: string): string => `morse://app/${userpicRoute}/${token}`

type Store = <T>(command: UserpicCommand) => Promise<T>
export type UserpicOwner = `user:${string}` | `group:${string}` | `channel:${string}`

// One account's cache of pictures already fetched (Storage::Cache::Database) and, for each person, the picture the
// server last confirmed this account may see. A list row shows that picture at once and replaces or hides it when the
// server answers, as Telegram draws a cached userpic before its peer data is refreshed.
export class UserpicCache {
  private owners = new Map<string, string>()
  private loaded = false
  private loading: Promise<void> | null = null
  private closed = false
  constructor(private readonly store: Store) {}

  static key(raw: string): string { return createHash('sha256').update(raw).digest('hex') }

  load(): Promise<void> {
    this.loading ??= this.store<{ owner: string; raw: string }[]>({ kind: 'userpic-owners' }).then(rows => {
      if (this.closed) return
      // A confirmation made while the rows were read is newer than the stored one.
      for (const row of rows) if (!this.owners.has(row.owner)) this.owners.set(row.owner, row.raw)
      this.loaded = true
    }).catch(() => { this.loaded = true })
    return this.loading
  }
  // The picture last confirmed for this person, or '' when none is known yet.
  known(owner: UserpicOwner): string { return this.loaded && !this.closed ? this.owners.get(owner) ?? '' : '' }
  confirm(owner: UserpicOwner, raw: string | null): void {
    if (this.closed || !this.loaded) return
    const next = raw || null
    if ((this.owners.get(owner) ?? null) === next) return
    if (next) this.owners.set(owner, next); else this.owners.delete(owner)
    void this.store({ kind: 'userpic-owner', owner, raw: next }).catch(() => {})
  }
  async read(raw: string, maxBytes = maxUserpicBytes): Promise<{ bytes: Buffer; mime: string } | null> {
    if (this.closed) return null
    try {
      const row = await this.store<{ mime: string; data: Uint8Array } | null>({ kind: 'userpic-read', key: UserpicCache.key(raw) })
      if (!row || this.closed || !row.data.byteLength || row.data.byteLength > maxBytes) return null
      return { bytes: Buffer.from(row.data.buffer, row.data.byteOffset, row.data.byteLength), mime: row.mime }
    } catch { return null }
  }
  write(raw: string, bytes: Buffer, mime: string): void {
    if (this.closed || !bytes.length || bytes.length > maxUserpicBytes) return
    void this.store({ kind: 'userpic-write', key: UserpicCache.key(raw), mime, data: new Uint8Array(bytes) }).catch(() => {})
  }
  usage(): Promise<number> { return this.closed ? Promise.resolve(0) : this.store<number>({ kind: 'userpic-usage' }).catch(() => 0) }
  async clear(): Promise<void> {
    if (this.closed) return
    this.owners.clear()
    await this.store({ kind: 'userpic-clear' }).catch(() => {})
  }
  close(): void { this.closed = true; this.owners.clear() }
}

// Loaders receive an account's credentials; the account's cache is found through them.
const caches = new WeakMap<object, UserpicCache>()
export function registerUserpicCache(credentials: object, cache: UserpicCache): void { caches.set(credentials, cache) }
export function userpicCacheFor(credentials: object): UserpicCache | null { return caches.get(credentials) ?? null }
