import type { ChannelPinReference, ChannelPostPinFlag, ChannelPostPinInfo } from '../../shared/channel-post-pins'
import type { ChannelPostText } from '../../shared/channel-posts'
import { documentVersion, stringField, type FirestoreDocument } from '../network/firestore-values'
import { identifier } from '../../shared/validation'
import { tr } from '../../shared/i18n'
export function channelPostPinFlag(post: FirestoreDocument): ChannelPostPinFlag {
  const field = post.fields.isPinned
  return field === undefined ? 'missing' : field.booleanValue === true ? 'pinned' : field.booleanValue === false ? 'unpinned' : 'unknown'
}
export function channelPinReference(channel: FirestoreDocument): ChannelPinReference {
  const field = channel.fields.pinnedPostId
  if (field === undefined) return { status: 'none', postId: null, source: 'missing' }
  if (field.nullValue !== undefined) return { status: 'none', postId: null, source: 'null' }
  if (field.stringValue === '') return { status: 'none', postId: null, source: 'empty' }
  try { return { status: 'known', postId: identifier(field.stringValue), source: 'value' } }
  catch { return { status: 'unknown', postId: null, source: 'invalid' } }
}
export function channelPostPinInfo(channel: FirestoreDocument, posts: ChannelPostText[], uid: string): ChannelPostPinInfo {
  const reference = channelPinReference(channel), flagged = posts.filter(post => post.pinFlag === 'pinned')
  const target = reference.postId ? posts.find(post => post.id === reference.postId) : null
  const info: ChannelPostPinInfo = { owned: stringField(channel.fields, 'ownerId', 160) === uid, channelVersion: documentVersion(channel) || null, reference, targetFlag: reference.status === 'known' ? target?.pinFlag ?? 'unobserved' : null,
    flaggedCount: flagged.length, missingCount: posts.filter(post => post.pinFlag === 'missing').length, unknownCount: posts.filter(post => post.pinFlag === 'unknown').length, comparison: 'unknown', message: '' }
  if (reference.status === 'unknown') info.message = tr('채널의 고정 대상 값을 해석할 수 없습니다. 고정이 없다고 판단하지 않습니다.')
  else if (flagged.some(post => post.id !== reference.postId)) { info.comparison = 'inconsistent'; info.message = tr('현재 조회 목록에 채널의 고정 대상과 다른 게시물의 고정 표시가 있습니다. 자동 해제하거나 보정하지 않습니다.') }
  else if (reference.status === 'known' && !target) { info.comparison = 'unresolved'; info.message = tr('채널이 가리키는 게시물이 현재 읽을 수 있는 목록에 없습니다. 삭제 여부를 단정하거나 별도로 조회하지 않습니다.') }
  else if (target?.pinFlag === 'unpinned') { info.comparison = 'inconsistent'; info.message = tr('채널이 가리키는 게시물에 고정 해제 값이 관찰됩니다. 두 문서의 수신 시점이 다를 수 있어 자동 보정하지 않습니다.') }
  else if (info.missingCount || info.unknownCount) info.message = tr('현재 목록에 고정 값이 없거나 해석되지 않는 게시물이 있습니다. 전체 고정 표시의 일치를 확정하지 않습니다.')
  else { info.comparison = 'compatible'; info.message = reference.status === 'known' ? tr('현재 조회 범위에서 채널의 고정 대상과 게시물 고정 표시가 일치합니다.') : tr('현재 조회 범위에서 채널의 고정 대상과 고정 표시가 없습니다.') }
  return info
}
