import { object } from './validation'
import { backgroundPhotoId } from './chat-background'
import { storyComposerPhotoTarget, type StoryComposerPhotoTarget } from './story-composer-photo'
import { tr } from './i18n'
export const maxStoryVideoInputBytes = 50 * 1024 * 1024
export interface StoryVideoHeaderInfo { declaredDuration: number; trackWidth: number; trackHeight: number; hasAudioTrack: boolean }
export interface StoryVideoCandidate extends StoryVideoHeaderInfo { id: string; bytes: number; sha256: string; expiresAt: number }
export interface StoryVideoSource extends StoryComposerPhotoTarget { sourceId: string }
export interface StoryVideoPosterRequest extends StoryVideoSource { posterId: string; duration: number; width: number; height: number; frameTime: number }
export interface StoryVideoPoster { sourceId: string; posterId: string; width: number; height: number; frameTime: number; bytes: number; sha256: string }
export function storyVideoSource(raw: unknown): StoryVideoSource {
  const v = object(raw)
  if (Object.keys(v).some(k => !['id', 'draftRevision', 'sourceId'].includes(k))) throw new Error(tr('현재 초안에서 선택한 영상을 확인해 주세요.'))
  return { ...storyComposerPhotoTarget({ id: v.id, draftRevision: v.draftRevision }), sourceId: backgroundPhotoId(v.sourceId) }
}
export function storyVideoPosterRequest(raw: unknown): StoryVideoPosterRequest {
  const v = object(raw)
  if (Object.keys(v).some(k => !['id', 'draftRevision', 'sourceId', 'posterId', 'duration', 'width', 'height', 'frameTime'].includes(k)) || typeof v.duration !== 'number' || !Number.isFinite(v.duration) || v.duration < 0.5 || v.duration > 60 || typeof v.width !== 'number' || !Number.isInteger(v.width) || v.width < 1 || v.width > 4096 || typeof v.height !== 'number' || !Number.isInteger(v.height) || v.height < 1 || v.height > 4096 || v.width * v.height > 8 * 1024 * 1024 || typeof v.frameTime !== 'number' || !Number.isFinite(v.frameTime) || v.frameTime < 0 || v.frameTime > v.duration) throw new Error(tr('현재 영상의 길이·크기·선택 시점을 확인해 주세요.'))
  return { ...storyVideoSource({ id: v.id, draftRevision: v.draftRevision, sourceId: v.sourceId }), posterId: backgroundPhotoId(v.posterId), duration: v.duration, width: v.width, height: v.height, frameTime: v.frameTime }
}
