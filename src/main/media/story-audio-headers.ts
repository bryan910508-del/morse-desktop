import { maxStoryAudioInputBytes, type StoryAudioHeaderInfo } from '../../shared/story-composer-audio'
import { tr } from '../../shared/i18n'
// Microsoft RIFF/WAVEFORMATEX: bounded PCM container inspection, no playback.
const invalid = (): never => { throw new Error(tr('15 MiB 미만의 8·16비트 모노/스테레오 PCM WAV를 선택해 주세요. 현재 지원하는 컨테이너 구조를 확인하지 못했습니다.')) }
export function storyAudioHeaders(bytes: Buffer): StoryAudioHeaderInfo {
  if (bytes.length < 44 || bytes.length >= maxStoryAudioInputBytes || bytes.toString('latin1',0,4) !== 'RIFF' || bytes.readUInt32LE(4)+8 !== bytes.length || bytes.toString('latin1',8,12) !== 'WAVE') return invalid()
  let offset = 12, count = 0, format: { channels:1|2;sampleRate:number;bitsPerSample:8|16;block:number } | null = null, dataBytes: number | null = null
  while (offset < bytes.length) {
    if (++count > 4096 || bytes.length-offset < 8) return invalid()
    const kind = bytes.toString('latin1',offset,offset+4), size = bytes.readUInt32LE(offset+4), start = offset+8, end = start+size, next = end+(size%2)
    if (end > bytes.length || next > bytes.length) return invalid()
    if (kind === 'fmt ') {
      if (format || (size !== 16 && size !== 18) || bytes.readUInt16LE(start) !== 1 || (size === 18 && bytes.readUInt16LE(start+16) !== 0)) return invalid()
      const channels = bytes.readUInt16LE(start+2), sampleRate = bytes.readUInt32LE(start+4), byteRate = bytes.readUInt32LE(start+8), block = bytes.readUInt16LE(start+12), bitsPerSample = bytes.readUInt16LE(start+14)
      if ((channels !== 1 && channels !== 2) || (bitsPerSample !== 8 && bitsPerSample !== 16) || sampleRate < 8000 || sampleRate > 96000 || block !== channels*bitsPerSample/8 || byteRate !== sampleRate*block) return invalid()
      format = { channels,sampleRate,bitsPerSample,block }
    } else if (kind === 'data') {
      if (dataBytes !== null || size === 0) return invalid()
      dataBytes = size
    }
    offset = next
  }
  if (!format || dataBytes === null || dataBytes%format.block !== 0) return invalid()
  const frames = dataBytes/format.block, declaredDuration = frames/format.sampleRate
  if (!Number.isFinite(declaredDuration) || declaredDuration < .5 || declaredDuration > 600) throw new Error(tr('현재 Desktop 오디오 입력 범위는 0.5초부터 10분까지입니다. 원본을 자동으로 자르지 않습니다.'))
  return { format:'pcm-wav',mime:'audio/wav',channels:format.channels,sampleRate:format.sampleRate,bitsPerSample:format.bitsPerSample,frames,declaredDuration,dataBytes }
}
