import type { ContactSummary } from '../../../shared/contacts'
import { dialogById, useDesktop } from '../app/store'
import { Avatar, PeerAvatar, type AvatarKind } from './avatar'
import type { GroupPhotoImage } from '../../../shared/group-photo'

// A person's photo on any screen. Main reads a contact's profile photo only when both people
// have each other as contacts; everyone else keeps initials. A photo the user picked for a
// contact on this device stays their own choice.
export function ContactAvatar({ contact, size = 42 }: { contact: ContactSummary; size?: number }) {
  return contact.personalPhotoURL ? <Avatar name={contact.displayName} url={contact.personalPhotoURL} size={size} />
    : <PeerAvatar id={contact.uid} name={contact.displayName} image={contact.avatar} size={size} surface="contacts" />
}
// On channel screens `image` is the person's own photo from the channel record, shown for everyone.
// `roomOnly` is a channel's discussion room: iOS draws its members from the room's own copy alone
// (GroupProfileView: 「멤버·핸들은 chats.participantInfo만 — 연락처·session currentUser로 덮어쓰면 실명
// 노출」), because the owner of that room is the channel. A picture taken from this account's contacts or
// from the account itself would put the person behind the channel on screen, so none is taken.
export function UserAvatar({ uid, name, size = 42, kind, image, roomOnly }: { uid: string | null | undefined; name: string; size?: number; kind?: AvatarKind; image?: GroupPhotoImage | null; roomOnly?: boolean }) {
  const contact = useDesktop(state => uid && !roomOnly ? state?.contacts?.items.find(item => item.uid === uid) ?? null : null)
  // The account itself is never in its contacts; its photo is the one the main menu shows.
  const own = useDesktop(state => uid && !roomOnly && state?.activeAccountUid === uid && state.selfProfile?.photo.status === 'ready' ? state.selfProfile.photo.url : null)
  if (kind) return <Avatar name={name} size={size} kind={kind} />
  if (contact?.personalPhotoURL) return <Avatar name={name} url={contact.personalPhotoURL} size={size} />
  if (image?.status === 'ready' && image.url) return <Avatar name={name} url={image.url} size={size} />
  if (own) return <Avatar name={name} url={own} size={size} />
  if (!contact) return <Avatar name={name} size={size} />
  return contact.personalPhotoURL ? <Avatar name={name} url={contact.personalPhotoURL} size={size} />
    : <PeerAvatar id={contact.uid} name={name} image={contact.avatar} size={size} surface="contacts" />
}
// A chat's photo by id: the group photo, or the other person's under the same contact rule.
export function DialogAvatar({ chatId, name, size = 42 }: { chatId: string; name: string; size?: number }) {
  const image = useDesktop(state => dialogById(state, chatId)?.avatar ?? null)
  return <PeerAvatar id={chatId} name={name} image={image} size={size} surface="dialogs" />
}
