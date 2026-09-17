import type { ChannelCommentItem } from '../../../shared/channel-comments'
export type CommentDisplayMode = 'threads' | 'time' | 'unresolved'
export interface CommentDisplayRow { item: ChannelCommentItem; depth: 0 | 1; replyCount: number; rootAuthor: string | null; unresolved: boolean }
export function arrangeComments(items: ChannelCommentItem[], mode: CommentDisplayMode): { rows: CommentDisplayRow[]; unresolvedCount: number } {
  const roots = new Map(items.filter(item => item.parent === 'none').map(item => [item.id, item]))
  const replies = new Map<string, ChannelCommentItem[]>(), unresolved = new Set<string>()
  for (const item of items) {
    if (item.parent === 'none') continue
    if (item.parent === 'present' && item.parentId && roots.has(item.parentId) && item.id !== item.parentId) {
      const children = replies.get(item.parentId) ?? []; children.push(item); replies.set(item.parentId, children)
    } else unresolved.add(item.id)
  }
  const row = (item: ChannelCommentItem, depth: 0 | 1 = 0): CommentDisplayRow => ({ item, depth, replyCount: replies.get(item.id)?.length ?? 0,
    rootAuthor: item.parent === 'present' && item.parentId ? roots.get(item.parentId)?.authorName ?? null : null, unresolved: unresolved.has(item.id) })
  const rows = mode === 'time' ? items.map(item => row(item)) : mode === 'unresolved' ? items.filter(item => unresolved.has(item.id)).map(item => row(item)) :
    [...roots.values()].flatMap(root => [row(root), ...(replies.get(root.id) ?? []).map(item => row(item, 1))]).concat(items.filter(item => unresolved.has(item.id)).map(item => row(item)))
  return { rows, unresolvedCount: unresolved.size }
}
