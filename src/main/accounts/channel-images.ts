import { maxDialogAvatars } from '../../shared/dialog-avatars'
import type { GroupPhotoImage } from '../../shared/group-photo'
import { backgroundImageInfo } from '../../shared/background-photo-bytes'
import type { ReadCredentials } from '../network/firestore-rpc'
import type { FirestoreDocument } from '../network/firestore-values'
import { storageBucket } from '../media/media-document'
import { tr } from '../../shared/i18n'
import { photoToken, userpicCacheFor } from './userpic-cache'
import { holdsImage, rememberedImage, rememberImage } from './userpic-images'

function photoRaw(doc: FirestoreDocument, field: 'photoURL' | 'coverURL'): string | null {
  const raw = doc.fields[field]?.stringValue
  return typeof raw === 'string' && raw.length > 0 && raw.length <= 10000 ? raw : null
}
function pathFor(raw: string, channelId: string, root: string): string | null {
  try {
    let path: string
    if (raw.startsWith(`gs://${storageBucket}/`)) path = raw.slice(storageBucket.length + 6)
    else {
      const url = new URL(raw), prefix = `/v0/b/${storageBucket}/o/`
      if (url.protocol !== 'https:' || url.hostname !== 'firebasestorage.googleapis.com' || url.port || url.username || url.password || url.hash || !url.pathname.startsWith(prefix)) return null
      path = decodeURIComponent(url.pathname.slice(prefix.length))
    }
    const parts = path.split('/')
    return path.length <= 1024 && parts.length === 3 && (parts[0] === root || (root === 'channel_photos' && parts[0] === 'channels')) && parts[1] === channelId &&
      parts.every(part => part && part !== '.' && part !== '..' && !/[\x00-\x1f\x7f\\?#]/.test(part)) ? path : null
  } catch { return null }
}
interface Entry { id: string; raw: string; token: string; abort: AbortController; started: boolean; bytes: Buffer | null; mime: string; value: GroupPhotoImage }
const idle = (): GroupPhotoImage => ({ status: 'idle', url: null, message: '' })

const kinds = {
  avatar: { field: 'photoURL', root: 'channel_photos', route: '__channel-avatar', entries: maxDialogAvatars, retained: 48, jobs: 2, bytes: 2 * 1024 * 1024, pixels: 4 * 1024 * 1024, label: tr('대표 사진') },
  cover: { field: 'coverURL', root: 'channel_covers', route: '__channel-cover', entries: 1, retained: 1, jobs: 1, bytes: 8 * 1024 * 1024, pixels: 8 * 1024 * 1024, label: tr('커버 사진') }
} as const
// The caller owns current channel metadata and scope; decorative images never grant post authority.
export class ChannelImages {
  private readonly options: typeof kinds[keyof typeof kinds]
  private readonly route: string
  private wanted: string[] = []
  // DialogAvatars (Telegram's userpic cache): photos that left the screen stay ready for a while, so a channel row
  // scrolled back or the channels tab opened again shows the same picture instead of loading it once more.
  private retained: string[] = []
  private entries = new Map<string, Entry>()
  private jobs = new Set<Promise<void>>()
  private closed = false
  constructor(private readonly auth: ReadCredentials, private readonly source: (id: string) => FirestoreDocument, private readonly changed: () => void, kind: keyof typeof kinds = 'avatar', private readonly surface: 'listed' | 'public-preview' = 'listed') { this.options = kinds[kind]; this.route = surface === 'public-preview' ? `__public-channel-${kind}` : this.options.route }
  snapshot(id: string): GroupPhotoImage | null {
    try {
      if (!photoRaw(this.source(id), this.options.field)) return null
      const entry = this.entries.get(id)
      if (!entry) return idle()
      this.validate(entry); return { ...entry.value }
    } catch { return null }
  }
  private validate(entry: Entry): void {
    this.auth.signal.throwIfAborted(); entry.abort.signal.throwIfAborted()
    // A picture stays drawn when its row scrolls away; only a changed or removed picture replaces it.
    if (this.closed || this.entries.get(entry.id) !== entry || photoRaw(this.source(entry.id), this.options.field) !== entry.raw) throw new Error('Channel photo source changed')
  }
  private release(entry: Entry): void { entry.abort.abort(); entry.bytes?.fill(0); entry.bytes = null; entry.value = idle() }
  setVisible(ids: string[]): void {
    if (this.closed) return
    this.wanted = [...new Set(ids)].slice(0, this.options.entries)
    this.retained = [...this.wanted, ...this.retained.filter(id => !this.wanted.includes(id))].slice(0, this.options.retained)
    this.prune(); this.changed()
  }
  prune(): void {
    if (this.closed) return
    for (const [id, entry] of this.entries) {
      // Kept while the picture is in memory, as Telegram keeps a row's userpic view; memory alone bounds it.
      if (!this.retained.includes(id) && !holdsImage(entry.raw)) { this.entries.delete(id); this.release(entry); continue }
      // A channel whose document is not known right now (its list being read again) keeps its picture; a photo
      // that changed or was removed replaces or drops it.
      let raw: string | null
      try { raw = photoRaw(this.source(id), this.options.field) } catch { continue }
      if (raw !== entry.raw) { this.entries.delete(id); this.release(entry) }
    }
    for (const id of this.wanted) {
      if (this.entries.has(id)) continue
      try {
        const raw = photoRaw(this.source(id), this.options.field)
        if (!raw) continue
        const entry: Entry = { id, raw, token: photoToken('picture', raw), abort: new AbortController(), started: false, bytes: null, mime: '', value: idle() }
        const held = rememberedImage(raw, { maxBytes: this.options.bytes, maxPixels: this.options.pixels })
        if (held) { entry.bytes = held.bytes; entry.mime = held.mime; entry.started = true; entry.value = { status: 'ready', url: `morse://app/${this.route}/${entry.token}`, message: '' } }
        this.entries.set(id, entry)
      } catch { /* Current channel metadata is required. */ }
    }
    this.pump()
  }
  private pump(): void {
    if (this.closed) return
    for (const id of this.wanted) {
      if (this.jobs.size >= this.options.jobs) break
      const entry = this.entries.get(id)
      if (!entry || entry.started) continue
      entry.started = true; entry.value = { status: 'loading', url: null, message: '' }
      const task = Promise.resolve().then(() => this.download(entry)).catch(() => {
        if (this.entries.get(id) !== entry || entry.abort.signal.aborted) return
        entry.bytes?.fill(0); entry.bytes = null
        entry.value = { status: 'error', url: null, message: tr('{0}을 표시하지 못했습니다. 다시 불러오거나 {1}를 새로고침해 주세요.', [this.options.label, this.surface === 'public-preview' ? tr('공개 채널 정보') : tr('채널 목록')]) }
      }).finally(() => { this.jobs.delete(task); if (!this.closed) { this.pump(); this.changed() } })
      this.jobs.add(task)
    }
  }
  private async download(entry: Entry): Promise<void> {
    this.validate(entry)
    const path = pathFor(entry.raw, entry.id, this.options.root)
    if (!path) throw new Error('Unsupported channel photo path')
    const signal = AbortSignal.any([this.auth.signal, entry.abort.signal, AbortSignal.timeout(45000)])
    // Storage::Cache: a picture fetched before this start comes from the account's cache file.
    const cache = userpicCacheFor(this.auth), stored = await cache?.read(entry.raw, this.options.bytes)
    if (stored) {
      try { signal.throwIfAborted(); this.validate(entry) } catch (error) { stored.bytes.fill(0); throw error }
      try {
        this.accept(entry, stored.bytes)
        rememberImage(entry.raw, entry.bytes!, entry.mime)
        entry.value = { status: 'ready', url: `morse://app/${this.route}/${entry.token}`, message: '' }
        return
      } catch { stored.bytes.fill(0); entry.bytes = null }
    }
    const authorization = await this.auth.authorize(signal, false)
    signal.throwIfAborted(); this.validate(entry)
    // channel_photos, legacy channels, and channel_covers permit public reads. Keep the
    // request account-owned and omit download-token/cache-version parameters.
    const response = await fetch(`https://firebasestorage.googleapis.com/v0/b/${storageBucket}/o/${encodeURIComponent(path)}?alt=media`, {
      signal, redirect: 'error', credentials: 'omit', cache: 'no-store',
      headers: { Authorization: `Firebase ${authorization.idToken}`, 'X-Firebase-AppCheck': authorization.appCheckToken }
    })
    const limit = this.options.bytes, header = response.headers.get('content-length'), size = header === null ? null : Number(header)
    if (response.status !== 200 || !response.body || (size !== null && (!Number.isSafeInteger(size) || size <= 0 || size > limit))) {
      await response.body?.cancel(); throw new Error('Invalid channel photo response')
    }
    const reader = response.body.getReader(), chunks: Buffer[] = []
    let total = 0
    try {
      while (true) {
        const part = await reader.read(); signal.throwIfAborted(); this.validate(entry)
        if (part.done) break
        total += part.value.byteLength
        if (total > limit) throw new Error('Channel photo too large')
        chunks.push(Buffer.from(part.value))
      }
      if (!total || (size !== null && size !== total)) throw new Error('Incomplete channel photo')
      const joined = Buffer.concat(chunks, total)
      try { this.accept(entry, joined) } catch (error) { joined.fill(0); throw error }
      signal.throwIfAborted(); this.validate(entry)
      cache?.write(entry.raw, entry.bytes!, entry.mime); rememberImage(entry.raw, entry.bytes!, entry.mime)
      entry.value = { status: 'ready', url: `morse://app/${this.route}/${entry.token}`, message: '' }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); chunks.forEach(chunk => chunk.fill(0)) }
  }
  private accept(entry: Entry, bytes: Buffer): void {
    const info = backgroundImageInfo(bytes)
    if (bytes.length > this.options.bytes || info.width * info.height > this.options.pixels) throw new Error('Channel photo dimensions too large')
    entry.bytes = bytes; entry.mime = info.type
  }
  response(token: string, request: Request): Response {
    try {
      const entry = [...this.entries.values()].find(entry => entry.token === token)
      if (!entry?.bytes || entry.value.status !== 'ready' || !['GET', 'HEAD'].includes(request.method)) throw new Error('Unavailable channel photo')
      this.validate(entry)
      return new Response(request.method === 'HEAD' ? null : new Uint8Array(entry.bytes), { headers: {
        'Content-Type': entry.mime, 'Content-Length': String(entry.bytes.length), 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox"
      } })
    } catch { return new Response(null, { status: 403 }) }
  }
  clear(): void { this.wanted = []; this.retained = []; for (const entry of this.entries.values()) this.release(entry); this.entries.clear() }
  close(): void { this.closed = true; this.clear() }
}
