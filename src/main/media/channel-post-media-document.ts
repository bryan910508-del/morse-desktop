import { createHash } from 'node:crypto'
import type { ChannelPostMediaItem } from '../../shared/channel-post-media'
import type { FirestoreDocument } from '../network/firestore-values'
import { storageBucket } from './media-document'

// The picture a channel post card carries into a discussion room: the post's own picture, or a video's thumbnail.
export function channelPostCardPath(raw: string, channelId: string): string | null {
  return pathFor(raw, channelId, 'channel_posts') ?? pathFor(raw, channelId, 'channel_video_thumbs')
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
    return path.length <= 1024 && parts.length === 3 && parts[0] === root && parts[1] === channelId &&
      parts.every(part => part && part !== '.' && part !== '..' && !/[\x00-\x1f\x7f\\?#]/.test(part)) ? path : null
  } catch { return null }
}
function values(doc: FirestoreDocument, key: string): unknown[] {
  const value = (doc.fields[key]?.arrayValue as { values?: unknown } | undefined)?.values
  return Array.isArray(value) ? value : []
}
function string(value: unknown): string {
  const raw = value && typeof value === 'object' ? (value as { stringValue?: unknown }).stringValue : null
  return typeof raw === 'string' && raw.length <= 10000 ? raw : ''
}
function pixels(value: unknown): number {
  const raw = value && typeof value === 'object' ? (value as { integerValue?: unknown; doubleValue?: unknown }) : null
  const number = Number(raw?.integerValue ?? raw?.doubleValue ?? 0)
  return Number.isSafeInteger(number) && number > 0 && number <= 100000 ? number : 0
}
// thumbDataBase64: the tiny blurred JPEG the post carries, drawn at once while the picture is fetched — the place
// Telegram gives immediateThumbnailData (Images::FromInlineBytes, a stripped JPEG shown blurred under the photo).
const maxBlurLength = 4096
export function blurThumb(value: unknown): string {
  const raw = string(value)
  if (!raw || raw.length > maxBlurLength || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw) || !raw.startsWith('/9j/')) return ''
  try { if (Buffer.from(raw, 'base64').subarray(0, 3).toString('hex') !== 'ffd8ff') return '' } catch { return '' }
  return `data:image/jpeg;base64,${raw}`
}
export function channelPostRevision(doc: FirestoreDocument): string { return createHash('sha256').update(JSON.stringify(doc)).digest('hex') }
export function channelPostMedia(doc: FirestoreDocument, channelId: string): { count: number; items: (ChannelPostMediaItem & { path: string | null; videoPath: string | null })[] } {
  const keys = values(doc, 'mediaKeys'), types = values(doc, 'mediaTypes'), thumbnails = values(doc, 'thumbnailKeys')
  // thumbDataBase64/mediaWidthsPx are optional: a post written before them reads exactly as it did.
  const blurs = values(doc, 'thumbDataBase64')
  const widths = values(doc, 'mediaWidthsPx'), heights = values(doc, 'mediaHeightsPx')
  return { count: keys.length, items: keys.slice(0, 20).map((key, index) => {
    const type = types[index] === undefined ? 'image' : string(types[index])
    const kind = type === 'image' || type === 'video' ? type : 'unsupported'
    const raw = kind === 'video' ? string(thumbnails[index]) : string(key)
    const path = kind === 'unsupported' ? null : pathFor(raw, channelId, kind === 'video' ? 'channel_video_thumbs' : 'channel_posts')
    // A video thumbnail must accompany a same-channel video resource.
    const videoPath = kind === 'video' ? pathFor(string(key), channelId, 'channel_videos') : null
    const available = !!path && (kind !== 'video' || !!videoPath)
    const width = pixels(widths[index]), height = pixels(heights[index])
    return { index, kind, available, path: available ? path : null, videoAvailable: !!videoPath, videoPath,
      blur: blurThumb(blurs[index]), ...(width && height ? { width, height } : {}) }
  }) }
}
