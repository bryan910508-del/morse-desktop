import { backgroundImageInfo } from './background-photo-bytes'
import { backgroundPhotoId } from './chat-background'
import { identifier, object } from './validation'
import { tr } from './i18n'

// ChannelService.createPost: up to 10 images, longest side 1024 (resizedForChannel), JPEG,
// stored as channel_posts/{channelId}/{file}.jpg with the post's upload grant.
export const maxPostPhotos = 10
export const maxPostPhotoEdge = 1024
export const maxPostPhotoBytes = 2 * 1024 * 1024
export interface PostPhotoInfo { id: string; sha256: string; md5: string; size: number }

export function postPhotoList(raw: unknown): PostPhotoInfo[] {
  // Records prepared before photos were supported have no list.
  if (raw === undefined) return []
  const fail = (): never => { throw new Error(tr('게시할 사진을 다시 선택해 주세요.')) }
  if (!Array.isArray(raw) || raw.length > maxPostPhotos) return fail()
  const photos = raw.map(item => {
    const value = object(item)
    if (Object.keys(value).some(key => !['id', 'sha256', 'md5', 'size'].includes(key)) || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256) ||
      typeof value.md5 !== 'string' || !/^[A-Za-z0-9+/]{22}==$/.test(value.md5) || !Number.isSafeInteger(value.size) || (value.size as number) < 24 || (value.size as number) > maxPostPhotoBytes) return fail()
    return { id: backgroundPhotoId(value.id), sha256: value.sha256, md5: value.md5, size: value.size as number }
  })
  if (new Set(photos.map(photo => photo.id)).size !== photos.length) return fail()
  return photos
}
export function postPhotoBytes(raw: unknown): Uint8Array {
  if (!(raw instanceof Uint8Array) || raw.byteLength > maxPostPhotoBytes) throw new Error(tr('게시할 사진을 다시 준비해 주세요.'))
  const info = backgroundImageInfo(raw, true)
  if (info.type !== 'image/jpeg' || Math.max(info.width, info.height) > maxPostPhotoEdge) throw new Error(tr('게시할 사진을 다시 준비해 주세요.'))
  return raw
}
export function channelPostPhotoPath(channelId: string, photoId: string): string {
  return `channel_posts/${identifier(channelId)}/${backgroundPhotoId(photoId)}.jpg`
}
