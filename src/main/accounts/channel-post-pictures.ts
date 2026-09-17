import { randomUUID } from 'node:crypto'
import type { ChannelHomeImage } from '../../shared/channel-home'
import { backgroundImageInfo } from '../../shared/background-photo-bytes'
import type { ReadCredentials } from '../network/firestore-rpc'
import { downloadChannelPostMedia } from '../network/channel-post-media'

// The pictures of channel posts: the first one of every post in the channel tab's feed, and the ones a post shows in
// the channel itself. storage.rules reads of channel_posts and channel_video_thumbs are authorizedMediaRead, so every
// one goes through the grant an opened post uses. A picture is held only while its post is on a screen.
interface ImageEntry { key: string; path: string; video: boolean; postId: string; token: string; abort: AbortController; started: boolean; bytes: Buffer | null; mime: string; value: ChannelHomeImage }
const idleImage = (video: boolean): ChannelHomeImage => ({ status: 'idle', url: null, width: 0, height: 0, video })
const maxImageBytes = 4 * 1024 * 1024, maxImagePixels = 50 * 1024 * 1024

// ChannelFeedTimelineCachedImage: the first picture of each post in the feed, read like channel photos
// and served to the window only while the channel tab is open.
export class ChannelPostPictures {
  private wanted: string[] = []
  private entries = new Map<string, ImageEntry>()
  private jobs = new Set<Promise<void>>()
  private closed = false
  constructor(private readonly auth: ReadCredentials, private readonly source: (key: string) => { path: string; video: boolean; postId: string },
    private readonly changed: () => void, private readonly route: '__channel-home-image' | '__channel-post-picture' = '__channel-home-image') {}
  snapshot(key: string): ChannelHomeImage | null {
    try {
      const source = this.source(key), entry = this.entries.get(key)
      if (!entry || entry.path !== source.path) return idleImage(source.video)
      return { ...entry.value }
    } catch { return null }
  }
  private validate(entry: ImageEntry): void {
    this.auth.signal.throwIfAborted(); entry.abort.signal.throwIfAborted()
    if (this.closed || this.entries.get(entry.key) !== entry || !this.wanted.includes(entry.key) || this.source(entry.key).path !== entry.path) throw new Error('Post picture changed')
  }
  private release(entry: ImageEntry): void { entry.abort.abort(); entry.bytes?.fill(0); entry.bytes = null }
  setWanted(keys: string[]): void { if (this.closed) return; this.wanted = [...new Set(keys)]; this.prune() }
  prune(): void {
    if (this.closed) return
    const sources = new Map<string, { path: string; video: boolean; postId: string }>()
    for (const key of this.wanted) { try { sources.set(key, this.source(key)) } catch { /* no picture */ } }
    for (const [key, entry] of this.entries) if (sources.get(key)?.path !== entry.path) { this.entries.delete(key); this.release(entry) }
    for (const [key, source] of sources) if (!this.entries.has(key)) {
      this.entries.set(key, { key, ...source, token: randomUUID(), abort: new AbortController(), started: false, bytes: null, mime: '', value: idleImage(source.video) })
    }
    this.pump()
  }
  private pump(): void {
    if (this.closed) return
    for (const key of this.wanted) {
      if (this.jobs.size >= 2) break
      const entry = this.entries.get(key)
      if (!entry || entry.started) continue
      entry.started = true; entry.value = { ...idleImage(entry.video), status: 'loading' }
      const task = Promise.resolve().then(() => this.download(entry)).catch(() => {
        if (this.entries.get(key) !== entry || entry.abort.signal.aborted) return
        entry.bytes?.fill(0); entry.bytes = null; entry.value = { ...idleImage(entry.video), status: 'error' }
      }).finally(() => { this.jobs.delete(task); if (!this.closed) { this.pump(); this.changed() } })
      this.jobs.add(task)
    }
  }
  // storage.rules channel_posts/channel_video_thumbs: read is authorizedMediaRead(fileName), so the picture of a post
  // is read through the same grant the opened post uses (authorizeMorseMediaRead). Without it Storage refuses, and the
  // feed drew «첨부 N개» where the picture belongs.
  private async download(entry: ImageEntry): Promise<void> {
    this.validate(entry)
    const signal = AbortSignal.any([this.auth.signal, entry.abort.signal, AbortSignal.timeout(45000)])
    const bytes = await downloadChannelPostMedia(this.auth, entry.path, entry.postId, signal, () => this.validate(entry), maxImageBytes, () => {})
    try {
      const info = backgroundImageInfo(bytes)
      if (info.width * info.height > maxImagePixels) throw new Error('Post picture dimensions too large')
      signal.throwIfAborted(); this.validate(entry)
      entry.bytes = bytes; entry.mime = info.type
      entry.value = { status: 'ready', url: `morse://app/${this.route}/${entry.token}`, width: info.width, height: info.height, video: entry.video }
    } catch (error) { bytes.fill(0); throw error }
  }
  response(token: string, request: Request): Response {
    try {
      const entry = [...this.entries.values()].find(item => item.token === token)
      if (!entry?.bytes || entry.value.status !== 'ready' || !['GET', 'HEAD'].includes(request.method)) throw new Error('Unavailable post picture')
      this.validate(entry)
      return new Response(request.method === 'HEAD' ? null : new Uint8Array(entry.bytes), { headers: {
        'Content-Type': entry.mime, 'Content-Length': String(entry.bytes.length), 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox"
      } })
    } catch { return new Response(null, { status: 403 }) }
  }
  clear(): void { this.wanted = []; for (const entry of this.entries.values()) this.release(entry); this.entries.clear() }
  close(): void { this.closed = true; this.clear() }
}
