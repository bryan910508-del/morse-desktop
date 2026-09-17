import type { MediaSendWire } from '../../shared/model'
import { mediaType } from './media-type'
import { tr } from '../../shared/i18n'

export function forwardMediaFormat(kind: MediaSendWire['type'], bytes: Buffer): { contentType: string; extension: string; limit: number } {
  const large = 50 * 1024 * 1024, small = 10 * 1024 * 1024
  if (kind === 'file') return { contentType: 'application/octet-stream', extension: 'bin', limit: large }
  if (kind === 'voice') {
    // Morse's recorder produces AAC in M4A. General-chat Storage deliberately
    // receives octet-stream, while message kind and .m4a retain voice identity.
    const boxSize = bytes.length >= 16 ? bytes.readUInt32BE(0) : 0
    const brand = bytes.subarray(8, 12).toString('ascii')
    if (boxSize < 16 || boxSize > bytes.length || bytes.subarray(4, 8).toString('ascii') !== 'ftyp' ||
        !['M4A ', 'isom', 'iso2', 'mp41', 'mp42'].includes(brand)) throw new Error(tr('이 음성 원본은 지원하는 M4A 형식이 아닙니다.'))
    return { contentType: 'application/octet-stream', extension: 'm4a', limit: large }
  }
  const type = mediaType(bytes)
  if (kind === 'sticker') {
    if (type.kind !== 'image' && type.contentType !== 'video/mp4') throw new Error(tr('이 스티커 원본 형식은 전달을 지원하지 않습니다.'))
  } else if (type.kind !== kind) throw new Error(tr('원본 종류가 첨부 메시지와 맞지 않습니다.'))
  return { contentType: type.contentType, extension: type.extension, limit: type.kind === 'image' ? small : large }
}
export function forwardMediaRoot(kind: MediaSendWire['type'], contentType: string): string {
  return kind === 'file' || kind === 'voice' ? 'chat_files' : contentType.startsWith('video/') ? 'chat_videos' : 'chat_media'
}
