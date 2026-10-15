import { identifier } from '../../shared/validation'
import { positionMilliseconds } from '../../shared/model'
import type { StoryViewRecordData } from '../../shared/story-view-records'
import { childId, timestamp, type FirestoreDocument, type WireObject } from './firestore-values'

// B408 S2 (contracts/B408-stories-access.md §9·§14): who saw this account's story is its `views` subcollection — one
// document per viewer, `views/{viewer}` {viewedAt?, reaction?, repostedAt?, forwardedAt?}, read by the owner only — and the
// counts are the server's `storyStats/{storyId}` {viewCount, reactionCount, forwardCount, repostCount, recentViewerIds}
// (morse-story-feed.js countViews :179-203). tdesktop reads the viewers as a list (stories.getStoryViewsList,
// data_stories.cpp:1478·1603) and the counts apart (stories.getStoriesViews :1674-1680). A person's row time is the latest
// of their marks, newest first (iOS MorseStoryViewList :44-55).
export const maxStoryViewRecords = 1000
const time = (value: WireObject | undefined, id: string): number | null => {
  const raw = (value as { timestampValue?: unknown } | undefined)?.timestampValue
  return raw === undefined ? null : positionMilliseconds(timestamp(raw, id))
}
const count = (value: WireObject | undefined): number | null => {
  const raw = (value as { integerValue?: unknown } | undefined)?.integerValue
  const n = typeof raw === 'string' || typeof raw === 'number' ? Number(raw) : Number.NaN
  return Number.isSafeInteger(n) && n >= 0 ? n : null
}
export function storyViewRecords(views: readonly FirestoreDocument[], viewsParent: string, stats: FirestoreDocument | null): StoryViewRecordData {
  if (views.length > maxStoryViewRecords) throw new Error('Unsupported story audience size')
  const rows = views.map(doc => {
    const uid = identifier(childId(doc.name, viewsParent)), f = doc.fields
    const reaction = (f.reaction as { stringValue?: unknown } | undefined)?.stringValue
    if (reaction !== undefined && (typeof reaction !== 'string' || !reaction || reaction.length > 16)) throw new Error('Unsupported stored reaction')
    const viewedAt = time(f.viewedAt, uid), repostedAt = time(f.repostedAt, uid), forwardedAt = time(f.forwardedAt, uid)
    const times = [viewedAt, repostedAt, forwardedAt].filter((value): value is number => value !== null)
    return { uid, viewed: viewedAt !== null, reaction: typeof reaction === 'string' ? reaction : null, reposted: repostedAt !== null, forwarded: forwardedAt !== null, latestAt: times.length ? Math.max(...times) : null }
  }).sort((a, b) => (b.latestAt ?? -1) - (a.latestAt ?? -1) || (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0))
  // The server's counts when it has made them; until the first view is counted, what the list holds.
  const s = stats?.fields
  const counted = { viewers: s ? count(s.viewCount) : null, reactions: s ? count(s.reactionCount) : null, reposts: s ? count(s.repostCount) : null, forwards: s ? count(s.forwardCount) : null }
  return {
    rows,
    counts: {
      viewers: counted.viewers ?? rows.filter(row => row.viewed).length, reactions: counted.reactions ?? rows.filter(row => row.reaction).length,
      reposts: counted.reposts ?? rows.filter(row => row.reposted).length, forwards: counted.forwards ?? rows.filter(row => row.forwarded).length
    },
    missing: []
  }
}
