import { object } from './validation'
import { backgroundPhotoId } from './chat-background'
import { storyComposerPhotoTarget, type StoryComposerPhotoTarget } from './story-composer-photo'
import type { StoryVideoHeaderInfo } from './story-composer-video'
import { tr } from './i18n'
export interface StoryComposerVideoRecord { id: string; revision: string | null; video: (StoryVideoHeaderInfo & { sourceId: string; posterId: string; bytes: number; posterBytes: number; sha256: string; posterSha256: string; md5: string; posterMD5: string; frameTime: number; posterWidth: number; posterHeight: number }) | null }
export interface StoryComposerVideoWrite extends StoryComposerPhotoTarget { expected: string | null; expectedPhoto: string | null; revision: string; media: { sourceId: string; posterId: string } | null }
export interface StoryComposerVideoReference { id: string; revision: string; sourceId: string; posterId: string }
export interface StoryComposerVideoView { token: string; videoURL: string; posterURL: string; expiresAt: number; record: StoryComposerVideoRecord }
export interface StoryComposerVideoStoredSource { record: StoryComposerVideoRecord; pair: StoryComposerVideoPair }
export function storyComposerVideoReference(raw: unknown): StoryComposerVideoReference {
  const v = object(raw)
  if (Object.keys(v).some(k => !['id', 'revision', 'sourceId', 'posterId'].includes(k))) throw new Error(tr('현재 저장한 영상 기록을 선택해 주세요.'))
  return { id: backgroundPhotoId(v.id), revision: backgroundPhotoId(v.revision), sourceId: backgroundPhotoId(v.sourceId), posterId: backgroundPhotoId(v.posterId) }
}
export interface StoryComposerVideoPair { video: Uint8Array; poster: Uint8Array; frameTime: number }
export function storyComposerVideoWrite(raw: unknown): StoryComposerVideoWrite {
  const v = object(raw)
  if (Object.keys(v).some(k => !['id', 'draftRevision', 'expected', 'expectedPhoto', 'revision', 'media'].includes(k))) throw new Error(tr('현재 영상 저장본을 확인해 주세요.'))
  const media = v.media === null ? null : object(v.media)
  if (media && Object.keys(media).some(k => !['sourceId', 'posterId'].includes(k))) throw new Error(tr('영상과 포스터 식별자를 확인해 주세요.'))
  return { ...storyComposerPhotoTarget({ id: v.id, draftRevision: v.draftRevision }), expected: v.expected === null ? null : backgroundPhotoId(v.expected), expectedPhoto: v.expectedPhoto === null ? null : backgroundPhotoId(v.expectedPhoto), revision: backgroundPhotoId(v.revision), media: media ? { sourceId: backgroundPhotoId(media.sourceId), posterId: backgroundPhotoId(media.posterId) } : null }
}
