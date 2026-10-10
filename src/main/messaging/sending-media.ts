import { randomUUID } from 'node:crypto'
import { nativeImage } from 'electron'
import type { StickerDraw } from '../../shared/stickers'
import type { LocalMedia } from '../../shared/delivery'
import type { MediaMetadata } from '../../shared/media-metadata'

// B269 (tdesktop api_sending.cpp:1227-1240 addNewLocalMessage(…, local.media); data_cloud_file.cpp:200-216): a message
// this device sends is drawn with its own media from the moment it is sent, as the same media the server's copy becomes,
// and that copy keeps the picture instead of loading it again. Here, by message id, what each one is drawn from:
// - a picture (a photo or each photo of an album): a copy shrunk for the screen from the bytes being sent (tdesktop's
//   'y' size), held in memory and served at morse://app/__sending-media/<token>;
// - a sticker (B264): the address it was sent from — the library's or an installed set's.
// A row read back after a restart, still uploading, has its pictures read again from what the queue keeps (`want`).
// The newest few are kept; one let go is drawn from the placeholder the message carries and loaded as any other.
export const sendingMediaRoute = '__sending-media'
const sendingMediaURL = (token: string): string => `morse://app/${sendingMediaRoute}/${token}`
const keepDraws = 300, maxPictures = 48, pictureBudget = 48 * 1024 * 1024, side = 1280
interface Picture { bytes: Buffer; mime: string }
export type Shrink = (bytes: Uint8Array, contentType: string) => Picture | null
type Draw = { kind: 'sticker'; draw: StickerDraw } | { kind: 'pictures'; tokens: (string | null)[] }
type Read = (index: number) => Promise<{ bytes: Uint8Array; contentType: string } | null>

// The screen's copy of a picture: no longer side than tdesktop's 'y' (1280), PNG kept as PNG for its transparency, a GIF
// as it is (shrinking would stop it). A format the platform cannot read is not drawn from here.
export const shrinkPicture: Shrink = (bytes, contentType) => {
  if (contentType === 'image/gif') return bytes.byteLength <= 10 * 1024 * 1024 ? { bytes: Buffer.from(bytes), mime: 'image/gif' } : null
  const image = nativeImage.createFromBuffer(Buffer.from(bytes))
  const { width, height } = image.getSize()
  if (!width || !height) return null
  const fitted = width <= side && height <= side ? image : image.resize({ ...(width >= height ? { width: side } : { height: side }), quality: 'good' })
  return contentType === 'image/png' ? { bytes: fitted.toPNG(), mime: 'image/png' } : { bytes: fitted.toJPEG(85), mime: 'image/jpeg' }
}

// B269: what a message's fields say its media will be, for a chat's queued wire and an inquiry room's queued message
// alike: the kind and parts the server's copy will have, and what its bubble is drawn from (the size, the placeholder, a
// video's length, a file's name and size, the caption). A text and a voice message (drawn by its own player) have none.
export function mediaOfFields(fields: Record<string, unknown>, parts: readonly { index: number; name: string; size: number }[]): LocalMedia | undefined {
  const type = fields.type
  if (type !== 'image' && type !== 'video' && type !== 'file' && type !== 'sticker') return undefined
  const number = (key: string): number | undefined => typeof fields[key] === 'number' && Number.isFinite(fields[key]) ? fields[key] as number : undefined
  const text = (key: string): string => typeof fields[key] === 'string' ? fields[key] as string : ''
  const metadata: MediaMetadata = {}
  for (const key of ['mediaWidthPx', 'mediaHeightPx', 'videoWidthPx', 'videoHeightPx', 'videoDuration'] as const) { const value = number(key); if (value !== undefined) metadata[key] = value }
  const widths = fields.imageWidthsPx, heights = fields.imageHeightsPx
  if (Array.isArray(widths) && Array.isArray(heights) && widths.every(Number.isFinite) && heights.every(Number.isFinite)) { metadata.imageWidthsPx = [...widths]; metadata.imageHeightsPx = [...heights] }
  if (text('thumbData')) metadata.thumbData = text('thumbData')
  const circular = type === 'video' && fields.isCircleVideo === true
  if (circular) metadata.isCircleVideo = true
  const file = type === 'file' ? { index: 0, name: text('fileName') || parts[0]?.name || '', size: number('fileSize') ?? parts[0]?.size ?? 0 } : null
  return { kind: type, parts: file ? [file] : parts.length ? parts.map(part => ({ ...part })) : [{ index: 0, name: '', size: 0 }],
    caption: type === 'image' ? text('imageCaption') : type === 'video' ? text('videoCaption') : '', metadata, ...(circular ? { circular: true as const } : {}) }
}

export class SendingMedia {
  private readonly draws = new Map<string, Draw>()
  private readonly pictures = new Map<string, Picture>()
  // Pictures of a row read back after a restart: read once, when first drawn.
  private readonly loaders = new Map<string, Promise<string | null>>()
  private readonly wanted = new Map<string, { count: number; read: Read }>()
  constructor(private readonly shrink: Shrink = shrinkPicture) {}

  // B264: the sticker a message is sent as.
  noteSticker(messageId: string, draw: StickerDraw): void { this.wanted.delete(messageId); this.put(messageId, { kind: 'sticker', draw }) }
  sticker(messageId: string): StickerDraw | null { const draw = this.draws.get(messageId); return draw?.kind === 'sticker' ? draw.draw : null }

  // The pictures of a message, from the bytes in hand when it is queued (the caller keeps and clears its own).
  keepPictures(messageId: string, parts: readonly { bytes: Uint8Array; contentType: string }[]): void {
    const tokens = parts.map(part => this.hold(part.bytes, part.contentType))
    this.wanted.delete(messageId)
    if (tokens.some(Boolean)) this.put(messageId, { kind: 'pictures', tokens })
  }
  // A queued row whose pictures are not held (read back after a restart): they are read from the queue when drawn.
  want(messageId: string, count: number, read: Read): void {
    if (!this.draws.has(messageId) && !this.wanted.has(messageId)) this.wanted.set(messageId, { count, read })
  }
  // The address a message's picture is drawn from: held, read from the queue, or null — then it is loaded as any other.
  picture(messageId: string, index: number): Promise<string | null> | null {
    const draw = this.draws.get(messageId)
    if (draw?.kind === 'pictures') {
      const token = draw.tokens[index]
      if (token && this.pictures.has(token)) return Promise.resolve(sendingMediaURL(token))
    }
    const wanted = this.wanted.get(messageId)
    if (!wanted || index < 0 || index >= wanted.count) return null
    const key = `${messageId}\n${index}`
    let loading = this.loaders.get(key)
    if (!loading) {
      loading = wanted.read(index).then(source => {
        if (!source || this.wanted.get(messageId) !== wanted) return null
        const token = this.hold(source.bytes, source.contentType)
        if (!token) return null
        const current = this.draws.get(messageId), tokens = current?.kind === 'pictures' ? [...current.tokens] : Array.from({ length: wanted.count }, (): string | null => null)
        tokens[index] = token
        this.put(messageId, { kind: 'pictures', tokens })
        return this.pictures.has(token) ? sendingMediaURL(token) : null
      }).catch(() => null).finally(() => this.loaders.delete(key))
      this.loaders.set(key, loading)
    }
    return loading
  }
  response(token: string, request: Request): Response {
    const picture = this.pictures.get(token)
    if (!picture || !['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 404 })
    return new Response(request.method === 'HEAD' ? null : new Uint8Array(picture.bytes), { headers: {
      'Content-Type': picture.mime, 'Content-Length': String(picture.bytes.length), 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" } })
  }
  forget(messageId: string): void { this.draws.delete(messageId); this.wanted.delete(messageId); this.release() }
  clear(): void { this.draws.clear(); this.wanted.clear(); this.release() }

  private hold(bytes: Uint8Array, contentType: string): string | null {
    let picture: Picture | null = null
    try { picture = this.shrink(bytes, contentType) } catch { picture = null }
    if (!picture || !picture.bytes.length) return null
    const token = randomUUID()
    this.pictures.set(token, picture)
    return token
  }
  private put(messageId: string, draw: Draw): void {
    this.draws.delete(messageId); this.draws.set(messageId, draw)
    while (this.draws.size > keepDraws) this.draws.delete(this.draws.keys().next().value!)
    this.release()
  }
  // Pictures no message names go; past the limits the oldest go with the messages that name them, which then load as
  // any other.
  private release(): void {
    const named = new Set<string>()
    for (const draw of this.draws.values()) if (draw.kind === 'pictures') for (const token of draw.tokens) if (token) named.add(token)
    for (const [token, picture] of this.pictures) if (!named.has(token)) { picture.bytes.fill(0); this.pictures.delete(token) }
    let total = [...this.pictures.values()].reduce((sum, picture) => sum + picture.bytes.length, 0)
    while (this.pictures.size > maxPictures || total > pictureBudget) {
      const [token, picture] = this.pictures.entries().next().value!
      total -= picture.bytes.length; picture.bytes.fill(0); this.pictures.delete(token)
      for (const [id, draw] of this.draws) if (draw.kind === 'pictures' && draw.tokens.includes(token)) {
        const tokens = draw.tokens.map(item => item === token ? null : item)
        if (tokens.some(Boolean)) this.draws.set(id, { kind: 'pictures', tokens }); else this.draws.delete(id)
      }
    }
  }
}
