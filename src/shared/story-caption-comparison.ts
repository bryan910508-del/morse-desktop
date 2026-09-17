import { object } from './validation'
import { backgroundPhotoId } from './chat-background'
import { storyCaptionDraftTarget, type StoryCaptionDraftTarget } from './story-caption-drafts'
import { tr } from './i18n'
export interface StoryCaptionComparisonRequest extends StoryCaptionDraftTarget { id: string; draftRevision: string }
export interface StoryCaptionCurrent { version: string; caption: string; expiresAt: number }
export interface StoryCaptionComparisonResult extends StoryCaptionComparisonRequest { outcome: 'unchanged' | 'changed' | 'absent' | 'expired' | 'unavailable'; observedAt: number; current: StoryCaptionCurrent | null; message: string }
export function storyCaptionComparisonRequest(raw: unknown): StoryCaptionComparisonRequest {
  const v = object(raw)
  if (Object.keys(v).some(k => !['id', 'storyId', 'privacy', 'draftRevision'].includes(k))) throw new Error(tr('현재 저장된 설명 초안에서 비교해 주세요.'))
  return { ...storyCaptionDraftTarget({ storyId: v.storyId, privacy: v.privacy }), id: backgroundPhotoId(v.id), draftRevision: backgroundPhotoId(v.draftRevision) }
}
