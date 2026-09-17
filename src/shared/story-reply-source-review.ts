import { object } from './validation'
import { backgroundPhotoId } from './chat-background'
import { storyReplySendRequest, type StoryReplySendRequest } from './story-reply-send'
import { tr } from './i18n'
export interface StoryReplyCurrentSource { version: string; expiresAt: number; captionPreview: string }
export interface StoryReplySourceReview extends StoryReplySendRequest { outcome: 'unchanged' | 'changed' | 'expired' | 'absent' | 'unavailable'; current: StoryReplyCurrentSource | null; observedAt: number }
export interface StoryReplySourceRebase { id: string; expected: string; revision: string; current: StoryReplyCurrentSource }
export function storyReplyCurrentSource(raw: unknown): StoryReplyCurrentSource {
  const v = object(raw)
  if (Object.keys(v).some(k => !['version', 'expiresAt', 'captionPreview'].includes(k)) || typeof v.version !== 'string' || !/^\d{1,12}:\d{1,9}$/.test(v.version) || typeof v.expiresAt !== 'number' || !Number.isFinite(v.expiresAt) || v.expiresAt <= 0 || v.expiresAt > 8640000000000000 || typeof v.captionPreview !== 'string' || v.captionPreview.length > 320) throw new Error(tr('현재 스토리 출처를 다시 확인해 주세요.'))
  return { version: v.version, expiresAt: v.expiresAt, captionPreview: v.captionPreview }
}
export function storyReplySourceRebase(raw: unknown): StoryReplySourceRebase {
  const v = object(raw)
  if (Object.keys(v).some(k => !['id', 'expected', 'revision', 'current'].includes(k))) throw new Error(tr('출처 갱신 요청을 확인해 주세요.'))
  const target = storyReplySendRequest({ id: v.id, revision: v.expected }), revision = backgroundPhotoId(v.revision)
  if (target.revision === revision) throw new Error(tr('새 저장 버전이 필요합니다.'))
  return { id: target.id, expected: target.revision, revision, current: storyReplyCurrentSource(v.current) }
}
