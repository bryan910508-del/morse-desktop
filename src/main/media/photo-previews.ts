import { nativeImage } from 'electron'
import { randomUUID } from 'node:crypto'
import type { MediaRequest } from '../../shared/media'
import type { ReadCredentials } from '../network/firestore-rpc'
import { downloadMedia } from './download-media'
import { recordPhotoStep } from '../platform/photo-diagnostics'
import type { MediaResource } from './media-document'
import type { MediaCache } from '../accounts/media-cache'

// Telegram shows a received photo inside the bubble without being asked for it (Settings >
// Advanced > Automatic media download). Morse keeps no small size or blurred placeholder for a
// photo, so the picture itself is fetched, held for the messages on screen, and served over
// morse://app/__photo-preview. Unlike MediaSession, which owns one explicit selection at a time,
// several previews live here at once; a picture too large for a preview stays a press away.
//
// Telegram draws the stripped placeholder that travels inside a message, and when a message has
// none it asks the server for the small size whatever the automatic download preference says
// (history_view_photo.cpp, Photo::dataMediaCreated: wanted(PhotoSize::Small) guarded only by an
// empty inlineThumbnailBytes). That costs about ten kilobytes there. Morse has no small size, so the
// only way to make a placeholder is to fetch the whole picture — which is the very thing the
// automatic download limit exists to hold back, and doing it anyway spent a person's data on photos
// they had asked not to receive. So nothing is fetched for a placeholder: what is kept here comes
// from a picture that was fetched to be shown, and outlives it once the previews are evicted.
//
// The size of one picture and the size of the whole cache are separate limits in Telegram, and only
// the second one is about memory: Storage::Cache::Settings keeps `maxDataSize = kDataSizeLimit - 1`
// (an entry's length is three bytes, so 16 MiB) for a single entry and `totalSizeLimit` for
// everything together. A count of pictures was standing in for the second limit here, and the first
// one was 4 MB - under the size of an ordinary phone photograph, so such a photo was refused, no
// placeholder was kept either, and the bubble showed an icon where the picture should be.
const maxPreviewBytes = 16 * 1024 * 1024 - 1, previewBudget = 96 * 1024 * 1024, maxPreviews = 24, maxThumbs = 300, maxThumbChars = 8000

interface Preview { token: string; bytes: Buffer; mime: string }
function imageMime(bytes: Buffer): string | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg'
  if (['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'))) return 'image/gif'
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  return null
}

// A sticker may also be an MP4 (iOS MorseStickerLibrary kinds png · gif · mp4).
function previewMime(bytes: Buffer, sticker: boolean): string | null {
  const image = imageMime(bytes)
  if (image || !sticker) return image
  return bytes.length >= 12 && bytes.subarray(4, 8).toString('ascii') === 'ftyp' ? 'video/mp4' : null
}
export class PhotoPreviews {
  private readonly ready = new Map<string, Preview>()
  private readonly thumbs = new Map<string, string>()
  private readonly loading = new Map<string, Promise<string | null>>()
  private held = 0
  private closed = false

  // B359: `cache` is the account's encrypted disk cache (MediaCache — the one opened media, files and channel pictures
  // use). This class keeps only the pictures on screen; the disk keeps what was fetched, so a restart, a lock, a
  // reconnection or a long scroll draws it again without asking the server.
  constructor(private readonly credentials: ReadCredentials,
    private readonly resolve: (chatId: string, request: MediaRequest) => MediaResource | null,
    private readonly cache: Pick<MediaCache, 'read' | 'write'> | null = null) {}

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
  // `limit` is what the person's automatic download setting allows for this room (Data::AutoDownload's
  // bytes limit for the peer's source); a picture they asked for themselves comes with none and is
  // held only by what a preview can keep.
  async load(chatId: string, request: MediaRequest, limit = maxPreviewBytes): Promise<string | null> {
    // A limit of zero is off (SetDisabledForSource): nothing is asked of the server — but what this device keeps is
    // still shown (B359, tdesktop PhotoMedia::automaticLoad LoadFromLocalOnly, data_photo_media.cpp:173-186).
    if (this.closed) return null
    const key = PhotoPreviews.key(chatId, request)
    const held = this.url(chatId, request)
    if (held) return held
    const running = this.loading.get(key)
    if (running) return running
    const task = this.download(key, chatId, request, limit).finally(() => { if (this.loading.get(key) === task) this.loading.delete(key) })
    this.loading.set(key, task)
    return task
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
  // B252: a sticker bubble's picture, held here beside the photos' — every bubble of a room at once, each under its own
  // message (tdesktop gives each Sticker view its own media view: history_view_sticker.cpp:566-575, loaded by
  // checkStickerLarge :190). It came through the attachment viewer's single slot before (MediaSession), which refuses
  // a second open while one downloads, so only the first sticker of a room was drawn. An MP4 one plays as video.
  async loadSticker(chatId: string, request: MediaRequest): Promise<{ url: string; video: boolean } | null> {
    const url = await this.load(chatId, request)
    const preview = url ? this.ready.get(PhotoPreviews.key(chatId, request)) : undefined
    return url && preview ? { url, video: preview.mime === 'video/mp4' } : null
  }
  private async download(key: string, chatId: string, request: MediaRequest, limit: number): Promise<string | null> {
    const resource = this.resolve(chatId, request), sticker = resource?.summary.kind === 'sticker'
    const bytes = await this.fetch(chatId, request, limit)
    if (!bytes) return null
    // Keeping the placeholder as well means turning automatic download off later still shows this
    // photo, and costs nothing: the picture is already here. A sticker keeps none (it is drawn whole or not at all).
    if (!sticker) this.remember(key, bytes)
    const mime = previewMime(bytes, sticker)
    if (this.closed || !mime) { bytes.fill(0); return null }
    recordPhotoStep('preview-ready', `${mime} ${bytes.length}`)
    // A picture already held under this key leaves first, so the budget counts it once.
    this.forget(key)
    // The oldest preview leaves once the pictures held here pass the budget, or once there are more
    // of them than the window keeps.
    while (this.ready.size >= maxPreviews || (this.ready.size && this.held + bytes.length > previewBudget)) {
      const oldest = this.ready.keys().next()
      if (oldest.done) break
      this.forget(oldest.value)
    }
    this.held += bytes.length
    const preview: Preview = { token: randomUUID(), bytes, mime }
    this.ready.set(key, preview)
    return `morse://app/__photo-preview/${preview.token}`
  }
  private async fetch(chatId: string, request: MediaRequest, limit: number): Promise<Buffer | null> {
    const resource = this.resolve(chatId, request)
    if (!resource?.path || !resource.summary.available || resource.summary.blind || (resource.summary.kind !== 'image' && resource.summary.kind !== 'sticker')) {
      recordPhotoStep('preview-skipped', !resource ? 'no-resource' : !resource.path ? 'no-path'
        : !resource.summary.available ? 'unavailable' : resource.summary.blind ? 'blind' : `kind-${resource.summary.kind}`)
      return null
    }
    const sticker = resource.summary.kind === 'sticker'
    // B359: this device's copy first — memory, then the disk cache by the object's storage path (outbox.ts writes a
    // sent picture under the same path), and the server only for what neither holds.
    const kept = await this.cache?.read(resource.path, maxPreviewBytes) ?? null
    if (kept && !this.closed && this.resolve(chatId, request)?.path === resource.path && previewMime(kept, sticker)) {
      recordPhotoStep('preview-cached', `bytes-${kept.length}`)
      return Buffer.from(kept)
    }
    // Automatic download decides only what is asked of the server (Data::AutoDownload::Should, data_auto_download.cpp:
    // 406-424): off asks nothing; a size the message carries is weighed before the request (B360), else the answer's
    // length is (download-media.ts).
    if (limit <= 0) { recordPhotoStep('preview-held', 'auto-download-off'); return null }
    const size = resource.summary.size
    if (typeof size === 'number' && size >= Math.min(limit, maxPreviewBytes)) { recordPhotoStep('preview-held', `size-${size}`); return null }
    let bytes: Buffer
    try {
      bytes = await downloadMedia(this.credentials, resource, this.credentials.signal,
        () => { if (this.closed || this.resolve(chatId, request)?.path !== resource.path) throw new Error('Preview target changed') },
        () => {}, Math.min(limit, maxPreviewBytes))
    } catch (error) {
      // A picture over the preview cap lands here too; it stays one press away.
      recordPhotoStep('preview-failed', error instanceof Error ? error.message.slice(0, 60) : 'unknown')
      return null
    }
    if (this.closed || !previewMime(bytes, sticker)) {
      recordPhotoStep('preview-unreadable', this.closed ? 'closed' : `bytes-${bytes.length}`)
      bytes.fill(0); return null
    }
    // Kept on the disk for the next time (MediaCache.write copies; a blind resource never reaches here).
    this.cache?.write(resource.path, bytes)
    return bytes
  }

  private forget(key: string): void {
    const preview = this.ready.get(key)
    if (!preview) return
    this.ready.delete(key)
    this.held = Math.max(0, this.held - preview.bytes.length)
    preview.bytes.fill(0)
  }

  // B263 observation 3: the bytes a sticker bubble is drawn from right now, for a forward of it to hold its own copy of.
  stickerBytes(chatId: string, messageId: string, version: string): { bytes: Buffer; mime: string } | null {
    const preview = this.ready.get(PhotoPreviews.key(chatId, { requestId: '', messageId, version, index: 0 }))
    return preview && !this.closed ? { bytes: preview.bytes, mime: preview.mime } : null
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
