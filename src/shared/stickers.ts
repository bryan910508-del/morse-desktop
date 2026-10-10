// iOS MorseStickerLibrary / MorseStickerMedia: a sticker is a PNG, a GIF or an MP4 kept on this device, named by
// the SHA-256 of its bytes, sent as a «sticker» message drawn 512 by 512.
export type StickerKind = 'png' | 'gif' | 'mp4'
export interface StickerItem { id: string; kind: StickerKind; size: number; url: string }
export const maxStickerBytes = 10 * 1024 * 1024
export const maxStickers = 200
export const stickerSidePx = 512

// tdesktop's «Recent» row in the sticker panel (stickers_list_widget.cpp:78 kRecentDisplayLimit, :3352-3367 — the
// same in 64ca5475 and feec5f9d): the recent list less what is already a favourite (it has its own row above), each
// sticker once, at most 20. Only the drawing: the server's list (up to 30) and the favourites stay as they are, and
// a sticker taken out of the favourites is back in the row at its place in the list.
export const recentDisplayLimit = 20
export function recentStickerRow<T extends { id: string }>(recent: readonly T[], favourites: readonly { id: string }[] | null): T[] {
  const faved = new Set((favourites ?? []).map(item => item.id)), seen = new Set<string>(), row: T[] = []
  for (const item of recent) {
    if (row.length >= recentDisplayLimit) break
    if (faved.has(item.id) || seen.has(item.id)) continue
    seen.add(item.id)
    row.push(item)
  }
  return row
}

export function stickerKind(bytes: Uint8Array): StickerKind | null {
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png'
  if (bytes.length >= 4 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'gif'
  if (bytes.length >= 12 && String.fromCharCode(bytes[4]!, bytes[5]!, bytes[6]!, bytes[7]!) === 'ftyp') return 'mp4'
  return null
}
export const stickerContentType: Record<StickerKind, string> = { png: 'image/png', gif: 'image/gif', mp4: 'video/mp4' }
