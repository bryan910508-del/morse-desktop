import type { AttachmentKind, AttachmentSummary } from '../../shared/media'
import type { FirestoreDocument } from '../network/firestore-values'
import { tr } from '../../shared/i18n'
import { channelPostCardPath } from './channel-post-media-document'

export const storageBucket = 'talky-a38c3.firebasestorage.app'
export interface MediaResource { summary: AttachmentSummary; path: string | null
  // A channel post's picture is read through authorizeMorseMediaRead, which needs the post it belongs to.
  grantPostId?: string }
const labels: Record<AttachmentKind, string> = { image: tr('사진'), video: tr('동영상'), voice: tr('음성 메시지'), file: tr('파일'), sticker: tr('스티커') }

function value(doc: FirestoreDocument, key: string): string {
  const input = doc.fields[key]?.stringValue
  return typeof input === 'string' && input.length <= 10000 ? input.trim() : ''
}
export function safeFileName(input: string, fallback = tr('첨부 파일')): string {
  let name = input.replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069/\\:*?"<>|]/g, '_').trim()
  while (Buffer.byteLength(name) > 180) name = [...name].slice(0, -1).join('')
  name = name.replace(/[. ]+$/g, '')
  return !name || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name) ? fallback : name
}

// Resolve an observed document reference only. Never forward its bearer URL,
// query string, credentials or a renderer-supplied URL to the downloader.
// A chat keeps its media under chat_*; a channel inquiry keeps every kind under the inquiry_*
// prefixes the server manages (morse-message-media-authority MANAGED_PREFIXES), and iOS
// MorsePendingMediaUploadManager puts inquiry photos in inquiry_files.
export type MediaScope = 'chat' | 'inquiry'
function storageRoots(scope: MediaScope, kind: AttachmentKind): string[] {
  if (scope === 'inquiry') return ['inquiry_files', 'inquiry_media', 'inquiry_videos']
  return kind === 'file' || kind === 'voice' ? ['chat_files'] : ['chat_media', 'chat_videos']
}
function storagePath(raw: string, chatId: string, kind: AttachmentKind, scope: MediaScope = 'chat'): string | null {
  try {
    let path: string
    if (raw.startsWith(`gs://${storageBucket}/`)) path = raw.slice(storageBucket.length + 6)
    else {
      const url = new URL(raw)
      if (url.protocol !== 'https:' || url.hostname !== 'firebasestorage.googleapis.com' || url.port || url.username || url.password) return null
      const prefix = `/v0/b/${storageBucket}/o/`
      if (!url.pathname.startsWith(prefix)) return null
      path = decodeURIComponent(url.pathname.slice(prefix.length))
    }
    const parts = path.split('/')
    const roots = storageRoots(scope, kind)
    if (parts.length !== 3 || !roots.includes(parts[0]!) || parts[1] !== chatId ||
        parts.some(part => !part || part === '.' || part === '..' || /[\x00-\x1f\x7f\\]/.test(part)) || /\.e2e$/i.test(path)) return null
    return path
  } catch { return null }
}

export function mediaResources(doc: FirestoreDocument, chatId: string, rawKind: string, encrypted: boolean, scope: MediaScope = 'chat'): MediaResource[] {
  // onChannelPostCreated mirrors a channel post into its discussion room with the post's picture in thumbnailUrl,
  // under the channel's own folder. iOS draws that picture in the card (MorseChatUIKitNativeChannelPostRow).
  if (!encrypted && rawKind === 'channelPost') {
    const channelId = value(doc, 'channelId'), postId = value(doc, 'channelPostId'), raw = value(doc, 'thumbnailUrl')
    const path = channelId && postId && raw && raw.length <= 10000 ? channelPostCardPath(raw, channelId) : null
    return path ? [{ path, grantPostId: postId, summary: { index: 0, kind: 'image', name: labels.image, available: true, blind: false } }] : []
  }
  if (encrypted || !Object.hasOwn(labels, rawKind)) return []
  const kind = rawKind as AttachmentKind
  const media = value(doc, 'mediaUrl'), text = value(doc, 'text')
  const array = doc.fields.mediaKeys?.arrayValue as { values?: { stringValue?: unknown }[] } | undefined
  const keys = kind === 'image' && Array.isArray(array?.values) ? array.values.slice(0, 1000).map(item => typeof item?.stringValue === 'string' ? item.stringValue : '') : []
  // Keep album positions, including unavailable entries. Do not silently shift
  // an invalid first object onto another photograph.
  const preferred = kind === 'video' ? [text, media] : [media, text, keys[0] ?? '']
  const candidates = keys.length > 1 ? keys : [preferred.find(raw => storagePath(raw, chatId, kind, scope)) ?? '']
  return candidates.map((raw, index) => ({
    path: raw.length <= 10000 ? storagePath(raw, chatId, kind, scope) : null,
    summary: { index, kind, name: kind === 'file' ? safeFileName(value(doc, 'fileName') || (/^(https?:|gs:)/.test(text) ? '' : text)) : `${labels[kind]}${candidates.length > 1 ? ` ${index + 1}` : ''}`,
      available: raw.length <= 10000 && storagePath(raw, chatId, kind, scope) !== null, blind: value(doc, 'thumbnailUrl') === '__blind__' },
  }))
}
export function mediaCaption(doc: FirestoreDocument, kind: string): string {
  return value(doc, kind === 'image' ? 'imageCaption' : kind === 'video' ? 'videoCaption' : '').slice(0, 3000)
}
