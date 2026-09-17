import { object } from './validation'
import { backgroundPhotoId } from './chat-background'
import { backgroundImageInfo } from './background-photo-bytes'
import { tr } from './i18n'
export interface StoryComposerPhotoTarget { id: string; draftRevision: string }
export interface StoryComposerPhotoWrite extends StoryComposerPhotoTarget { expected: string | null; revision: string; sourceId: string | null }
export interface StoryComposerPhotoReference { id: string; revision: string; photoId: string }
export interface StoryComposerPhotoRecord { id: string; revision: string | null; photo: { id: string; width: number; height: number; thumbnailWidth: number; thumbnailHeight: number; bytes: number; thumbnailBytes: number; sha256: string; thumbnailSha256: string } | null }
export interface StoryComposerPhotoPair { full: Uint8Array; thumbnail: Uint8Array }
export function storyComposerPhotoTarget(raw: unknown): StoryComposerPhotoTarget {
  const v = object(raw)
  if (Object.keys(v).some(key => !['id', 'draftRevision'].includes(key))) throw new Error(tr('현재 저장한 새 스토리 초안에서 사진을 선택해 주세요.'))
  return { id: backgroundPhotoId(v.id), draftRevision: backgroundPhotoId(v.draftRevision) }
}
export function storyComposerPhotoWrite(raw: unknown): StoryComposerPhotoWrite {
  const v = object(raw)
  if (Object.keys(v).some(key => !['id', 'draftRevision', 'expected', 'revision', 'sourceId'].includes(key)) || v.expected === undefined) throw new Error(tr('현재 초안과 사진 저장 버전을 확인해 주세요.'))
  const expected = v.expected === null ? null : backgroundPhotoId(v.expected), revision = backgroundPhotoId(v.revision)
  if (expected === revision) throw new Error(tr('새 사진 저장 버전이 필요합니다.'))
  return { ...storyComposerPhotoTarget({ id: v.id, draftRevision: v.draftRevision }), expected, revision, sourceId: v.sourceId === null ? null : backgroundPhotoId(v.sourceId) }
}
export function storyComposerPhotoReference(raw: unknown): StoryComposerPhotoReference {
  const v = object(raw)
  if (Object.keys(v).some(key => !['id', 'revision', 'photoId'].includes(key))) throw new Error(tr('현재 초안 사진을 선택해 주세요.'))
  return { id: backgroundPhotoId(v.id), revision: backgroundPhotoId(v.revision), photoId: backgroundPhotoId(v.photoId) }
}
export function storyComposerPhotoPair(full: unknown, thumbnail: unknown): StoryComposerPhotoPair {
  if (!(full instanceof Uint8Array) || !(thumbnail instanceof Uint8Array)) throw new Error(tr('사진을 다시 준비해 주세요.'))
  const image = backgroundImageInfo(full, true), thumb = backgroundImageInfo(thumbnail, true)
  if (Math.max(image.width, image.height) > 1080 || Math.max(thumb.width, thumb.height) > 360) throw new Error(tr('스토리 사진 크기를 확인해 주세요.'))
  const ratio = Math.min(1, 360 / Math.max(image.width, image.height))
  if (thumb.width !== Math.max(1, Math.round(image.width * ratio)) || thumb.height !== Math.max(1, Math.round(image.height * ratio))) throw new Error(tr('본문과 미리보기 사진 비율이 다릅니다.'))
  return { full, thumbnail }
}
