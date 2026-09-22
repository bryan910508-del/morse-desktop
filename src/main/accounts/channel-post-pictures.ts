import type { ChannelHomeImage } from '../../shared/channel-home'
import { backgroundImageInfo } from '../../shared/background-photo-bytes'
import type { ReadCredentials } from '../network/firestore-rpc'
import { downloadChannelPostMedia } from '../network/channel-post-media'
import { photoToken } from './userpic-cache'
import { holdsImage, rememberedImage, rememberImage } from './userpic-images'
import { mediaCacheFor } from './media-cache'

// The pictures of channel posts: the first one of every post in the channel tab's feed, and the ones a post shows in
// the channel itself. storage.rules reads of channel_posts and channel_video_thumbs are authorizedMediaRead, so every
// one goes through the grant an opened post uses.
// Like Data::PhotoMedia a picture that has been drawn keeps its bytes for this run of the app, and like every other
// file it is kept in the account's cache (Storage::Cache::Database) as well, so a post scrolling back into the list,
// a channel opened again, or a restart draws it without fetching it a second time. Each picture has one address for
// this run, so the window itself keeps drawing what it already has.
// What a picture is: the object to read (the post's 480px preview when it carries one), and what to draw meanwhile.
export interface PictureSource { path: string; video: boolean; postId: string; blur: string; width: number; height: number }
interface ImageEntry { key: string; path: string; video: boolean; postId: string; blur: string; width: number; height: number; token: string; abort: AbortController; started: boolean; value: ChannelHomeImage }
// A picture already shown: what its address stands for, so the window may draw it again at any time this run.
interface DrawnPicture { path: string; mime: string; width: number; height: number }
const idleImage = (source: { video: boolean; blur?: string; width?: number; height?: number }): ChannelHomeImage =>
  ({ status: 'idle', url: null, width: source.width ?? 0, height: source.height ?? 0, video: source.video, blur: source.blur ?? '' })
const maxImageBytes = 4 * 1024 * 1024, maxImagePixels = 50 * 1024 * 1024
const maxDrawnPictures = 512
const displayLimits = { maxBytes: maxImageBytes, maxPixels: maxImagePixels }

// ChannelFeedTimelineCachedImage: the first picture of each post in the feed, read like channel photos
// and served to the window only while the channel tab is open.
export class ChannelPostPictures {
  private wanted: string[] = []
  private entries = new Map<string, ImageEntry>()
  private drawn = new Map<string, DrawnPicture>()
  private jobs = new Set<Promise<void>>()
  private closed = false
  constructor(private readonly auth: ReadCredentials, private readonly source: (key: string) => PictureSource,
    private readonly changed: () => void, private readonly route: '__channel-home-image' | '__channel-post-picture' = '__channel-home-image') {}
  snapshot(key: string): ChannelHomeImage | null {
    try {
      const source = this.source(key), entry = this.entries.get(key)
      if (!entry || entry.path !== source.path) return idleImage(source)
      return { ...entry.value }
    } catch { return null }
  }
  private validate(entry: ImageEntry): void {
    this.auth.signal.throwIfAborted(); entry.abort.signal.throwIfAborted()
    if (this.closed || this.entries.get(entry.key) !== entry || !this.wanted.includes(entry.key) || this.source(entry.key).path !== entry.path) throw new Error('Post picture changed')
  }
  private release(entry: ImageEntry): void { entry.abort.abort() }
  setWanted(keys: string[]): void { if (this.closed) return; this.wanted = [...new Set(keys)]; this.prune() }
  prune(): void {
    if (this.closed) return
    const sources = new Map<string, PictureSource>()
    for (const key of this.wanted) { try { sources.set(key, this.source(key)) } catch { /* no picture */ } }
    for (const [key, entry] of this.entries) if (sources.get(key)?.path !== entry.path) { this.entries.delete(key); this.release(entry) }
    for (const [key, source] of sources) if (!this.entries.has(key)) {
      const token = photoToken('post-picture', source.path)
      const entry: ImageEntry = { key, ...source, token, abort: new AbortController(), started: false, value: idleImage(source) }
      // PhotoMedia: a picture still in memory is drawn in the same frame, without a read of any kind.
      const shown = this.drawn.get(token)
      if (shown && shown.path === source.path && holdsImage(source.path)) {
        entry.started = true
        entry.value = { status: 'ready', url: `morse://app/${this.route}/${token}`, width: shown.width, height: shown.height, video: source.video, blur: source.blur }
      }
      this.entries.set(key, entry)
    }
    this.pump()
  }
  private pump(): void {
    if (this.closed) return
    for (const key of this.wanted) {
      if (this.jobs.size >= 2) break
      const entry = this.entries.get(key)
      if (!entry || entry.started) continue
      entry.started = true; entry.value = { ...idleImage(entry), status: 'loading' }
      const task = Promise.resolve().then(() => this.download(entry)).catch(() => {
        if (this.entries.get(key) !== entry || entry.abort.signal.aborted) return
        entry.value = { ...idleImage(entry), status: 'error' }
      }).finally(() => { this.jobs.delete(task); if (!this.closed) { this.pump(); this.changed() } })
      this.jobs.add(task)
    }
  }
  // storage.rules channel_posts/channel_video_thumbs: read is authorizedMediaRead(fileName), so the picture of a post
  // is read through the same grant the opened post uses (authorizeMorseMediaRead). Without it Storage refuses, and the
  // feed drew «첨부 N개» where the picture belongs.
  private async download(entry: ImageEntry): Promise<void> {
    this.validate(entry)
    // FileLoader::tryLoadLocal(): what this account already has is never fetched again.
    const cache = mediaCacheFor(this.auth), stored = await cache?.read(entry.path, maxImageBytes)
    if (stored) {
      try { this.validate(entry) } catch (error) { stored.fill(0); throw error }
      try { this.accept(entry, stored); return } catch { stored.fill(0) /* An unusable copy is fetched again. */ }
    }
    const signal = AbortSignal.any([this.auth.signal, entry.abort.signal, AbortSignal.timeout(45000)])
    const bytes = await downloadChannelPostMedia(this.auth, entry.path, entry.postId, signal, () => this.validate(entry), maxImageBytes, () => {})
    try {
      signal.throwIfAborted(); this.validate(entry)
      this.accept(entry, bytes)
      cache?.write(entry.path, bytes)
    } catch (error) { bytes.fill(0); throw error }
  }
  // The same size check whether the picture was downloaded or read from memory or from the cache file.
  private accept(entry: ImageEntry, bytes: Buffer): void {
    const info = backgroundImageInfo(bytes)
    if (info.width * info.height > maxImagePixels) throw new Error('Post picture dimensions too large')
    rememberImage(entry.path, bytes, info.type)
    this.drawn.delete(entry.token)
    this.drawn.set(entry.token, { path: entry.path, mime: info.type, width: info.width, height: info.height })
    while (this.drawn.size > maxDrawnPictures) {
      const oldest = this.drawn.keys().next().value!
      if (oldest === entry.token) break
      this.drawn.delete(oldest)
    }
    entry.value = { status: 'ready', url: `morse://app/${this.route}/${entry.token}`, width: info.width, height: info.height, video: entry.video, blur: entry.blur }
  }
  async response(token: string, request: Request): Promise<Response> {
    try {
      const shown = this.drawn.get(token)
      if (this.closed || !shown || !['GET', 'HEAD'].includes(request.method)) throw new Error('Unavailable post picture')
      const held = rememberedImage(shown.path, displayLimits) ?? await this.stored(shown)
      if (!held) throw new Error('Unavailable post picture')
      return new Response(request.method === 'HEAD' ? null : new Uint8Array(held.bytes), { headers: {
        'Content-Type': held.mime, 'Content-Length': String(held.bytes.length), 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox"
      } })
    } catch { return new Response(null, { status: 403 }) }
  }
  // A picture the memory store had to give up is read back from the account's cache file, so its address keeps working.
  private async stored(shown: DrawnPicture): Promise<{ bytes: Buffer; mime: string } | null> {
    const bytes = await mediaCacheFor(this.auth)?.read(shown.path, maxImageBytes)
    if (!bytes) return null
    if (this.closed || !this.drawn.has(photoToken('post-picture', shown.path))) { bytes.fill(0); return null }
    try {
      const info = backgroundImageInfo(bytes)
      if (info.width * info.height > maxImagePixels) throw new Error('Post picture dimensions too large')
      rememberImage(shown.path, bytes, info.type)
      return { bytes, mime: info.type }
    } catch { bytes.fill(0); return null }
  }
  clear(): void { this.wanted = []; for (const entry of this.entries.values()) this.release(entry); this.entries.clear() }
  close(): void { this.closed = true; this.clear(); this.drawn.clear() }
}
