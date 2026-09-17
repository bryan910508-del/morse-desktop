import { maxStoryVideoInputBytes, type StoryVideoHeaderInfo } from '../../shared/story-composer-video'
import { tr } from '../../shared/i18n'
// Limited container-header inspection, not decoding or a publishability proof.
// Field layouts: Apple QuickTime File Format atoms/mvhd/tkhd/mdhd/hdlr.
interface Box { type: string; start: number; end: number }
const invalid = (): never => { throw new Error(tr('현재 입력 검토가 지원하는 0.5~60초의 기본 MP4 파일을 선택해 주세요. 컨테이너 구조를 확인하지 못했습니다.')) }
export function storyVideoHeaders(bytes: Buffer): StoryVideoHeaderInfo {
  if (bytes.length < 32 || bytes.length >= maxStoryVideoInputBytes) return invalid()
  let count = 0
  const boxes = (start: number, end: number): Box[] => {
    const result: Box[] = []
    while (start < end) {
      if (++count > 4096 || end - start < 8) return invalid()
      const size = bytes.readUInt32BE(start), type = bytes.toString('latin1', start + 4, start + 8)
      let length = size, header = 8
      if (size === 1) {
        if (end - start < 16) return invalid()
        const extended = bytes.readBigUInt64BE(start + 8)
        if (extended > BigInt(Number.MAX_SAFE_INTEGER)) return invalid()
        length = Number(extended); header = 16
      }
      // Size-to-EOF boxes and fragments are outside this initial supported subset.
      if (length < header || length > end - start || ['moof', 'mvex', 'rmra', 'rmda', 'rdrf'].includes(type)) return invalid()
      result.push({ type, start: start + header, end: start + length }); start += length
    }
    return result
  }
  const one = (items: Box[], type: string): Box => { const found = items.filter(item => item.type === type); if (found.length !== 1 || !found[0]) return invalid(); return found[0] }
  const versionZero = (box: Box, minimum: number): void => { if (box.end - box.start < minimum || bytes[box.start] !== 0) return invalid() }
  const duration = (scale: number, ticks: number): number => { if (!scale || !ticks || ticks === 0xffffffff) return invalid(); const seconds = ticks / scale; if (!Number.isFinite(seconds) || seconds < 0.5 || seconds > 60) return invalid(); return seconds }
  const top = boxes(0, bytes.length), type = one(top, 'ftyp')
  if (top[0] !== type || type.end - type.start < 8 || (type.end - type.start - 8) % 4 !== 0 || !['isom', 'iso2', 'mp41', 'mp42', 'avc1', 'M4V '].includes(bytes.toString('latin1', type.start, type.start + 4)) || !top.some(item => item.type === 'mdat' && item.end > item.start)) return invalid()
  const movie = one(top, 'moov'), children = boxes(movie.start, movie.end), header = one(children, 'mvhd')
  versionZero(header, 100)
  const scale = bytes.readUInt32BE(header.start + 12), declaredDuration = duration(scale, bytes.readUInt32BE(header.start + 16))
  const tracks = children.filter(item => item.type === 'trak'), ids = new Set<number>()
  if (!tracks.length || tracks.length > 2) return invalid()
  let video: { width: number; height: number } | null = null, hasAudioTrack = false
  for (const track of tracks) {
    const parts = boxes(track.start, track.end), trackHeader = one(parts, 'tkhd')
    versionZero(trackHeader, 84)
    const id = bytes.readUInt32BE(trackHeader.start + 12)
    if (!id || ids.has(id)) return invalid(); ids.add(id)
    duration(scale, bytes.readUInt32BE(trackHeader.start + 20))
    const media = one(parts, 'mdia'), mediaParts = boxes(media.start, media.end), mediaHeader = one(mediaParts, 'mdhd'), handler = one(mediaParts, 'hdlr')
    versionZero(mediaHeader, 24); versionZero(handler, 24)
    duration(bytes.readUInt32BE(mediaHeader.start + 12), bytes.readUInt32BE(mediaHeader.start + 16))
    const minf = one(mediaParts, 'minf'), dinf = one(boxes(minf.start, minf.end), 'dinf'), dref = one(boxes(dinf.start, dinf.end), 'dref')
    versionZero(dref, 8)
    if (bytes.readUInt32BE(dref.start) !== 0 || bytes.readUInt32BE(dref.start + 4) !== 1) return invalid()
    const references = boxes(dref.start + 8, dref.end), reference = one(references, 'url ')
    if (references.length !== 1 || reference.end - reference.start !== 4 || bytes.readUInt32BE(reference.start) !== 1) return invalid()
    const kind = bytes.toString('latin1', handler.start + 8, handler.start + 12)
    if (kind === 'vide') {
      if (video) return invalid()
      const width = bytes.readUInt32BE(trackHeader.start + 76) / 65536, height = bytes.readUInt32BE(trackHeader.start + 80) / 65536
      if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 4096 || height > 4096) return invalid()
      video = { width, height }
    } else if (kind === 'soun' && !hasAudioTrack) hasAudioTrack = true
    else return invalid()
  }
  if (!video) return invalid()
  return { declaredDuration, trackWidth: video.width, trackHeight: video.height, hasAudioTrack }
}
