import { postRemovalTarget, type PostRemovalTarget } from '../../../shared/channel-post-removal'
import type { ChannelPostsSnapshot, ChannelPostText } from '../../../shared/channel-posts'
import type { ChannelPinReference, ChannelPostPinFlag } from '../../../shared/channel-post-pins'
import type { ChannelDiscussionReference } from '../../../shared/channel-discussion-navigation'
import { tr } from '../../../shared/i18n'
export interface PostRemovalReview { target: PostRemovalTarget; contentEligible: boolean; text: string; visibility: ChannelPostText['visibility']; mediaCount: number; commentCount: number | null; owned: boolean; reference: ChannelPinReference; flag: ChannelPostPinFlag; discussion: ChannelDiscussionReference }
export function preparePostRemovalReview(snapshot: ChannelPostsSnapshot, postId: string): PostRemovalReview {
  const post = snapshot.posts.find(value => value.id === postId)
  if (snapshot.status !== 'ready' || !post?.own || !snapshot.pins?.channelVersion) throw new Error(tr('현재 본인 게시물을 확인해 주세요.'))
  return { target: postRemovalTarget({ id: crypto.randomUUID(), requestId: snapshot.requestId, channelId: snapshot.channelId, channelVersion: snapshot.pins.channelVersion, postId, revision: post.revision }),
    contentEligible: post.removalEligible, text: post.text, visibility: post.visibility, mediaCount: post.mediaCount, commentCount: post.commentCount, owned: snapshot.pins.owned, reference: { ...snapshot.pins.reference }, flag: post.pinFlag,
    discussion: snapshot.authoring?.channelVersion === snapshot.pins.channelVersion ? { ...snapshot.authoring.discussion } : { status: 'unknown', chatId: null } }
}
export function postRemovalReviewCurrent(snapshot: ChannelPostsSnapshot | null, review: PostRemovalReview): boolean {
  const target = review.target
  if (snapshot?.status !== 'ready' || snapshot.channelId !== target.channelId || snapshot.requestId !== target.requestId || snapshot.pins?.channelVersion !== target.channelVersion) return false
  return snapshot.posts.some(post => post.id === target.postId && post.revision === target.revision && post.own)
}
