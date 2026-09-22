import { createHash } from 'node:crypto'
import type { MediaCacheCommand } from '../storage/media-cache-table'
import { maxMediaEntryBytes } from '../storage/media-cache-table'

type Store = <T>(command: MediaCacheCommand) => Promise<T>

// FileLoader::tryLoadLocal(): before a request goes out, the loader asks the account's cache for the object, and a hit
// finishes the load without touching the network. Here every picture, video and file of a chat or a channel post is
// looked up by the object it is (its storage path) and written back after it has been fetched, so opening the same
// media again — after scrolling, after reopening the window, after a restart — draws it at once.
export class MediaCache {
  private closed = false
  constructor(private readonly store: Store) {}

  static key(path: string): string { return createHash('sha256').update(path).digest('hex') }

  async read(path: string, maxBytes = maxMediaEntryBytes): Promise<Buffer | null> {
    if (this.closed || !path) return null
    try {
      const data = await this.store<Uint8Array | null>({ kind: 'media-cache-read', key: MediaCache.key(path) })
      if (!data || this.closed || !data.byteLength || data.byteLength > maxBytes) return null
      return Buffer.from(data.buffer, data.byteOffset, data.byteLength)
    } catch { return null }
  }
  write(path: string, bytes: Buffer): void {
    if (this.closed || !path || !bytes.length || bytes.length > maxMediaEntryBytes) return
    void this.store({ kind: 'media-cache-write', key: MediaCache.key(path), data: new Uint8Array(bytes) }).catch(() => {})
  }
  usage(): Promise<number> { return this.closed ? Promise.resolve(0) : this.store<number>({ kind: 'media-cache-usage' }).catch(() => 0) }
  async clear(): Promise<void> {
    if (this.closed) return
    await this.store({ kind: 'media-cache-clear' }).catch(() => {})
  }
  close(): void { this.closed = true }
}

// Loaders receive an account's credentials; the account's cache is found through them, as every loader reaches
// Main::Account::cache() through its session.
const caches = new WeakMap<object, MediaCache>()
export function registerMediaCache(credentials: object, cache: MediaCache): void { caches.set(credentials, cache) }
export function mediaCacheFor(credentials: object): MediaCache | null { return caches.get(credentials) ?? null }
