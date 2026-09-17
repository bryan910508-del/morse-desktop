import { identifier } from './validation'
import { tr } from './i18n'

// Dialogs::Stories row: active stories of me and my contacts (iOS chat list story bar).
export const maxStoryBarPeers = 40
export interface StoryBarEntry { uid: string; count: number; unseen: number; latestAt: number; expiresAt: number }
export interface StoryBarResult { entries: StoryBarEntry[]; observedAt: number; partial: boolean }

export function storyBarPeers(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length > maxStoryBarPeers) throw new Error(tr('스토리를 확인할 연락처를 다시 선택해 주세요.'))
  return [...new Set(raw.map(identifier))]
}
