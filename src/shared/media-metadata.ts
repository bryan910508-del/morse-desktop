import { object } from './validation'
import { tr } from './i18n'

export interface MediaMetadata {
  videoDuration?: number
  videoWidthPx?: number
  videoHeightPx?: number
  mediaWidthPx?: number
  mediaHeightPx?: number
  voiceDuration?: number
  imageWidthsPx?: number[]
  imageHeightsPx?: number[]
  voiceWaveform?: number[]
  isCircleVideo?: true
  // Telegram's stripped placeholder: a tiny JPEG in base64, shown blurred before the picture itself.
  thumbData?: string
  // B310ⓑ (contracts/B310b-album-per-photo-thumbs.md): an album's placeholder for each photo, in mediaKeys order, ""
  // where none was made; thumbData stays the first photo's for apps that know only it. Telegram gives every photo of
  // an album its own stripped thumbnail (each is its own message under one grouped_id).
  thumbDatas?: string[]
}
// A placeholder travels as the server keeps it (canonical message strings up to 100,000 characters).
// iOS sends a 160px JPEG for every video, which runs past 20,000 characters for a busy frame.
export const maxThumbDataChars = 100_000
// The server's bound for one entry of thumbDatas (morse-message-authority.js albumThumbs).
export const maxAlbumThumbChars = 16_384
const base64 = /^[A-Za-z0-9+/]+={0,2}$/
// An album's thumbDatas as the server keeps it: no more entries than photos, each "" or a placeholder within the bound.
export function albumThumbs(value: unknown, count: number): string[] | null {
  if (!Array.isArray(value) || value.length > count || count > 10) return null
  return value.every(item => typeof item === 'string' && item.length <= maxAlbumThumbChars && (item === '' || base64.test(item))) ? [...value] as string[] : null
}
export const mediaNumberFields = ['videoDuration', 'videoWidthPx', 'videoHeightPx', 'mediaWidthPx', 'mediaHeightPx', 'voiceDuration'] as const
export const mediaArrayFields = ['imageWidthsPx', 'imageHeightsPx', 'voiceWaveform'] as const
// B310ⓑ: the placeholder an album's tile i is drawn with before its photo is here — its own, else the first photo's
// thumbData for the first tile, else none (the tile is filled and fetched as before).
export function albumPlaceholder(metadata: MediaMetadata | null | undefined, index: number): string {
  return metadata?.thumbDatas?.[index] || (index === 0 ? metadata?.thumbData ?? '' : '')
}
export function mediaMetadata(raw: unknown, kind: string, count: number): MediaMetadata {
  const value = object(raw), result: MediaMetadata = {}
  const allowed = new Set<string>(kind === 'voice' ? ['voiceDuration', 'voiceWaveform'] : kind === 'image' ?
    ['mediaWidthPx', 'mediaHeightPx', 'imageWidthsPx', 'imageHeightsPx', 'thumbData', 'thumbDatas'] : kind === 'video' || kind === 'sticker' ?
      ['videoDuration', 'videoWidthPx', 'videoHeightPx', 'mediaWidthPx', 'mediaHeightPx', 'thumbData', ...(kind === 'video' ? ['isCircleVideo'] : [])] : [])
  if (Object.keys(value).some(key => !allowed.has(key))) throw new Error(tr('첨부 정보의 종류가 맞지 않습니다.'))
  for (const key of mediaNumberFields) {
    const number = value[key]
    if (number === undefined) continue
    if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < (key.endsWith('Duration') ? 0 : 1)) throw new Error(tr('첨부 길이 또는 크기 정보를 확인할 수 없습니다.'))
    result[key] = number
  }
  for (const key of mediaArrayFields) {
    const array = value[key]
    if (array === undefined) continue
    if (!Array.isArray(array) || array.length > 1000 || (key !== 'voiceWaveform' && array.length !== count) ||
        array.some(number => typeof number !== 'number' || !Number.isFinite(number) || (key === 'voiceWaveform' ? number < 0 || number > 1 : !Number.isSafeInteger(number) || number < 1))) throw new Error(tr('첨부 파형 또는 사진 순서 정보를 확인할 수 없습니다.'))
    result[key] = [...array]
  }
  if (value.isCircleVideo !== undefined) {
    if (value.isCircleVideo !== true || !result.videoWidthPx || result.videoWidthPx !== result.videoHeightPx) throw new Error(tr('원형 영상의 정사각형 크기 정보를 확인할 수 없습니다.'))
    result.isCircleVideo = true
  }
  if (value.thumbData !== undefined) {
    const thumb = value.thumbData
    if (typeof thumb !== 'string' || !thumb || thumb.length > maxThumbDataChars || !/^[A-Za-z0-9+/]+={0,2}$/.test(thumb)) throw new Error(tr('사진 미리보기 정보를 확인할 수 없습니다.'))
    result.thumbData = thumb
  }
  if (value.thumbDatas !== undefined) {
    const thumbs = albumThumbs(value.thumbDatas, count)
    if (!thumbs) throw new Error(tr('사진 미리보기 정보를 확인할 수 없습니다.'))
    result.thumbDatas = thumbs
  }
  return result
}
