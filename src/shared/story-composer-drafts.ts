import { object, identifier } from './validation'
import { backgroundPhotoId } from './chat-background'
import type { StoryPrivacy } from './own-stories'
import { tr } from './i18n'
export interface StoryComposerDraftTarget { id: string }
export interface StoryComposerDraftContent { caption: string; privacy: StoryPrivacy; hiddenFrom: string[] }
export interface StoryComposerDraftRecord extends StoryComposerDraftTarget { draft: StoryComposerDraftContent | null; revision: string | null }
export interface StoryComposerDraftRow extends StoryComposerDraftTarget { preview: string; privacy: StoryPrivacy; hiddenCount: number; revision: string }
export interface StoryComposerDraftWrite extends StoryComposerDraftTarget { draft: StoryComposerDraftContent | null; expected: string | null; revision: string }
export function storyComposerDraftTarget(raw: unknown): StoryComposerDraftTarget {
  const v = object(raw)
  if (Object.keys(v).some(key => key !== 'id')) throw new Error(tr('새 스토리 초안을 선택해 주세요.'))
  return { id: backgroundPhotoId(v.id) }
}
export function storyComposerDraftContent(raw: unknown): StoryComposerDraftContent {
  const v = object(raw)
  if (Object.keys(v).some(key => !['caption', 'privacy', 'hiddenFrom'].includes(key)) || typeof v.caption !== 'string' || v.caption.length > 8000 || (v.privacy !== 'contacts' && v.privacy !== 'everyone' && v.privacy !== 'closeFriends') || !Array.isArray(v.hiddenFrom) || v.hiddenFrom.length > 1000) throw new Error(tr('설명과 공개 범위·숨김 대상의 기기 저장 범위를 확인해 주세요.'))
  const hiddenFrom = v.hiddenFrom.map(identifier)
  if (new Set(hiddenFrom).size !== hiddenFrom.length) throw new Error(tr('중복된 숨김 대상입니다.'))
  return { caption: v.caption, privacy: v.privacy, hiddenFrom }
}
export function storyComposerDraftWrite(raw: unknown): StoryComposerDraftWrite {
  const v = object(raw)
  if (Object.keys(v).some(key => !['id', 'draft', 'expected', 'revision'].includes(key)) || v.expected === undefined) throw new Error(tr('현재 초안의 저장 버전을 확인해 주세요.'))
  const expected = v.expected === null ? null : backgroundPhotoId(v.expected), revision = backgroundPhotoId(v.revision)
  if (expected === revision) throw new Error(tr('새 저장 버전이 필요합니다.'))
  return { id: backgroundPhotoId(v.id), draft: v.draft === null ? null : storyComposerDraftContent(v.draft), expected, revision }
}
