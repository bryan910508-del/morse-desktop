import { documentVersion, documents, mapField, stringField, type FirestoreDocument } from '../network/firestore-values'

// Who may delete a channel's posts and comments (A1 contract §3-5, user decision 2026-09-30, Telegram's rule —
// telegram-refs R-1/R-2: the owner or an admin with delete_messages deletes anything, an author their own):
//   'moderator' — the channel's owner, or an admin whose permissions.canDeleteMessages is stored true (a missing flag is
//                  false, as channel-admin-values.ts reads it and the rules' channelAdminHasPerm require);
//   'author'    — anyone for what they wrote themselves (Morse keeps this for an author no longer an admin);
//   'none'      — no one else.
// `admin` is channels/{id}/admins/{uid} as read from the server, or undefined when there is none.
export type ChannelDeleteRole = 'owner' | 'moderator' | 'author' | 'none'
export function channelDeleteRole(uid: string, channel: FirestoreDocument, admin: FirestoreDocument | undefined, authorId: string): ChannelDeleteRole {
  if (stringField(channel.fields, 'ownerId', 160) === uid) return 'owner'
  if (admin && admin.name === `${channel.name}/admins/${uid}` && documentVersion(admin) &&
      (admin.fields.userId === undefined || stringField(admin.fields, 'userId', 160) === uid) &&
      mapField(admin.fields, 'permissions').canDeleteMessages?.booleanValue === true) return 'moderator'
  return authorId === uid ? 'author' : 'none'
}
export const adminPath = (channelId: string, uid: string): string => `${documents}/channels/${channelId}/admins/${uid}`
