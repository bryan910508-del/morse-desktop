import { object } from './validation'
import { storyPublicationIntent, type StoryPublicationIntent } from './story-publication'
import { tr } from './i18n'
export interface StoryPublicationTime { createdAt: number; expiresAt: number }
export interface StoryPublicationCommitRequest { intent: StoryPublicationIntent; time: StoryPublicationTime }
export function storyPublicationTime(raw: unknown): StoryPublicationTime {
  const v = object(raw)
  if (Object.keys(v).some(key => !['createdAt', 'expiresAt'].includes(key)) || typeof v.createdAt !== 'number' || !Number.isSafeInteger(v.createdAt) || v.createdAt < 1 || typeof v.expiresAt !== 'number' || !Number.isSafeInteger(v.expiresAt) || v.expiresAt > 253402300799999 || v.expiresAt - v.createdAt !== 86400000) throw new Error(tr('게시 시각과 만료 시각을 확인해 주세요.'))
  return { createdAt: v.createdAt, expiresAt: v.expiresAt }
}
export function storyPublicationCommitRequest(raw: unknown): StoryPublicationCommitRequest {
  const v = object(raw)
  if (Object.keys(v).some(key => !['intent', 'time'].includes(key))) throw new Error(tr('게시할 스토리 기록을 확인해 주세요.'))
  return { intent: storyPublicationIntent(v.intent), time: storyPublicationTime(v.time) }
}
