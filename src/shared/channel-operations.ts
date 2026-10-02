import { identifier, object } from './validation'
import { tr } from './i18n'

// A change to a channel post or comment this account asked for, kept on the device until the server shows it (user
// decision 2026-09-29, Android Q88). Each says what the result should be — a like on or off, the post's new words, the
// post or comment gone — not which version it was made against, so it can be sent again as it is: before every send
// the server's copy is read, and one that already shows it is done. Telegram sends a request again until it is
// answered, and a newer choice for the same thing replaces the one still waiting.
export type ChannelOperationRequest =
  | { kind: 'post-like'; id: string; channelId: string; postId: string; liked: boolean }
  // original: the words the edit was made from. Words someone else wrote since are not overwritten.
  | { kind: 'post-text'; id: string; channelId: string; postId: string; original: string; text: string }
  | { kind: 'post-delete'; id: string; channelId: string; postId: string }
  | { kind: 'comment-delete'; id: string; channelId: string; postId: string; commentId: string }
export type ChannelOperationKind = ChannelOperationRequest['kind']

// What the screens draw from: 'pending' is on its way (the heart, the words and the list already show it), 'failed'
// is one the server refused, shown until it is dealt with; for words, the typed text is kept for another try.
// 'settled' is one the server has confirmed, still drawn for a few seconds: the screens' copies of the post come from
// the server's stream and show it a moment later, and until then they hold the post as it was before.
export interface ChannelOperationItem {
  id: string; kind: ChannelOperationKind; channelId: string; postId: string; commentId: string | null
  liked: boolean | null; text: string | null; state: 'pending' | 'failed' | 'settled'; reason: string; createdAt: number
}

// How the screens draw a post from the server's copy and the changes above (Telegram draws an action the moment it is
// taken, and a confirmed one stays as the server answered: tdesktop Reactions::send applies the answer's updates as it
// arrives and MessageReactions::change ignores the server's reactions while a send is out). A change on its way comes
// before a confirmed one, and the newest of each.
function latest(items: ChannelOperationItem[], match: (item: ChannelOperationItem) => boolean, states: ChannelOperationItem['state'][]): ChannelOperationItem | null {
  for (const state of states) {
    const found = [...items].reverse().find(item => item.state === state && match(item))
    if (found) return found
  }
  return null
}
// The heart: the server's, unless a like is on its way or just confirmed and the server's copy does not show it yet,
// then that choice, with the count moved by it.
export function likeView(server: { selected: boolean | null; count: number | null }, items: ChannelOperationItem[], postId: string): { selected: boolean | null; count: number | null } {
  const mine = latest(items, item => item.kind === 'post-like' && item.postId === postId, ['pending', 'settled'])
  if (!mine || mine.liked === null || server.selected === null || server.count === null || mine.liked === server.selected) return server
  return { selected: mine.liked, count: Math.max(0, server.count + (mine.liked ? 1 : -1)) }
}
// New words for a post: on their way or refused (the post shows its own, with the typed ones kept for another try),
// else just confirmed (shown as the post's words until its copy has them).
export function editView(items: ChannelOperationItem[], postId: string): ChannelOperationItem | null {
  const own = (item: ChannelOperationItem): boolean => item.kind === 'post-text' && item.postId === postId
  return [...items].reverse().find(item => item.state !== 'settled' && own(item)) ?? latest(items, own, ['settled'])
}
export function removedPosts(items: ChannelOperationItem[]): ReadonlySet<string> {
  return new Set(items.filter(item => item.kind === 'post-delete' && item.state !== 'failed').map(item => item.postId))
}
export function removedComments(items: ChannelOperationItem[], postId: string): ReadonlySet<string> {
  return new Set(items.filter(item => item.kind === 'comment-delete' && item.postId === postId && item.state !== 'failed' && item.commentId).map(item => item.commentId!))
}

const uuid = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-4[0-9A-Fa-f]{3}-[89ABab][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}$/
export function channelOperationId(raw: unknown): string {
  if (typeof raw !== 'string' || !uuid.test(raw)) throw new Error(tr('게시물을 다시 확인해 주세요.'))
  return raw.toLowerCase()
}
export function channelOperationRequest(raw: unknown): ChannelOperationRequest {
  const value = object(raw)
  const fail = (): never => { throw new Error(tr('게시물을 다시 확인해 주세요.')) }
  if (typeof value.id !== 'string' || !uuid.test(value.id)) fail()
  const base = { id: String(value.id).toLowerCase(), channelId: identifier(value.channelId), postId: identifier(value.postId) }
  const keys = (allowed: string[]): void => { if (Object.keys(value).some(key => !['kind', 'id', 'channelId', 'postId', ...allowed].includes(key))) fail() }
  switch (value.kind) {
    case 'post-like':
      keys(['liked']); if (typeof value.liked !== 'boolean') fail()
      return { kind: 'post-like', ...base, liked: value.liked as boolean }
    case 'post-text':
      keys(['original', 'text'])
      if (typeof value.original !== 'string' || value.original.length > 5000 || typeof value.text !== 'string' || !value.text.trim() || value.text.length > 5000 || value.text === value.original) {
        throw new Error(tr('최신 내 게시물에서 1~5,000자 본문 변경을 다시 확인해 주세요.'))
      }
      return { kind: 'post-text', ...base, original: value.original as string, text: value.text as string }
    case 'post-delete':
      keys([]); return { kind: 'post-delete', ...base }
    case 'comment-delete':
      keys(['commentId']); return { kind: 'comment-delete', ...base, commentId: identifier(value.commentId) }
    default: return fail()
  }
}
// What a newer choice replaces: a like or new words for the same post. Deletes simply wait their turn.
export function channelOperationTarget(request: ChannelOperationRequest): string {
  return request.kind === 'comment-delete' ? `${request.channelId}/${request.postId}/${request.commentId}` : `${request.channelId}/${request.postId}`
}
