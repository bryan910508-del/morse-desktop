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

// Telegram R-59 (dialogs_widget.cpp hides the stories row only when it has nothing): a load some reads failed in
// keeps the people it could not read as they were, and a failed load changes nothing; only stories that have expired
// leave. Until 0.241.1 a dropped connection emptied the row (B47).
export function mergeStoryBar(previous: StoryBarEntry[], result: StoryBarResult, now = Date.now()): StoryBarEntry[] {
  const next = new Map(result.entries.map(entry => [entry.uid, entry]))
  if (result.partial) for (const entry of previous) if (!next.has(entry.uid)) next.set(entry.uid, entry)
  return [...next.values()].filter(entry => entry.expiresAt > now)
}
