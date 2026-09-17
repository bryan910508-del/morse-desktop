import { backgroundImageInfo } from './background-photo-bytes'
import { profilePhotoBytes } from './profile-photo-upload'
import { tr } from './i18n'
export type ChannelPhotoKind = 'avatar' | 'cover'
export const maxChannelCoverWidth = 2048
export const maxChannelPhotoBytes = 1024 * 1024
export function channelPhotoKind(value: unknown): ChannelPhotoKind {
  // 0.67.0 durable records predate kind and contain representative photos only.
  if (value === undefined || value === 'avatar') return 'avatar'
  if (value === 'cover') return 'cover'
  throw new Error(tr('채널 사진 종류를 다시 확인해 주세요.'))
}
export function channelPhotoBytes(raw: unknown, kind: ChannelPhotoKind): Uint8Array {
  if (kind === 'avatar') return profilePhotoBytes(raw)
  if (kind !== 'cover' || !(raw instanceof Uint8Array) || raw.byteLength > maxChannelPhotoBytes) throw new Error(tr('채널 커버는 1 MB 이하로 준비해 주세요.'))
  const info = backgroundImageInfo(raw, true)
  if (info.width > maxChannelCoverWidth || info.width * 3 !== info.height * 8) throw new Error(tr('채널 커버를 16:6 가로 비율로 다시 준비해 주세요.'))
  return raw
}
