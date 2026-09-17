import { backgroundPhotoId } from './chat-background'
import { identifier, object } from './validation'
import { storyCaptionDraftTarget } from './story-caption-drafts'
import type { StoryPrivacy } from './own-stories'
import { tr } from './i18n'
export interface StoryPrivacyMovePrepare { id: string; requestId: string; storyId: string; privacy: StoryPrivacy; desired: StoryPrivacy; version: string }
export interface StoryPrivacyMoveRequest { id: string; storyId: string; privacy: StoryPrivacy; desired: StoryPrivacy; version: string; caption: string; mediaType: 'image' | 'video'; expiresAt: number; ownerId: string }
export type StoryPrivacyMoveState = 'prepared' | 'submitted' | 'confirmed' | 'rejected'
export interface PendingStoryPrivacyMove extends StoryPrivacyMoveRequest { state: StoryPrivacyMoveState }
export interface StoryPrivacyMoveObservation { outcome: 'source-only' | 'destination-only' | 'both' | 'neither' | 'unavailable'; observedAt: number; message: string }
export interface StoryPrivacyMoveSnapshot { observation: StoryPrivacyMoveObservation | null; canCheck: boolean; status: 'loading' | 'ready' | 'error'; busy: boolean; canSend: boolean; pending: PendingStoryPrivacyMove | null; message: string }
export interface StoryPrivacyMoveAction { id: string; state: StoryPrivacyMoveState; action: 'send' | 'check' | 'dismiss' }
function version(raw: unknown): string { if (typeof raw !== 'string' || !/^\d{1,12}:\d{1,9}$/.test(raw)) throw new Error(tr('현재 스토리 버전을 확인해 주세요.')); return raw }
function target(v: Record<string, unknown>): { storyId: string; privacy: StoryPrivacy; desired: StoryPrivacy } {
  const source = storyCaptionDraftTarget({ storyId: v.storyId, privacy: v.privacy }), desired = storyCaptionDraftTarget({ storyId: v.storyId, privacy: v.desired }).privacy
  if (source.privacy === desired) throw new Error(tr('다른 공개 범위를 선택해 주세요.'))
  return { ...source, desired }
}
export function storyPrivacyMovePrepare(raw: unknown): StoryPrivacyMovePrepare {
  const v = object(raw)
  if (Object.keys(v).some(k => !['id', 'requestId', 'storyId', 'privacy', 'desired', 'version'].includes(k))) throw new Error(tr('현재 스토리의 공개 범위에서 다시 선택해 주세요.'))
  return { ...target(v), id: backgroundPhotoId(v.id), requestId: identifier(v.requestId), version: version(v.version) }
}
export function storyPrivacyMoveRequest(raw: unknown): StoryPrivacyMoveRequest {
  const v = object(raw)
  if (Object.keys(v).some(k => !['id', 'storyId', 'privacy', 'desired', 'version', 'caption', 'mediaType', 'expiresAt', 'ownerId'].includes(k)) || typeof v.caption !== 'string' || v.caption.length > 8000 || (v.mediaType !== 'image' && v.mediaType !== 'video') || typeof v.expiresAt !== 'number' || !Number.isFinite(v.expiresAt) || v.expiresAt <= 0) throw new Error(tr('공개 범위를 바꿀 스토리와 현재 계정을 확인해 주세요.'))
  return { ...target(v), id: backgroundPhotoId(v.id), version: version(v.version), caption: v.caption, mediaType: v.mediaType, expiresAt: v.expiresAt, ownerId: identifier(v.ownerId) }
}
export function storyPrivacyMoveAction(raw: unknown): StoryPrivacyMoveAction {
  const v = object(raw)
  if (Object.keys(v).some(k => !['id', 'state', 'action'].includes(k)) || typeof v.state !== 'string' || !['prepared', 'submitted', 'confirmed', 'rejected'].includes(v.state) || (v.action !== 'send' && v.action !== 'check' && v.action !== 'dismiss')) throw new Error(tr('최신 공개 범위 변경 기록을 확인해 주세요.'))
  return { id: backgroundPhotoId(v.id), state: v.state as StoryPrivacyMoveState, action: v.action }
}
