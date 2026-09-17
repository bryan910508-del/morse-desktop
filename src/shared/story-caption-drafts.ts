import { backgroundPhotoId } from './chat-background'
import { identifier, object } from './validation'
import type { StoryPrivacy } from './own-stories'
import { tr } from './i18n'
export interface StoryCaptionDraftTarget { storyId: string; privacy: StoryPrivacy }
export interface StoryCaptionDraftStart extends StoryCaptionDraftTarget { requestId: string; version: string }
export interface StoryCaptionDraft { baseVersion: string; baseCaption: string; caption: string }
export interface StoryCaptionDraftRecord extends StoryCaptionDraftTarget { revision: string | null; draft: StoryCaptionDraft | null }
export interface StoryCaptionDraftRow extends StoryCaptionDraftTarget { preview: string; revision: string }
export interface StoryCaptionDraftWrite extends StoryCaptionDraftTarget { expected: string; revision: string; draft: StoryCaptionDraft | null }
const version = (raw: unknown): string => { if (typeof raw !== 'string' || !/^\d{1,12}:\d{1,9}$/.test(raw)) throw new Error(tr('스토리 원문 버전을 확인해 주세요.')); return raw }
const privacy = (raw: unknown): StoryPrivacy => { if (raw !== 'contacts' && raw !== 'everyone' && raw !== 'closeFriends') throw new Error(tr('스토리 공개 범위를 확인해 주세요.')); return raw }
export function storyCaptionDraftTarget(raw: unknown): StoryCaptionDraftTarget {
  const v = object(raw)
  if (Object.keys(v).some(k => !['storyId', 'privacy'].includes(k))) throw new Error(tr('설명 초안을 다시 선택해 주세요.'))
  return { storyId: identifier(v.storyId), privacy: privacy(v.privacy) }
}
export function storyCaptionDraftStart(raw: unknown): StoryCaptionDraftStart {
  const v = object(raw)
  if (Object.keys(v).some(k => !['storyId', 'privacy', 'requestId', 'version'].includes(k))) throw new Error(tr('현재 스토리에서 편집을 시작해 주세요.'))
  return { storyId: identifier(v.storyId), privacy: privacy(v.privacy), requestId: identifier(v.requestId), version: version(v.version) }
}
export function storyCaptionDraft(raw: unknown): StoryCaptionDraft {
  const v = object(raw)
  if (Object.keys(v).some(k => !['baseVersion', 'baseCaption', 'caption'].includes(k)) || [v.baseCaption, v.caption].some(value => typeof value !== 'string' || value.length > 8000)) throw new Error(tr('설명 초안의 기기 저장 범위를 확인해 주세요.'))
  return { baseVersion: version(v.baseVersion), baseCaption: v.baseCaption as string, caption: v.caption as string }
}
export function storyCaptionDraftWrite(raw: unknown): StoryCaptionDraftWrite {
  const v = object(raw)
  if (Object.keys(v).some(k => !['storyId', 'privacy', 'expected', 'revision', 'draft'].includes(k))) throw new Error(tr('현재 초안의 저장 버전을 확인해 주세요.'))
  const expected = backgroundPhotoId(v.expected), revision = backgroundPhotoId(v.revision)
  if (expected === revision) throw new Error(tr('새 저장 버전이 필요합니다.'))
  return { storyId: identifier(v.storyId), privacy: privacy(v.privacy), expected, revision, draft: v.draft === null ? null : storyCaptionDraft(v.draft) }
}
