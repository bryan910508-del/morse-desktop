import { object } from './validation'
import { maxThumbDataChars } from './media-metadata'
import { tr } from './i18n'
export interface AttachmentFile {
  id: string
  name: string
  kind: 'image' | 'video' | 'file'
  size: number
}
export interface AttachmentDraft extends AttachmentFile {
  chatId: string
  // originalUrl: a picked video the Mac helper prepared, which Editor::VideoEditor can cut again from the file.
  items: (AttachmentFile & { previewUrl?: string; originalUrl?: string })[]
}
export type AttachmentMode = 'media' | 'album' | 'file'
export type AttachmentDropMode = 'media' | 'file'
export const maxAlbumPhotos = 10

// What a picked video is, read by the renderer's own media element: iOS sends every video with its
// display size, its length and a 160px JPEG placeholder (MorsePendingMediaUploadManager), and so do
// Telegram clients. Only descriptive: a video these cannot be read from travels without them.
export interface VideoFacts { duration: number; width: number; height: number; thumb: string }
export function videoFacts(raw: unknown): VideoFacts | null {
  if (raw === undefined || raw === null) return null
  const value = object(raw)
  const size = (key: 'width' | 'height'): number => {
    const number = value[key]
    if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < 1 || number > 16384) throw new Error(tr('동영상 크기 정보를 확인할 수 없습니다.'))
    return number
  }
  if (Object.keys(value).some(key => !['duration', 'width', 'height', 'thumb'].includes(key))) throw new Error(tr('동영상 정보를 확인할 수 없습니다.'))
  const duration = value.duration, thumb = value.thumb
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0 || duration > 86400) throw new Error(tr('동영상 길이 정보를 확인할 수 없습니다.'))
  if (typeof thumb !== 'string' || thumb.length > maxThumbDataChars || (thumb && !/^[A-Za-z0-9+/]+={0,2}$/.test(thumb))) throw new Error(tr('동영상 미리보기 정보를 확인할 수 없습니다.'))
  return { duration, width: size('width'), height: size('height'), thumb }
}
