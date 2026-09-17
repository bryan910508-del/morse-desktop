import { identifier, object } from '../../shared/validation'
import { backgroundPhotoId } from '../../shared/chat-background'
import type { StoryPublicationIntent, StoryPhotoPart } from '../../shared/story-publication'
import { storageBucket } from './media-document'
import { tr } from '../../shared/i18n'
export interface StoryPhotoReceipt { generation: string; metageneration: string }
export interface StoryPhotoTransfer { state: 'pending' | 'acknowledged' | 'unknown' | 'expired'; session: string | null; receipt: StoryPhotoReceipt | null }
export interface StoryPhotoUploadSource { intent: StoryPublicationIntent; part: StoryPhotoPart; transfer: StoryPhotoTransfer; bytes: Uint8Array }
export function storyPhotoPart(raw: unknown): StoryPhotoPart { if (raw !== 'full' && raw !== 'thumbnail' && raw !== 'audio') throw new Error(tr('스토리 사진 종류가 다릅니다.')); return raw }
export function storyPhotoPath(uid: string, id: string, part: StoryPhotoPart): string { if(storyPhotoPart(part)==='audio')return `stories/user/${identifier(uid)}/${backgroundPhotoId(id)}_audio.wav`;  return `stories/user/${identifier(uid)}/${backgroundPhotoId(id)}${storyPhotoPart(part) === 'thumbnail' ? '_thumb' : ''}.jpg` }
export function storyPhotoSession(raw: unknown, uid: string, id: string, part: StoryPhotoPart): string {
  if (typeof raw !== 'string' || raw.length > 8192 || /[\s\\\x00-\x1f\x7f]/.test(raw)) throw new Error(tr('업로드 세션 주소를 확인하지 못했습니다.'))
  const url = new URL(raw), names = url.searchParams.getAll('name'), uploads = url.searchParams.getAll('upload_id')
  if (url.protocol !== 'https:' || url.host !== 'firebasestorage.googleapis.com' || url.username || url.password || url.hash || url.pathname !== `/v0/b/${storageBucket}/o` || uploads.length !== 1 || !uploads[0] || names.length > 1 || (names.length === 1 && names[0] !== storyPhotoPath(uid, id, part))) throw new Error(tr('업로드 세션 범위가 다릅니다.'))
  return url.href
}
export function storyPhotoReceipt(raw: unknown): StoryPhotoReceipt {
  const v = object(raw)
  if (Object.keys(v).some(key => !['generation', 'metageneration'].includes(key)) || typeof v.generation !== 'string' || !/^[1-9][0-9]{0,39}$/.test(v.generation) || typeof v.metageneration !== 'string' || !/^[1-9][0-9]{0,39}$/.test(v.metageneration)) throw new Error(tr('사진 업로드 완료 응답을 확인하지 못했습니다.'))
  return { generation: v.generation, metageneration: v.metageneration }
}
export function storyPhotoMetadata(raw: unknown, intent: StoryPublicationIntent, part: StoryPhotoPart): StoryPhotoReceipt {
  const v = object(raw), custom = object(v.metadata), size = part === 'audio' ? intent.audio?.bytes : part === 'full' ? intent.fullBytes : intent.thumbnailBytes, md5 = part === 'audio' ? intent.audio?.md5 : part === 'full' ? intent.fullMD5 : intent.thumbnailMD5
  if(part==='audio' && !intent.audio)throw new Error(tr('준비 기록에 추가 오디오가 없습니다.'))
  if (v.bucket !== storageBucket || v.name !== storyPhotoPath(intent.ownerId, intent.id, part) || v.contentType !== storyPhotoMime(part) || typeof v.size !== 'string' || !/^[1-9][0-9]{0,9}$/.test(v.size) || Number(v.size) !== size || v.md5Hash !== md5 || custom.ownerUid !== intent.ownerId || custom.storyId !== intent.id) throw new Error(tr('완료 응답의 사진·소유자·크기·해시가 준비 기록과 다릅니다.'))
  return storyPhotoReceipt({ generation: v.generation, metageneration: v.metageneration })
}

export function storyPhotoMime(part:StoryPhotoPart):string{return storyPhotoPart(part)==='audio'?'audio/wav':'image/jpeg'}
