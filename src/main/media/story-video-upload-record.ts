import { identifier, object } from '../../shared/validation'
import { backgroundPhotoId } from '../../shared/chat-background'
import type { StoryVideoPublicationIntent, StoryVideoPart } from '../../shared/story-video-publication'
import { storageBucket } from './media-document'
import { tr } from '../../shared/i18n'
export interface StoryVideoReceipt { generation: string; metageneration: string }
export interface StoryVideoTransfer { state: 'pending' | 'acknowledged' | 'unknown' | 'expired'; session: string | null; receipt: StoryVideoReceipt | null }
export interface StoryVideoUploadSource { intent: StoryVideoPublicationIntent; part: StoryVideoPart; transfer: StoryVideoTransfer; bytes: Uint8Array }
export function storyVideoPart(raw: unknown): StoryVideoPart { if (raw !== 'video' && raw !== 'poster' && raw !== 'audio') throw new Error(tr('스토리 미디어 종류가 다릅니다.')); return raw }
export function storyVideoPath(uid: string, id: string, part: StoryVideoPart): string { if(storyVideoPart(part)==='audio')return `stories/user/${identifier(uid)}/${backgroundPhotoId(id)}_audio.wav`;  return `stories/user/${identifier(uid)}/${backgroundPhotoId(id)}${storyVideoPart(part) === 'poster' ? '_thumb.jpg' : '.mp4'}` }
export function storyVideoSession(raw: unknown, uid: string, id: string, part: StoryVideoPart): string {
  if (typeof raw !== 'string' || raw.length > 8192 || /[\s\\\x00-\x1f\x7f]/.test(raw)) throw new Error(tr('업로드 세션 주소를 확인하지 못했습니다.'))
  const url = new URL(raw), names = url.searchParams.getAll('name'), uploads = url.searchParams.getAll('upload_id')
  if (url.protocol !== 'https:' || url.host !== 'firebasestorage.googleapis.com' || url.username || url.password || url.hash || url.pathname !== `/v0/b/${storageBucket}/o` || uploads.length !== 1 || !uploads[0] || names.length > 1 || (names.length === 1 && names[0] !== storyVideoPath(uid, id, part))) throw new Error(tr('업로드 세션 범위가 다릅니다.'))
  return url.href
}
export function storyVideoReceipt(raw: unknown): StoryVideoReceipt {
  const v = object(raw)
  if (Object.keys(v).some(key => !['generation', 'metageneration'].includes(key)) || typeof v.generation !== 'string' || !/^[1-9][0-9]{0,39}$/.test(v.generation) || typeof v.metageneration !== 'string' || !/^[1-9][0-9]{0,39}$/.test(v.metageneration)) throw new Error(tr('미디어 업로드 완료 응답을 확인하지 못했습니다.'))
  return { generation: v.generation, metageneration: v.metageneration }
}
export function storyVideoMetadata(raw: unknown, intent: StoryVideoPublicationIntent, part: StoryVideoPart): StoryVideoReceipt {
  const v = object(raw), custom = object(v.metadata), size = part === 'audio' ? intent.audio?.bytes : part === 'video' ? intent.video.bytes : intent.video.posterBytes, md5 = part === 'audio' ? intent.audio?.md5 : part === 'video' ? intent.video.md5 : intent.video.posterMD5
  if(part==='audio' && !intent.audio)throw new Error(tr('준비 기록에 추가 오디오가 없습니다.'))
  if (v.bucket !== storageBucket || v.name !== storyVideoPath(intent.ownerId, intent.id, part) || v.contentType !== storyVideoMime(part) || typeof v.size !== 'string' || !/^[1-9][0-9]{0,9}$/.test(v.size) || Number(v.size) !== size || v.md5Hash !== md5 || custom.ownerUid !== intent.ownerId || custom.storyId !== intent.id) throw new Error(tr('완료 응답의 미디어·소유자·크기·해시가 준비 기록과 다릅니다.'))
  return storyVideoReceipt({ generation: v.generation, metageneration: v.metageneration })
}

export function storyVideoMime(part: StoryVideoPart): string { if(storyVideoPart(part)==='audio')return 'audio/wav';return storyVideoPart(part) === 'video' ? 'video/mp4' : 'image/jpeg' }
