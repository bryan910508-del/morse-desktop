import { nativeImage } from 'electron'
import { randomUUID } from 'node:crypto'
import type { MediaRequest } from '../../shared/media'
import type { ReadCredentials } from '../network/firestore-rpc'
import { downloadMedia } from './download-media'
import { recordPhotoStep } from '../platform/photo-diagnostics'
import type { MediaResource } from './media-document'

// Telegram shows a received photo inside the bubble without being asked for it (Settings >
// Advanced > Automatic media download). Morse keeps no small size or blurred placeholder for a
// photo, so the picture itself is fetched, held for the messages on screen, and served over
// morse://app/__photo-preview. Unlike MediaSession, which owns one explicit selection at a time,
// several previews live here at once; a picture too large for a preview stays a press away.
//
// Telegram draws the stripped placeholder that travels inside a message, and when a message has
// none it asks the server for the small size whatever the automatic download preference says
// (history_view_photo.cpp, Photo::dataMediaCreated: wanted(PhotoSize::Small) guarded only by an
// empty inlineThumbnailBytes). Morse keeps no small size, so the picture itself is fetched, a 32px
// placeholder is kept, and the picture is dropped again - the preference decides whether the full
// picture stays to be shown sharp, never whether a photo shows at all.
const maxPreviewBytes = 4 * 1024 * 1024, maxPreviews = 24, maxThumbs = 300, maxThumbChars = 8000

interface Preview { token: string; bytes: Buffer; mime: string }
function imageMime(bytes: Buffer): string | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg'
  if (['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'))) return 'image/gif'
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  return null
}

export class PhotoPreviews {
  private readonly ready = new Map<string, Preview>()
  private readonly thumbs = new Map<string, string>()
  private readonly loading = new Map<string, Promise<string | null>>()
  private closed = false

  constructor(private readonly credentials: ReadCredentials,
    private readonly resolve: (chatId: string, request: MediaRequest) => MediaResource | null) {}

  private static key(chatId: string, request: MediaRequest): string {
    return JSON.stringify([chatId, request.messageId, request.version, request.index])
  }

  // Reading stays free of side effects: a publish may pass through here.
  url(chatId: string, request: MediaRequest): string | null {
    const preview = this.closed ? undefined : this.ready.get(PhotoPreviews.key(chatId, request))
    return preview ? `morse://app/__photo-preview/${preview.token}` : null
  }
  thumb(chatId: string, request: MediaRequest): string | null {
    return (this.closed ? undefined : this.thumbs.get(PhotoPreviews.key(chatId, request))) ?? null
  }

  // One picture for one message of the open room. The caller decides whether to ask at all, which
  // is where the preference lives; a refusal here is silent, and the message keeps its tile.
  async load(chatId: string, request: MediaRequest): Promise<string | null> {
    if (this.closed) return null
    const key = PhotoPreviews.key(chatId, request)
    const held = this.url(chatId, request)
    if (held) return held
    const running = this.loading.get(key)
    if (running) return running
    const task = this.download(key, chatId, request).finally(() => { if (this.loading.get(key) === task) this.loading.delete(key) })
    this.loading.set(key, task)
    return task
  }

  // The placeholder for a message that carried none. The picture is fetched once, shrunk, and let
  // go again; what stays is a few hundred bytes the bubble draws blurred, as Telegram draws the
  // small size when a message has no stripped thumbnail of its own.
  async loadThumb(chatId: string, request: MediaRequest): Promise<string | null> {
    if (this.closed) return null
    const key = PhotoPreviews.key(chatId, request)
    const held = this.thumbs.get(key)
    if (held) return held
    const running = this.loading.get(`thumb ${key}`)
    if (running) return running
    const task = this.shrink(key, chatId, request).finally(() => { if (this.loading.get(`thumb ${key}`) === task) this.loading.delete(`thumb ${key}`) })
    this.loading.set(`thumb ${key}`, task)
    return task
  }
  private async shrink(key: string, chatId: string, request: MediaRequest): Promise<string | null> {
    const bytes = await this.fetch(chatId, request)
    if (!bytes) return null
    const thumb = this.remember(key, bytes)
    bytes.fill(0)
    return thumb
  }
  // A placeholder is kept, never the picture it came from: 32px of it, as a JPEG, base64 for the
  // bubble. A picture this reader cannot shrink simply keeps its tile.
  private remember(key: string, bytes: Buffer): string | null {
    if (this.closed || this.thumbs.has(key)) return this.thumbs.get(key) ?? null
    let thumb: string
    try { thumb = nativeImage.createFromBuffer(bytes).resize({ width: 32, quality: 'good' }).toJPEG(50).toString('base64') }
    catch { recordPhotoStep('thumb-failed', 'resize'); return null }
    if (!thumb || thumb.length > maxThumbChars) {
      recordPhotoStep('thumb-unusable', thumb ? `chars-${thumb.length}` : 'empty')
      return null
    }
    while (this.thumbs.size >= maxThumbs) {
      const oldest = this.thumbs.keys().next()
      if (oldest.done) break
      this.thumbs.delete(oldest.value)
    }
    this.thumbs.set(key, thumb)
    recordPhotoStep('thumb-ready', `chars-${thumb.length}`)
    return thumb
  }
  private async download(key: string, chatId: string, request: MediaRequest): Promise<string | null> {
    const bytes = await this.fetch(chatId, request)
    if (!bytes) return null
    // Keeping the placeholder as well means turning automatic download off later still shows this
    // photo, and costs nothing: the picture is already here.
    this.remember(key, bytes)
    const mime = imageMime(bytes)
    if (this.closed || !mime) { bytes.fill(0); return null }
    recordPhotoStep('preview-ready', `${mime} ${bytes.length}`)
    // The oldest preview leaves once the room has more pictures than the window keeps.
    while (this.ready.size >= maxPreviews) {
      const oldest = this.ready.keys().next()
      if (oldest.done) break
      this.forget(oldest.value)
    }
    const preview: Preview = { token: randomUUID(), bytes, mime }
    this.ready.set(key, preview)
    return `morse://app/__photo-preview/${preview.token}`
  }
  private async fetch(chatId: string, request: MediaRequest): Promise<Buffer | null> {
    const resource = this.resolve(chatId, request)
    if (!resource?.path || !resource.summary.available || resource.summary.blind || resource.summary.kind !== 'image') {
      recordPhotoStep('preview-skipped', !resource ? 'no-resource' : !resource.path ? 'no-path'
        : !resource.summary.available ? 'unavailable' : resource.summary.blind ? 'blind' : `kind-${resource.summary.kind}`)
      return null
    }
    let bytes: Buffer
    try {
      bytes = await downloadMedia(this.credentials, resource, this.credentials.signal,
        () => { if (this.closed || this.resolve(chatId, request)?.path !== resource.path) throw new Error('Preview target changed') },
        () => {}, maxPreviewBytes)
    } catch (error) {
      // A picture over the preview cap lands here too; it stays one press away.
      recordPhotoStep('preview-failed', error instanceof Error ? error.message.slice(0, 60) : 'unknown')
      return null
    }
    if (this.closed || !imageMime(bytes)) {
      recordPhotoStep('preview-unreadable', this.closed ? 'closed' : `bytes-${bytes.length}`)
      bytes.fill(0); return null
    }
    return bytes
  }

  private forget(key: string): void {
    const preview = this.ready.get(key)
    if (!preview) return
    this.ready.delete(key)
    preview.bytes.fill(0)
  }

  response(token: string, request: Request): Response {
    if (this.closed || !['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 403 })
    const preview = [...this.ready.values()].find(value => value.token === token)
    if (!preview) return new Response(null, { status: 403 })
    return new Response(request.method === 'HEAD' ? null : new Uint8Array(preview.bytes), { headers: {
      'Content-Type': preview.mime, 'Content-Length': String(preview.bytes.length), 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" } })
  }

  clear(): void { for (const key of [...this.ready.keys()]) this.forget(key); this.thumbs.clear() }
  close(): void { this.closed = true; this.clear(); this.loading.clear() }
}
