// iOS MorseStickerLibrary / MorseStickerMedia: a sticker is a PNG, a GIF or an MP4 kept on this device, named by
// the SHA-256 of its bytes, sent as a «sticker» message drawn 512 by 512.
export type StickerKind = 'png' | 'gif' | 'mp4'
export interface StickerItem { id: string; kind: StickerKind; size: number; url: string }
export const maxStickerBytes = 10 * 1024 * 1024
export const maxStickers = 200
export const stickerSidePx = 512
// B458 (user 10-16): a video sticker is made at most 5 seconds long, one number in the three apps — the part from a chosen
// start, as iOS MorseStickerMedia.cropVideo keeps its part (tdesktop: kVideoStickerMaxDuration, sticker_creator_box.cpp:57,
// is Telegram's server rule). A GIF keeps every frame, as on iOS; a received sticker plays as it is.
export const maxStickerVideoSeconds = 5
// B472b (one rule in the three apps): a received MP4 sticker with no length, or a single frame, is shown as that frame and
// not repeated. A looping video of length 0 restarts without a pause (Chromium: seek after seek, tens of thousands in
// seconds); Telegram Desktop's reader keeps its loop to the clock instead (media_clip_ffmpeg.cpp:148-161). The length is
// Infinity before it is known and then 0, so only a finite length above one frame's time moves.
export function stickerMoves(duration: number): boolean {
  return Number.isFinite(duration) && duration > 0.05
}
// The part of a `duration`-second video a sticker keeps: from `start`, held inside the video, for at most five seconds.
export function stickerVideoRange(duration: number, start: number): { start: number; seconds: number } {
  const length = Number.isFinite(duration) && duration > 0 ? duration : 0
  const from = Math.min(Math.max(0, Number.isFinite(start) ? start : 0), Math.max(0, length - maxStickerVideoSeconds))
  return { start: from, seconds: Math.min(maxStickerVideoSeconds, length - from) }
}
// The part main takes from the window for an MP4: a start at or after 0 and a length of at most five seconds; none sent
// is the first five. Anything else is refused.
export function stickerVideoPart(raw: unknown): { start: number; seconds: number } | null {
  if (raw === undefined || raw === null) return { start: 0, seconds: maxStickerVideoSeconds }
  if (typeof raw !== 'object') return null
  const { start, seconds } = raw as Record<string, unknown>
  if (typeof start !== 'number' || typeof seconds !== 'number' || !Number.isFinite(start) || !Number.isFinite(seconds)) return null
  return start >= 0 && start <= 24 * 3600 && seconds > 0 && seconds <= maxStickerVideoSeconds ? { start, seconds } : null
}
// A sticker of this device's library, drawn by its id (the SHA-256 of its bytes).
export const stickerLibraryURL = (id: string): string => `morse://app/__sticker/${id}`
// B264: the picture a sticker this device sends is drawn from — the library's or an installed set's address — and whether
// it is an MP4 that plays as video.
export interface StickerDraw { url: string; video: boolean }

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
