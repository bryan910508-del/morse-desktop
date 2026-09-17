import { identifier, object } from './validation'
import { backgroundPhotoId } from './chat-background'
import { storyCaptionDraftTarget } from './story-caption-drafts'
import { contactStoryReactionRequest, type ContactStoryReactionRequest } from './contact-story-reaction'
import type { StoryPrivacy } from './own-stories'
import { tr } from './i18n'
export interface StoryReplyDraftPrepare extends ContactStoryReactionRequest {}
export interface StoryReplyDraftRequest { id: string; viewerId: string; ownerId: string; ownerName: string; storyId: string; privacy: StoryPrivacy; version: string; expiresAt: number; captionPreview: string }
export type StoryReplyDraftState = 'prepared'
export interface PendingStoryReplyDraft extends StoryReplyDraftRequest { state: StoryReplyDraftState; text: string; revision: string }
export interface StoryReplyDraftSnapshot { status: 'loading' | 'ready' | 'error'; busy: boolean; pending: PendingStoryReplyDraft | null; message: string }
export interface StoryReplyDraftAction { id: string; state: StoryReplyDraftState; revision: string; action: 'dismiss' }
export function storyReplyDraftPrepare(raw: unknown): StoryReplyDraftPrepare { try { return contactStoryReactionRequest(raw) } catch { throw new Error(tr('현재 스토리에서 답장할 출처를 선택해 주세요.')) } }
export function storyReplyDraftRequest(raw: unknown): StoryReplyDraftRequest {
  const v = object(raw)
  if (Object.keys(v).some(k => !['id','viewerId','ownerId','ownerName','storyId','privacy','version','expiresAt','captionPreview'].includes(k)) || typeof v.ownerName !== 'string' || !v.ownerName.trim() || v.ownerName.length > 512 || Array.from(v.ownerName).some(char => { const code = char.codePointAt(0)!; return code >= 0xD800 && code <= 0xDFFF }) || typeof v.captionPreview !== 'string' || v.captionPreview.length > 320 || typeof v.version !== 'string' || !/^\d{1,12}:\d{1,9}$/.test(v.version) || typeof v.expiresAt !== 'number' || !Number.isFinite(v.expiresAt) || v.expiresAt <= 0) throw new Error(tr('스토리 답장 준비 내용을 확인해 주세요.'))
  const viewerId = identifier(v.viewerId), ownerId = identifier(v.ownerId)
  if (viewerId === ownerId) throw new Error(tr('타인 스토리의 작성자에게 답장을 준비해 주세요.'))
  return { ...storyCaptionDraftTarget({ storyId: v.storyId, privacy: v.privacy }), id: backgroundPhotoId(v.id), viewerId, ownerId, ownerName: v.ownerName, version: v.version, expiresAt: v.expiresAt, captionPreview: v.captionPreview }
}
export function storyReplyDraftAction(raw: unknown): StoryReplyDraftAction { const v = object(raw); if (Object.keys(v).some(k => !['id','state','revision','action'].includes(k)) || v.state !== 'prepared' || v.action !== 'dismiss') throw new Error(tr('현재 답장 준비 기록을 확인해 주세요.')); return { id: backgroundPhotoId(v.id), state: v.state, revision: backgroundPhotoId(v.revision), action: v.action } }
