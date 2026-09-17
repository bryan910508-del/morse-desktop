import type { FirestoreDocument } from '../network/firestore-values'
import { mapField, stringField } from '../network/firestore-values'
import { tr } from '../../shared/i18n'
export interface DiscussionComposePolicy { allowed: boolean; message: string }
export function discussionComposePolicy(uid: string, channel: FirestoreDocument, subscriber: FirestoreDocument | undefined, admin: FirestoreDocument | undefined): DiscussionComposePolicy {
  const unavailable = { allowed: false, message: tr('토론방 작성 조건을 확인할 수 없습니다. 기존 입력과 전송 대기는 보관합니다.') }
  try {
    // Missing chatMode follows the documented UI broadcast default, not an unrestricted fallback.
    const mode = channel.fields.chatMode === undefined ? 'broadcast' : stringField(channel.fields, 'chatMode', 32)
    if (mode !== 'broadcast' && mode !== 'discussion') return unavailable
    const owner = stringField(channel.fields, 'ownerId', 160) === uid
    if (!owner && !admin && subscriber?.fields.uid !== undefined && stringField(subscriber.fields, 'uid', 160) !== uid) return unavailable
    if (!owner && !admin && !subscriber) return { allowed: false, message: tr('현재 채널 구독 또는 관리자 상태를 확인해야 작성할 수 있습니다. 기존 입력과 전송 대기는 보관합니다.') }
    // The send callable requires explicit true; display defaults never grant posting.
    const canPost = admin && mapField(admin.fields, 'permissions').canPostMessages?.booleanValue === true
    if (mode === 'broadcast' && !owner && !canPost) return { allowed: false, message: tr('공지형 토론방은 소유자 또는 작성 권한이 있는 관리자만 메시지를 보낼 수 있습니다. 기존 입력과 전송 대기는 보관합니다.') }
    return { allowed: true, message: '' }
  } catch { return unavailable }
}
