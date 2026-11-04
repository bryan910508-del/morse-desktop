import { object } from './validation'
import { maxThumbDataChars } from './media-metadata'
import { tr } from './i18n'
export interface AttachmentFile {
  id: string
  name: string
  kind: 'image' | 'video' | 'file'
  size: number
}
// kind 'media': B518 — photos and videos picked together, shown in one box and sent in order (sendGroups).
export interface AttachmentDraft extends Omit<AttachmentFile, 'kind'> {
  kind: AttachmentFile['kind'] | 'media'
  chatId: string
  // originalUrl: what an edit starts from every time (B518, tdesktop's editor opens the item's own modifications again over
  // the picked picture): a picked video the Mac helper prepared, which Editor::VideoEditor cuts again from the file, and a
  // picture as it was picked, before any edit or quality change replaced it.
  items: (AttachmentFile & { previewUrl?: string; originalUrl?: string })[]
}
export type AttachmentMode = 'media' | 'album' | 'file'
export type AttachmentDropMode = 'media' | 'file'
export const maxAlbumPhotos = 10

// B518 (tdesktop Ui::GroupRanges, ui/chat/attach/attach_prepare.cpp:163-200, before photos and videos may share one
// album — the contract C waits for the server): the chosen items in their order, one message each — photos that follow
// one another go together as an album of up to ten, and every video goes on its own.
export function sendGroups(items: { id: string; kind: AttachmentFile['kind'] }[], max = maxAlbumPhotos): string[][] {
  const groups: string[][] = []
  let album: string[] | null = null
  for (const item of items) {
    if (item.kind !== 'image') { album = null; groups.push([item.id]); continue }
    if (!album || album.length >= max) { album = []; groups.push(album) }
    album.push(item.id)
  }
  return groups
}

// B518 (the three apps' overview; Telegram's picker words photos, videos and items only where it tells them apart): a box
// of several is named by what it holds — photos, videos, or items when both — and how many; the send button stays as it is.
export function overviewTitle(items: readonly { kind: AttachmentFile['kind'] }[]): string {
  const count = items.length
  if (items.every(item => item.kind === 'image')) return tr('사진 {0}장', [count])
  if (items.every(item => item.kind === 'video')) return tr('영상 {0}개', [count])
  return tr('항목 {0}개', [count])
}
// The line under it: how many of them are ticked, counted in the title's unit.
export function overviewChosen(items: readonly { kind: AttachmentFile['kind'] }[], chosen: number): string {
  return items.every(item => item.kind === 'image') ? tr('{0}장 선택됨', [chosen]) : tr('{0}개 선택됨', [chosen])
}

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
