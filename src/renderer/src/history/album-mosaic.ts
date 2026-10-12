import { layoutMediaGroup, type GroupSize } from '../../../shared/grouped-layout'
import type { MediaMetadata } from '../../../shared/media-metadata'

// B310: an album's tiles in hundredths of the group, from tdesktop's mosaic (shared/grouped-layout.ts), so the group scales
// with the width it is drawn in as GroupedMedia::countCurrentSize scales it. A photo whose size the message does not
// carry is placed as a square (tdesktop places each by its own size; Morse knows only what came with the message).
export interface AlbumMosaic { width: number; height: number; tiles: { left: number; top: number; width: number; height: number }[] }
export function albumMosaic(count: number, metadata: MediaMetadata | null | undefined): AlbumMosaic {
  const widths = metadata?.imageWidthsPx, heights = metadata?.imageHeightsPx
  const sizes: GroupSize[] = Array.from({ length: count }, (_, index) => {
    const width = widths?.length === count ? widths[index] : index === 0 ? metadata?.mediaWidthPx : undefined
    const height = heights?.length === count ? heights[index] : index === 0 ? metadata?.mediaHeightPx : undefined
    return width && height ? { width, height } : { width: 1, height: 1 }
  })
  const rects = layoutMediaGroup(sizes)
  const width = Math.max(...rects.map(rect => rect.x + rect.width)), height = Math.max(...rects.map(rect => rect.y + rect.height))
  const percent = (value: number, of: number): number => Math.round(value / of * 10000) / 100
  return { width, height, tiles: rects.map(rect => ({ left: percent(rect.x, width), top: percent(rect.y, height), width: percent(rect.width, width), height: percent(rect.height, height) })) }
}
