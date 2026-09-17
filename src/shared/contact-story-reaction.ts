import { object, identifier } from './validation'
import { backgroundPhotoId } from './chat-background'
import type { StoryPrivacy } from './own-stories'
import { tr } from './i18n'
export const storyReactionChoices = ['❤️', '👍', '🔥', '😂', '😮', '😢'] as const
export interface ContactStoryReactionTarget { profileRequestId: string; requestId: string; storyId: string; version: string; privacy: StoryPrivacy; audienceId: string | null }
export interface ContactStoryReactionRequest extends ContactStoryReactionTarget { id: string }
export interface ContactStoryReactionValue { field: 'missing' | 'absent' | 'stored'; value: string | null; supported: boolean }
export interface ContactStoryReactionResult extends ContactStoryReactionRequest { ownerId: string; outcome: 'ready' | 'changed' | 'expired' | 'absent' | 'unavailable'; current: ContactStoryReactionValue | null; observedAt: number; expiresAt: number; message: string }
export function contactStoryReactionRequest(raw: unknown): ContactStoryReactionRequest {
  const v = object(raw)
  if (Object.keys(v).some(key => !['id', 'profileRequestId', 'requestId', 'storyId', 'version', 'privacy', 'audienceId'].includes(key)) || (v.privacy !== 'everyone' && v.privacy !== 'contacts' && v.privacy !== 'closeFriends') || (v.privacy === 'everyone' && v.audienceId !== null) || typeof v.version !== 'string' || !/^\d{1,12}:\d{1,9}$/.test(v.version)) throw new Error(tr('현재 스토리 설명에서 본인의 반응을 확인해 주세요.'))
  return { id: backgroundPhotoId(v.id), profileRequestId: identifier(v.profileRequestId), requestId: identifier(v.requestId), storyId: identifier(v.storyId), version: v.version, privacy: v.privacy, audienceId: v.privacy === 'everyone' ? null : backgroundPhotoId(v.audienceId) }
}
