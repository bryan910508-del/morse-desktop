import { groupPhotoFields } from './group-photo'
import type { ParticipantsSnapshot } from '../../shared/participants'
import { boolField, documentVersion, mapField, stringField, type FirestoreDocument, type ReadDialog } from '../network/firestore-values'
import { tr } from '../../shared/i18n'

// Only the currently authorized chat document supplies identity labels.
// User docs, contact aliases and profile-photo URLs never enter this snapshot.
export function participantSnapshot(requestId: string, doc: FirestoreDocument, dialog: ReadDialog,
  hasContact: (uid: string) => boolean, contactsReady = false): ParticipantsSnapshot {
  const { summary, accountUid } = dialog, fields = doc.fields
  const discussion = boolField(fields, 'isChannelDiscussion') || Boolean(stringField(fields, 'channelId', 160)) || summary.id.startsWith('channel_discuss_')
  const info = mapField(fields, 'participantInfo'), owner = stringField(fields, 'createdBy', 160)
  const members = [...new Set(summary.participantUids)].map(uid => {
    const data = mapField(info, uid), name = stringField(data, 'displayName', 512).trim()
    const present = Boolean(info[uid]?.mapValue)
    const withdrawn = boolField(data, 'accountDeleted') || (present && !name && !stringField(data, 'photoURL', 10000))
    // The room's owner is the channel here, as iOS names them (MorseGroupChatSenderDisplay: the owner of a
    // channel discussion room is shown by the room's name, never by their own), and the server writes the
    // channel's name into this room's participantInfo. A room whose copy predates that shows it anyway.
    const shown = discussion && uid === owner && summary.title ? summary.title : name || tr('참여자')
    return { uid, displayName: withdrawn ? tr('탈퇴한 계정') : shown, withdrawn,
      self: !discussion && uid === accountUid, owner: !discussion && summary.kind === 'group' && uid === owner,
      canOpenContact: !discussion && uid !== accountUid && !withdrawn && Boolean(name) && hasContact(uid),
      canAddContact: contactsReady && !discussion && uid !== accountUid && !withdrawn && Boolean(name) && !hasContact(uid) }
  })
  // Stable sort retains the authoritative participant order after the owner.
  members.sort((a, b) => Number(b.owner) - Number(a.owner))
  const rawName = fields.name?.stringValue
  const groupName = !discussion && summary.kind === 'group' && typeof rawName === 'string' && rawName.length <= 10000 ? rawName : null
  const rawAnnouncement = fields.announcement === undefined ? '' : fields.announcement.stringValue
  const groupAnnouncement = !discussion && summary.kind === 'group' && typeof rawAnnouncement === 'string' && rawAnnouncement.length <= 30000 ? rawAnnouncement : null
  const canEditGroupAnnouncement = groupAnnouncement !== null && members.some(member => member.self && member.owner && !member.withdrawn)
  const hasPhoto = groupPhotoFields(doc).hasPhoto
  const groupPhoto = !discussion && summary.kind === 'group' ? { status: 'idle' as const, url: null, message: '', hasPhoto, canClear: hasPhoto && members.some(member => member.self && member.owner && !member.withdrawn) } : null
  return { groupPhoto, requestId, chatId: summary.id, version: documentVersion(doc), status: 'ready', discussion, groupName, groupAnnouncement, canEditGroupAnnouncement, members, message: '' }
}
