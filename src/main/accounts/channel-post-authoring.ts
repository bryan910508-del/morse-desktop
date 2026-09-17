import type { ChannelPostAuthoring } from '../../shared/channel-post-authoring'
import { identifier } from '../../shared/validation'
import { channelDiscussionReference } from './channel-discussion-reference'
import { documentVersion, documents, mapField, stringField, type FirestoreDocument } from '../network/firestore-values'
export function channelPostAuthoring(uid: string, channelId: string, current: FirestoreDocument, policy: FirestoreDocument, admin: FirestoreDocument | undefined): ChannelPostAuthoring | null {
  const root = `${documents}/channels/${channelId}`, version = documentVersion(current)
  // Both independently observed roots must agree before presenting posting authority.
  if (current.name !== root || policy.name !== root || !version || documentVersion(policy) !== version) return null
  try {
    const owner = identifier(stringField(current.fields, 'ownerId', 160)) === uid
    const result: ChannelPostAuthoring = { channelId, channelVersion: version, role: owner ? 'owner' : admin ? 'administrator' : 'none', permission: 'unknown', permissionSource: 'unknown', adminVersion: null,
      discussion: channelDiscussionReference(current), publicChannel: typeof current.fields.isPublic?.booleanValue === 'boolean' ? current.fields.isPublic.booleanValue : null }
    if (owner) return { ...result, permission: 'allowed', permissionSource: 'owner' }
    if (!admin) return { ...result, permission: 'denied', permissionSource: 'no-admin' }
    if (admin.name !== `${root}/admins/${uid}` || !documentVersion(admin) || (admin.fields.userId !== undefined && stringField(admin.fields, 'userId', 160) !== uid)) return result
    result.adminVersion = documentVersion(admin)
    const flag = mapField(admin.fields, 'permissions').canPostMessages?.booleanValue
    if (flag === true) return { ...result, permission: 'allowed', permissionSource: 'explicit-true' }
    if (flag === false) return { ...result, permission: 'denied', permissionSource: 'explicit-false' }
    return result
  } catch { return null }
}
