import { object } from './validation'
import { backgroundPhotoId } from './chat-background'
import { storyCaptionComparisonRequest, type StoryCaptionComparisonRequest, type StoryCaptionCurrent } from './story-caption-comparison'
import { storyCaptionDraft, type StoryCaptionDraft } from './story-caption-drafts'
import { tr } from './i18n'
export interface StoryCaptionRebaseRequest extends StoryCaptionComparisonRequest { revision: string; draft: StoryCaptionDraft; current: StoryCaptionCurrent; mode: 'keep-input' | 'use-current' }
export function storyCaptionRebaseRequest(raw: unknown): StoryCaptionRebaseRequest {
  const v = object(raw), current = object(v.current)
  if (Object.keys(v).some(k => !['id', 'storyId', 'privacy', 'draftRevision', 'revision', 'draft', 'current', 'mode'].includes(k)) || Object.keys(current).some(k => !['version', 'caption', 'expiresAt'].includes(k)) || (v.mode !== 'keep-input' && v.mode !== 'use-current') || typeof current.expiresAt !== 'number' || !Number.isFinite(current.expiresAt) || current.expiresAt <= 0) throw new Error(tr('원문 변경 방법과 현재 서버 설명을 확인해 주세요.'))
  const target = storyCaptionComparisonRequest({ id: v.id, storyId: v.storyId, privacy: v.privacy, draftRevision: v.draftRevision }), revision = backgroundPhotoId(v.revision)
  if (revision === target.draftRevision) throw new Error(tr('새 기기 저장 버전이 필요합니다.'))
  const checked = storyCaptionDraft({ baseVersion: current.version, baseCaption: current.caption, caption: current.caption })
  return { ...target, revision, draft: storyCaptionDraft(v.draft), current: { version: checked.baseVersion, caption: checked.caption, expiresAt: current.expiresAt }, mode: v.mode }
}
export function rebasedStoryCaptionDraft(request: StoryCaptionRebaseRequest): StoryCaptionDraft {
  return { baseVersion: request.current.version, baseCaption: request.current.caption, caption: request.mode === 'keep-input' ? request.draft.caption : request.current.caption }
}
