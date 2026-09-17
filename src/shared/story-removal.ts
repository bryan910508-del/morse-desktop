import { storyCaptionDraftTarget, type StoryCaptionDraftTarget } from './story-caption-drafts'
import { backgroundPhotoId } from './chat-background'
import { identifier, object } from './validation'
import { tr } from './i18n'
export interface StoryRemovalPrepare extends StoryCaptionDraftTarget { id: string; requestId: string; version: string }
export interface StoryRemovalRequest extends StoryCaptionDraftTarget { id: string; version: string; caption: string; mediaType: 'image' | 'video' | 'unknown'; expiresAt: number; ownerId: string }
export type StoryRemovalState = 'prepared' | 'submitted' | 'confirmed' | 'rejected'
export interface PendingStoryRemoval extends StoryRemovalRequest { state: StoryRemovalState }
export interface StoryRemovalObservation { outcome: 'original' | 'different' | 'expired' | 'absent' | 'unavailable'; observedAt: number; message: string }
export interface StoryRemovalSnapshot { observation: StoryRemovalObservation | null; canCheck: boolean; status: 'loading' | 'ready' | 'error'; busy: boolean; canSend: boolean; pending: PendingStoryRemoval | null; message: string }
export interface StoryRemovalAction { id: string; state: StoryRemovalState; action: 'send' | 'check' | 'dismiss' }
function version(raw: unknown): string { if (typeof raw !== 'string' || !/^\d{1,12}:\d{1,9}$/.test(raw)) throw new Error(tr('현재 스토리의 버전을 확인해 주세요.')); return raw }
export function storyRemovalPrepare(raw: unknown): StoryRemovalPrepare {
  const v = object(raw)
  if (Object.keys(v).some(k => !['id', 'requestId', 'storyId', 'privacy', 'version'].includes(k))) throw new Error(tr('현재 스토리에서 삭제할 내용을 확인해 주세요.'))
  return { ...storyCaptionDraftTarget({ storyId: v.storyId, privacy: v.privacy }), id: backgroundPhotoId(v.id), requestId: identifier(v.requestId), version: version(v.version) }
}
export function storyRemovalRequest(raw: unknown): StoryRemovalRequest {
  const v = object(raw)
  if (Object.keys(v).some(k => !['id', 'storyId', 'privacy', 'version', 'caption', 'mediaType', 'expiresAt', 'ownerId'].includes(k)) || typeof v.caption !== 'string' || v.caption.length > 8000 || (v.mediaType !== 'image' && v.mediaType !== 'video' && v.mediaType !== 'unknown') || typeof v.expiresAt !== 'number' || !Number.isFinite(v.expiresAt) || v.expiresAt <= 0) throw new Error(tr('삭제할 스토리 원문과 현재 계정을 확인해 주세요.'))
  return { ...storyCaptionDraftTarget({ storyId: v.storyId, privacy: v.privacy }), id: backgroundPhotoId(v.id), version: version(v.version), caption: v.caption, mediaType: v.mediaType as StoryRemovalRequest['mediaType'], expiresAt: v.expiresAt, ownerId: identifier(v.ownerId) }
}
export function storyRemovalAction(raw: unknown): StoryRemovalAction {
  const v = object(raw)
  if (Object.keys(v).some(k => !['id', 'state', 'action'].includes(k)) || typeof v.state !== 'string' || !['prepared', 'submitted', 'confirmed', 'rejected'].includes(v.state) || (v.action !== 'send' && v.action !== 'check' && v.action !== 'dismiss')) throw new Error(tr('최신 스토리 삭제 기록을 확인해 주세요.'))
  return { id: backgroundPhotoId(v.id), state: v.state as StoryRemovalState, action: v.action }
}
