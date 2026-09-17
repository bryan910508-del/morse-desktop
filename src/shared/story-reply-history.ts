import { object } from './validation'
import type { StoryReplySendReceipt } from './story-reply-send'
import { tr } from './i18n'
export interface StoryReplyHistoryRequest { before: number | null }
export interface StoryReplyHistoryItem extends StoryReplySendReceipt { sequence: number; createdAt: number; state: 'queued' | 'uncertain' | 'failed' | 'done' | 'discarded' }
export interface StoryReplyHistoryPage { items: StoryReplyHistoryItem[]; next: number | null }
export function storyReplyHistoryRequest(raw: unknown): StoryReplyHistoryRequest {
  const v = object(raw)
  if (Object.keys(v).some(k => k !== 'before') || (v.before !== null && (typeof v.before !== 'number' || !Number.isSafeInteger(v.before) || v.before <= 0))) throw new Error(tr('기기의 답장 기록 페이지를 다시 확인해 주세요.'))
  return { before: v.before as number | null }
}
