import { identifier, object } from './validation'
import { backgroundPhotoId } from './chat-background'
import { storyCaptionDraftTarget } from './story-caption-drafts'
import { contactStoryViewRecordRequest, type ContactStoryViewRecordRequest } from './contact-story-view-record'
import type { StoryPrivacy } from './own-stories'
import { tr } from './i18n'
export interface StoryViewReceiptPrepare extends ContactStoryViewRecordRequest {}
export interface StoryViewReceiptRequest { id: string; viewerId: string; ownerId: string; ownerName: string; storyId: string; privacy: StoryPrivacy; version: string; expiresAt: number; captionPreview: string; viewerFieldPresent: boolean; originalTimeField: 'missing' | 'absent' | 'stored'; originalViewedAt: number | null }
export type StoryViewReceiptState = 'prepared' | 'submitted' | 'confirmed' | 'rejected'
export interface PendingStoryViewReceipt extends StoryViewReceiptRequest { state: StoryViewReceiptState }
export interface StoryViewReceiptObservation { outcome: 'recorded' | 'original' | 'different' | 'expired' | 'absent' | 'unavailable'; observedAt: number; message: string }
export interface StoryViewReceiptSnapshot { status: 'loading' | 'ready' | 'error'; busy: boolean; canSend: boolean; canCheck: boolean; observation: StoryViewReceiptObservation | null; pending: PendingStoryViewReceipt | null; message: string }
export interface StoryViewReceiptAction { id: string; state: StoryViewReceiptState; action: 'send' | 'check' | 'dismiss' }
export function storyViewReceiptPrepare(raw: unknown): StoryViewReceiptPrepare { return contactStoryViewRecordRequest(raw) }
export function storyViewReceiptRequest(raw: unknown): StoryViewReceiptRequest {
  const v = object(raw)
  if (Object.keys(v).some(k => !['id','viewerId','ownerId','ownerName','storyId','privacy','version','expiresAt','captionPreview','viewerFieldPresent','originalTimeField','originalViewedAt'].includes(k)) || typeof v.ownerName !== 'string' || v.ownerName.length > 512 || typeof v.captionPreview !== 'string' || v.captionPreview.length > 320 || typeof v.version !== 'string' || !/^\d{1,12}:\d{1,9}$/.test(v.version) || typeof v.expiresAt !== 'number' || !Number.isFinite(v.expiresAt) || v.expiresAt <= 0 || typeof v.viewerFieldPresent !== 'boolean' || !['missing','absent','stored'].includes(v.originalTimeField as string) || (v.originalTimeField === 'stored' ? typeof v.originalViewedAt !== 'number' || !Number.isFinite(v.originalViewedAt) || Math.abs(v.originalViewedAt) > 8640000000000000 : v.originalViewedAt !== null)) throw new Error(tr('열람 기록 준비 내용을 확인해 주세요.'))
  const viewerId = identifier(v.viewerId), ownerId = identifier(v.ownerId)
  if (viewerId === ownerId) throw new Error(tr('타인 스토리만 열람 기록을 준비할 수 있습니다.'))
  return { ...storyCaptionDraftTarget({ storyId: v.storyId, privacy: v.privacy }), id: backgroundPhotoId(v.id), viewerId, ownerId, ownerName: v.ownerName, version: v.version, expiresAt: v.expiresAt, captionPreview: v.captionPreview, viewerFieldPresent: v.viewerFieldPresent, originalTimeField: v.originalTimeField as StoryViewReceiptRequest['originalTimeField'], originalViewedAt: v.originalViewedAt as number | null }
}
export function storyViewReceiptAction(raw: unknown): StoryViewReceiptAction { const v = object(raw); if (Object.keys(v).some(k => !['id','state','action'].includes(k)) || typeof v.state !== 'string' || !['prepared','submitted','confirmed','rejected'].includes(v.state) || (v.action !== 'send' && v.action !== 'check' && v.action !== 'dismiss')) throw new Error(tr('현재 열람 준비 기록을 확인해 주세요.')); return { id: backgroundPhotoId(v.id), state: v.state as StoryViewReceiptState, action: v.action } }
