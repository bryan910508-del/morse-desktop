import { postVisibilityRequest, type PostVisibilityRequest } from '../../../shared/channel-post-visibility'
import type { ChannelPostsSnapshot, ChannelPostText } from '../../../shared/channel-posts'
import { tr } from '../../../shared/i18n'
export function visibilityEditable(snapshot: ChannelPostsSnapshot | null, postId: string): ChannelPostText | null {
  const info = snapshot?.authoring
  if (snapshot?.status !== 'ready' || !snapshot.pins?.owned || !snapshot.pins.channelVersion || !info || info.channelVersion !== snapshot.pins.channelVersion || info.publicChannel === null) return null
  return snapshot.posts.find(post => post.id === postId && post.own && post.editableText !== null) ?? null
}
export function preparePostVisibility(snapshot: ChannelPostsSnapshot, postId: string): PostVisibilityRequest {
  const post = visibilityEditable(snapshot, postId)
  if (!post) throw new Error(tr('현재 본인 채널과 게시물 공개 범위를 확인해 주세요.'))
  return postVisibilityRequest({ id: crypto.randomUUID(), requestId: snapshot.requestId, channelId: snapshot.channelId, channelVersion: snapshot.pins!.channelVersion, postId, revision: post.revision, previous: post.visibility, next: post.visibility === 'public' ? 'subscribers' : 'public', publicChannel: snapshot.authoring!.publicChannel })
}
export function postVisibilityCurrent(snapshot: ChannelPostsSnapshot | null, request: PostVisibilityRequest): boolean {
  const post = visibilityEditable(snapshot, request.postId)
  return Boolean(post && snapshot?.requestId === request.requestId && snapshot.channelId === request.channelId && snapshot.pins?.channelVersion === request.channelVersion && snapshot.authoring?.publicChannel === request.publicChannel && post.revision === request.revision && post.visibility === request.previous)
}
