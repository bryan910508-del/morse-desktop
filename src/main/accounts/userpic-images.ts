import { backgroundImageInfo } from '../../shared/background-photo-bytes'

// Dialogs::Row keeps its Ui::PeerUserpicView (a strong reference to the drawn picture) for the life of the row, and
// nothing clears it when the row scrolls out of sight: a picture Telegram has drawn once stays in memory until memory
// is needed for another. Here one store addressed by the picture itself holds what every list, box and profile draws,
// so a row that comes back, a box that opens, or a profile shows the picture in the same frame instead of reading it
// again. Only the size of the store bounds it, never how many rows happen to be on screen.
interface Held { bytes: Buffer; mime: string; pixels: number }
const images = new Map<string, Held>()
export const imageStoreEntries = 512, imageStoreBytes = 128 * 1024 * 1024
let stored = 0

export function rememberImage(raw: string, bytes: Buffer, mime: string): void {
  if (!raw || !bytes.length) return
  let pixels = Number.POSITIVE_INFINITY
  try { const info = backgroundImageInfo(bytes); pixels = info.width * info.height } catch { /* Unknown size is never reused under a pixel limit. */ }
  const previous = images.get(raw)
  if (previous) { images.delete(raw); stored -= previous.bytes.length; previous.bytes.fill(0) }
  images.set(raw, { bytes: Buffer.from(bytes), mime, pixels }); stored += bytes.length
  while (images.size > imageStoreEntries || stored > imageStoreBytes) {
    const [oldest, entry] = images.entries().next().value!
    if (oldest === raw) break
    images.delete(oldest); stored -= entry.bytes.length; entry.bytes.fill(0)
  }
}
// The picture ready to draw now, moved to the most recently drawn end. A picture too large for this surface is not used.
export function rememberedImage(raw: string, limits?: { maxBytes: number; maxPixels: number }): { bytes: Buffer; mime: string } | null {
  const held = images.get(raw)
  if (!held) return null
  if (limits && (held.bytes.length > limits.maxBytes || held.pixels > limits.maxPixels)) return null
  images.delete(raw); images.set(raw, held)
  return { bytes: Buffer.from(held.bytes), mime: held.mime }
}
export function holdsImage(raw: string): boolean { return images.has(raw) }
// The screen lock leaves no picture in memory.
export function forgetImages(): void {
  for (const entry of images.values()) entry.bytes.fill(0)
  images.clear(); stored = 0
}
export function imageStoreState(): { entries: number; bytes: number } { return { entries: images.size, bytes: stored } }
