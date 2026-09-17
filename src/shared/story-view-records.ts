import { object, identifier } from './validation'
import { backgroundPhotoId } from './chat-background'
import { storyCaptionDraftTarget, type StoryCaptionDraftTarget } from './story-caption-drafts'
import { tr } from './i18n'
export interface StoryViewRecordsRequest extends StoryCaptionDraftTarget { id: string; requestId: string; version: string }
export interface StoryViewRecordRow { uid: string; viewed: boolean; reaction: string | null; reposted: boolean; forwarded: boolean; latestAt: number | null }
export interface StoryViewRecordData { rows: StoryViewRecordRow[]; counts: { viewers: number; reactions: number; reposts: number; forwards: number }; missing: string[] }
export interface StoryViewRecordsResult extends StoryViewRecordsRequest {
  outcome: 'ready' | 'changed' | 'absent' | 'expired' | 'unavailable'
  observedAt: number
  current: (StoryViewRecordData & { expiresAt: number }) | null
  message: string
}
export function storyViewRecordsRequest(raw: unknown): StoryViewRecordsRequest {
  const v = object(raw)
  if (Object.keys(v).some(key => !['id', 'requestId', 'storyId', 'privacy', 'version'].includes(key)) || typeof v.version !== 'string' || !/^\d{1,12}:\d{1,9}$/.test(v.version)) throw new Error(tr('현재 내 스토리에서 열람 기록을 확인해 주세요.'))
  return { ...storyCaptionDraftTarget({ storyId: v.storyId, privacy: v.privacy }), id: backgroundPhotoId(v.id), requestId: identifier(v.requestId), version: v.version }
}
