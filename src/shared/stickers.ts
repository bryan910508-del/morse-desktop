// iOS MorseStickerLibrary / MorseStickerMedia: a sticker is a PNG, a GIF or an MP4 kept on this device, named by
// the SHA-256 of its bytes, sent as a «sticker» message drawn 512 by 512.
export type StickerKind = 'png' | 'gif' | 'mp4'
export interface StickerItem { id: string; kind: StickerKind; size: number; url: string }
export const maxStickerBytes = 10 * 1024 * 1024
export const maxStickers = 200
export const stickerSidePx = 512

export function stickerKind(bytes: Uint8Array): StickerKind | null {
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png'
  if (bytes.length >= 4 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'gif'
  if (bytes.length >= 12 && String.fromCharCode(bytes[4]!, bytes[5]!, bytes[6]!, bytes[7]!) === 'ftyp') return 'mp4'
  return null
}
export const stickerContentType: Record<StickerKind, string> = { png: 'image/png', gif: 'image/gif', mp4: 'video/mp4' }
