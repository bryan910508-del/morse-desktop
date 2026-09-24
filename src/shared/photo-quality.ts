// iOS PhotoSendQuality and MorseMediaPolicy.photoSendQualityDefault: «자동» 1280px at 0.80, «원본» 2560px at 0.90,
// «압축» 512px at 0.55, and power saving's «업로드 자동 압축» always compresses. The long side is limited.
// 1280 and 2560 are the two sizes Telegram sends a photo at — SD and HD (Telegram-iOS
// 6ad963e5b62d354da79040f388ae2b9132fb17b8, LegacyMediaPickers.swift:408 `item.forceHd ? 2560 : 1280`). iOS offers
// that pair on each photo and remembers the last pick on the device; here there is no per-photo picker, so «자동»
// is the SD of that pair.
export type PhotoSendQuality = 'auto' | 'original' | 'compressed'
export interface PhotoSendSpec { maxEdge: number; quality: number }
export function photoSendSpec(mode: PhotoSendQuality, compress: boolean): PhotoSendSpec {
  if (compress || mode === 'compressed') return { maxEdge: 512, quality: 0.55 }
  return mode === 'original' ? { maxEdge: 2560, quality: 0.9 } : { maxEdge: 1280, quality: 0.8 }
}
// iOS VideoSendQuality and MorseMediaPolicy.videoSendQualityDefault(fallback: .q480) for a picked video: «자동» is 480p
// (AVAssetExportPreset960x540), «원본» 720p (1280x720), and «압축» or power saving's «업로드 자동 압축» 360p (medium quality).
export type VideoSendPreset = '960x540' | '1280x720' | 'medium'
export function videoSendPreset(mode: PhotoSendQuality, compress: boolean): VideoSendPreset {
  if (compress || mode === 'compressed') return 'medium'
  return mode === 'original' ? '1280x720' : '960x540'
}
// ChatRoomView.sendVideoMessage: a picked video may be up to 600 MB and 11 minutes long before it is compressed; what
// is sent must still fit the server's 50 MB.
export const maxVideoSourceBytes = 600 * 1024 * 1024
export const maxVideoSourceSeconds = 660
export const maxVideoUploadBytes = 50 * 1024 * 1024

// A photo that would lose what it is by becoming a JPEG (an animated GIF) keeps its own bytes.
export function reencodedPhotoType(type: string): boolean {
  return type === 'image/jpeg' || type === 'image/png' || type === 'image/webp'
}
