import type { ChannelPostLikes } from '../../shared/channel-post-like'
import { identifier, object } from '../../shared/validation'
import { numberField, type FirestoreDocument } from '../network/firestore-values'
import { tr } from '../../shared/i18n'
export function channelPostLikeState(doc: FirestoreDocument, uid: string): { info: ChannelPostLikes; members: string[] | null } {
  const rawCount = doc.fields.likeCount
  const stored = rawCount && (rawCount.integerValue !== undefined || rawCount.doubleValue !== undefined) ? numberField(doc.fields, 'likeCount') : NaN
  const storedCount = Number.isSafeInteger(stored) && stored >= 0 ? stored : null
  try {
    const raw = object(doc.fields.likedBy), array = object(raw.arrayValue), values = array.values ?? []
    if (!Array.isArray(values) || values.length > 10000) throw new Error('Invalid like membership bound')
    const members = values.map(value => identifier(object(value).stringValue))
    if (new Set(members).size !== members.length) throw new Error('Duplicate like identities')
    // B373 S2: the list is the likes; the server counts it into likeCount a moment later (and corrected the old
    // mismatches), so a stored count that differs no longer holds the like back.
    return { members, info: { status: 'ready', selected: members.includes(uid), count: members.length, storedCount, message: '' } }
  } catch {
    return { members: null, info: { status: 'unknown', selected: null, count: null, storedCount, message: tr('좋아요 목록을 해석할 수 없거나 10,000개 범위를 넘습니다. 본인 상태를 추정하지 않습니다.') } }
  }
}
