import { object, identifier } from './validation'
import { backgroundPhotoId } from './chat-background'
import { contactStoryReactionRequest, storyReactionChoices, type ContactStoryReactionRequest } from './contact-story-reaction'
import { storyCaptionDraftTarget } from './story-caption-drafts'
import type { StoryPrivacy } from './own-stories'
import { tr } from './i18n'
export type StoryReactionChoice = typeof storyReactionChoices[number]
export interface StoryReactionChangePrepare extends ContactStoryReactionRequest { choice: StoryReactionChoice | 'remove' }
export interface StoryReactionChangeRequest { id: string; viewerId: string; ownerId: string; ownerName: string; storyId: string; privacy: StoryPrivacy; version: string; expiresAt: number; captionPreview: string; original: string | null; desired: StoryReactionChoice | null }
export type StoryReactionChangeState = 'prepared' | 'submitted' | 'confirmed' | 'rejected'
export interface PendingStoryReactionChange extends StoryReactionChangeRequest { state: StoryReactionChangeState }
export interface StoryReactionChangeObservation { outcome: 'matching' | 'original' | 'different' | 'expired' | 'absent' | 'unavailable'; observedAt: number; message: string }
export interface StoryReactionChangeSnapshot { status: 'loading' | 'ready' | 'error'; busy: boolean; canSend: boolean; canCheck: boolean; observation: StoryReactionChangeObservation | null; pending: PendingStoryReactionChange | null; message: string }
export interface StoryReactionChangeAction { id: string; state: StoryReactionChangeState; action: 'send' | 'check' | 'dismiss' }
function choice(value: unknown): StoryReactionChoice { if (!storyReactionChoices.some(emoji => emoji === value)) throw new Error(tr('지원하는 반응을 선택해 주세요.')); return value as StoryReactionChoice }
function original(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || !value || value.length > 64 || Array.from(value).some(char => { const code = char.codePointAt(0)!; return code >= 0xD800 && code <= 0xDFFF })) throw new Error(tr('저장된 반응 형식을 확인해 주세요.'))
  return value
}
export function storyReactionChangePrepare(raw: unknown): StoryReactionChangePrepare { const { choice: selected, ...target } = object(raw); return { ...contactStoryReactionRequest(target), choice: selected === 'remove' ? 'remove' : choice(selected) } }
export function storyReactionChangeRequest(raw: unknown): StoryReactionChangeRequest {
  const v = object(raw)
  if (Object.keys(v).some(key => !['id','viewerId','ownerId','ownerName','storyId','privacy','version','expiresAt','captionPreview','original','desired'].includes(key)) || typeof v.ownerName !== 'string' || v.ownerName.length > 512 || typeof v.captionPreview !== 'string' || v.captionPreview.length > 320 || typeof v.version !== 'string' || !/^\d{1,12}:\d{1,9}$/.test(v.version) || typeof v.expiresAt !== 'number' || !Number.isFinite(v.expiresAt) || v.expiresAt <= 0) throw new Error(tr('반응 변경 검토 내용을 확인해 주세요.'))
  const viewerId = identifier(v.viewerId), ownerId = identifier(v.ownerId), before = original(v.original), desired = v.desired === null ? null : choice(v.desired)
  if (viewerId === ownerId || before === desired) throw new Error(tr('타인 스토리에 남길 반응 변경을 선택해 주세요.'))
  return { ...storyCaptionDraftTarget({ storyId: v.storyId, privacy: v.privacy }), id: backgroundPhotoId(v.id), viewerId, ownerId, ownerName: v.ownerName, version: v.version, expiresAt: v.expiresAt, captionPreview: v.captionPreview, original: before, desired }
}
export function storyReactionChangeAction(raw: unknown): StoryReactionChangeAction { const v = object(raw); if (Object.keys(v).some(key => !['id','state','action'].includes(key)) || typeof v.state !== 'string' || !['prepared','submitted','confirmed','rejected'].includes(v.state) || (v.action !== 'send' && v.action !== 'check' && v.action !== 'dismiss')) throw new Error(tr('현재 반응 검토 기록을 확인해 주세요.')); return { id: backgroundPhotoId(v.id), state: v.state as StoryReactionChangeState, action: v.action } }
