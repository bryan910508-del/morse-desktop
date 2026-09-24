// The tiny blurred picture a photo travels with, so the bubble on the other side shows the photo's
// shape and colours before anything is downloaded (Telegram's inline thumbnail, Data::Photo
// inlineThumbnailBytes). Morse carries none of its own, so each client makes one, and the three make
// the same one: iOS MorseOutgoingPhotoPlaceholder walks the long side down 64 → 40 → 32 and, at each
// step, the quality 0.5 → 0.3, taking the first result that fits 1024 bytes; Android was measured
// against the same values (64×48, 981 bytes). A picture that fits none of them travels without one,
// as iOS returns nil.
export const placeholderBudgetBytes = 1024
export const placeholderSides = [64, 40, 32] as const
// Electron's JPEG quality is 0–100 where iOS's compressionQuality is 0–1.
export const placeholderQualities = [50, 30] as const

// `encode` makes one JPEG with the picture's long side at `side` and returns its bytes, or null when
// this picture cannot be read at all.
export function outgoingPhotoPlaceholder(encode: (side: number, quality: number) => Uint8Array | null): string {
  for (const side of placeholderSides) {
    for (const quality of placeholderQualities) {
      let bytes: Uint8Array | null
      try { bytes = encode(side, quality) } catch { return '' }
      if (!bytes) return ''
      if (bytes.length <= placeholderBudgetBytes) return Buffer.from(bytes).toString('base64')
    }
  }
  return ''
}
