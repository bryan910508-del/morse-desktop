import { tr } from './i18n'
export const maxBackgroundInputBytes = 20 * 1024 * 1024
export const maxBackgroundPixels = 25 * 1024 * 1024
export const maxBackgroundEdge = 2560
export const maxBackgroundPhotoBytes = 2 * 1024 * 1024
export const maxAccountBackgroundBytes = 64 * 1024 * 1024

// Container inspection only; decoding is confined to a disposable web worker.
export function backgroundImageInfo(bytes: Uint8Array, normalized = false): { width: number; height: number; type: string } {
  const fail = (): never => { throw new Error(tr('지원하는 JPEG 또는 PNG 사진을 선택해 주세요. 원본은 20 MB·2,621만 화소 이하, 저장 사본은 2 MB 이하입니다.')) }
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 24 || bytes.byteLength > (normalized ? maxBackgroundPhotoBytes : maxBackgroundInputBytes)) return fail()
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const dimensions = (width: number, height: number, type: string) => {
    if (!width || !height || width > (normalized ? maxBackgroundEdge : 16384) || height > (normalized ? maxBackgroundEdge : 16384) || width * height > maxBackgroundPixels) return fail()
    return { width, height, type }
  }
  if (!normalized && view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a && view.getUint32(8) === 13 && view.getUint32(12) === 0x49484452) {
    return dimensions(view.getUint32(16), view.getUint32(20), 'image/png')
  }
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return fail()
  let offset = 2, info: { width: number; height: number; type: string } | null = null
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xff) return fail()
    while (bytes[offset] === 0xff) offset++
    const marker = bytes[offset++]
    if (marker === undefined || marker === 0 || marker === 0xd9 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) return fail()
    if (offset + 2 > bytes.length) return fail()
    const length = view.getUint16(offset)
    if (length < 2 || offset + length > bytes.length) return fail()
    // Encoded canvas output must not retain EXIF, XMP, comments or ICC payloads.
    if (normalized && ((marker >= 0xe1 && marker <= 0xef) || marker === 0xfe)) return fail()
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (info || length < 8 || bytes[offset + 2] !== 8) return fail()
      info = dimensions(view.getUint16(offset + 5), view.getUint16(offset + 3), 'image/jpeg')
    }
    if (marker === 0xda) {
      if (!info || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) return fail()
      return info
    }
    offset += length
  }
  return fail()
}
