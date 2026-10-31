import { channelPostExtraPin, type ChannelPostExtraPinRequest } from '../../../shared/channel-post-extra-pin'
import { channelPostPinResolution, type ChannelPostPinResolution } from '../../../shared/channel-post-pin-resolution'
import type { ChannelPostsSnapshot, ChannelPostText } from '../../../shared/channel-posts'
import { tr } from '../../../shared/i18n'

// A post carries a pin flag while the channel points at another post.
export function canClearExtraPin(snapshot: ChannelPostsSnapshot | null, postId: string): boolean {
  const info = snapshot?.pins, post = snapshot?.posts.find(post => post.id === postId)
  return Boolean(snapshot?.status === 'ready' && info?.owned && info.channelVersion && info.reference.status !== 'unknown' && info.reference.postId !== postId && post && post.pinFlag === 'pinned' && post.editableText !== null)
}
export function prepareExtraPin(snapshot: ChannelPostsSnapshot, postId: string): ChannelPostExtraPinRequest {
  if (!canClearExtraPin(snapshot, postId)) throw new Error(tr('현재 별도 고정 표시와 권한을 확인해 주세요.'))
  const info = snapshot.pins!, post = snapshot.posts.find(post => post.id === postId)!
  return channelPostExtraPin({ id: crypto.randomUUID(), requestId: snapshot.requestId, channelId: snapshot.channelId, channelVersion: info.channelVersion, referenceId: info.reference.postId, referenceSource: info.reference.source, postId, revision: post.revision })
}

// The channel names a post whose pin flag is off.
export function referencedUnpinnedPost(snapshot: ChannelPostsSnapshot | null): ChannelPostText | null {
  const info = snapshot?.pins
  if (snapshot?.status !== 'ready' || !info?.owned || !info.channelVersion || info.reference.status !== 'known') return null
  return snapshot.posts.find(post => post.id === info.reference.postId && post.pinFlag === 'unpinned' && post.editableText !== null) ?? null
}
export function preparePinResolution(snapshot: ChannelPostsSnapshot, action: ChannelPostPinResolution['action']): ChannelPostPinResolution {
  const post = referencedUnpinnedPost(snapshot)
  if (!post) throw new Error(tr('고정 정보를 다시 확인해 주세요.'))
  return channelPostPinResolution({ id: crypto.randomUUID(), requestId: snapshot.requestId, channelId: snapshot.channelId, channelVersion: snapshot.pins!.channelVersion, postId: post.id, revision: post.revision, action })
}
