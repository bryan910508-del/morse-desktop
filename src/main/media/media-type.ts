import { tr } from '../../shared/i18n'
export function mediaType(bytes: Buffer): { kind: 'image' | 'video'; contentType: string; extension: string } {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { kind: 'image', contentType: 'image/png', extension: 'png' }
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return { kind: 'image', contentType: 'image/jpeg', extension: 'jpg' }
  if (['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'))) return { kind: 'image', contentType: 'image/gif', extension: 'gif' }
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return { kind: 'image', contentType: 'image/webp', extension: 'webp' }
  const brand = bytes.subarray(8, 12).toString('ascii')
  if (bytes.length >= 16 && bytes.subarray(4, 8).toString('ascii') === 'ftyp' && ['isom', 'iso2', 'mp41', 'mp42', 'avc1', 'M4V ', 'qt  '].includes(brand)) return { kind: 'video', contentType: brand === 'qt  ' ? 'video/quicktime' : 'video/mp4', extension: brand === 'qt  ' ? 'mov' : 'mp4' }
  throw new Error(tr('이 형식은 사진·동영상 전송을 지원하지 않습니다. 일반 파일로 첨부해 주세요.'))
}
