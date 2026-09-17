import { channelPostPinEdit, type ChannelPostPinEdit } from '../../../shared/channel-post-pin-edit'
import type { ChannelPostsSnapshot, ChannelPostText } from '../../../shared/channel-posts'
import { tr } from '../../../shared/i18n'
export function postPinBase(snapshot: ChannelPostsSnapshot | null): { channelVersion: string; previous: ChannelPostText | null } | null {
  const info = snapshot?.pins
  if (!snapshot || snapshot.status !== 'ready' || !info?.owned || info.comparison !== 'compatible' || !info.channelVersion || info.reference.status === 'unknown') return null
  const previous = info.reference.postId ? snapshot.posts.find(post => post.id === info.reference.postId) ?? null : null
  if (info.reference.postId && (!previous || !previous.own || previous.editableText === null || previous.pinFlag !== 'pinned')) return null
  return { channelVersion: info.channelVersion, previous }
}
export function preparePostPin(snapshot: ChannelPostsSnapshot, nextId: string | null): ChannelPostPinEdit {
  const base = postPinBase(snapshot), next = nextId ? snapshot.posts.find(post => post.id === nextId) ?? null : null
  if (!base || (nextId && (!next || !next.own || next.pinFlag !== 'unpinned' || next.editableText === null))) throw new Error(tr('현재 소유자·게시물 작성자·고정 상태를 확인해 주세요.'))
  return channelPostPinEdit({ id: crypto.randomUUID(), requestId: snapshot.requestId, channelId: snapshot.channelId, channelVersion: base.channelVersion,
    previous: base.previous ? { postId: base.previous.id, revision: base.previous.revision } : null, next: next ? { postId: next.id, revision: next.revision } : null })
}
export function postPinRequestCurrent(snapshot: ChannelPostsSnapshot | null, request: ChannelPostPinEdit): boolean {
  const base = postPinBase(snapshot)
  if (!snapshot || !base || snapshot.requestId !== request.requestId || snapshot.channelId !== request.channelId || base.channelVersion !== request.channelVersion || base.previous?.id !== request.previous?.postId || base.previous?.revision !== request.previous?.revision) return false
  if (!request.next) return true
  const next = snapshot.posts.find(post => post.id === request.next!.postId)
  return Boolean(next?.own && next.revision === request.next.revision && next.pinFlag === 'unpinned' && next.editableText !== null)
}
