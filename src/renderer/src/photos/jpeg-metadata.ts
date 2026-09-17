import { tr } from '../../../shared/i18n'
// Drop ancillary JPEG headers after canvas encoding as well. Only the new pixel
// data and decoding tables are retained, regardless of encoder metadata policy.
export function withoutMetadata(bytes: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [bytes.subarray(0, 2)]
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 2
  while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
    const start = offset
    while (bytes[offset] === 0xff) offset++
    const marker = bytes[offset++]!
    if (marker === 0xda) { parts.push(bytes.subarray(start)); break }
    if (offset + 2 > bytes.length) throw new Error(tr('사진 변환 결과를 읽을 수 없습니다.'))
    const length = view.getUint16(offset)
    if (length < 2 || offset + length > bytes.length) throw new Error(tr('사진 변환 결과를 읽을 수 없습니다.'))
    offset += length
    if (!((marker >= 0xe1 && marker <= 0xef) || marker === 0xfe)) parts.push(bytes.subarray(start, offset))
  }
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let position = 0
  for (const part of parts) { output.set(part, position); position += part.length }
  return output
}
