import { groupPhotoFields } from './group-photo'
import type { ParticipantsSnapshot } from '../../shared/participants'
import { boolField, displayField, documentVersion, mapField, stringField, type FirestoreDocument, type ReadDialog } from '../network/firestore-values'
import type { ContactCreateFields } from '../network/participant-contact-write'
import { tr } from '../../shared/i18n'

// Only the currently authorized chat document supplies identity labels.
// User docs, contact aliases and profile-photo URLs never enter this snapshot.
export function participantSnapshot(requestId: string, doc: FirestoreDocument, dialog: ReadDialog,
  hasContact: (uid: string) => boolean, contactsReady = false): ParticipantsSnapshot {
  const { summary, accountUid } = dialog, fields = doc.fields
  const discussion = boolField(fields, 'isChannelDiscussion') || Boolean(stringField(fields, 'channelId', 160)) || summary.id.startsWith('channel_discuss_')
  const info = mapField(fields, 'participantInfo'), owner = stringField(fields, 'createdBy', 160)
  const members = [...new Set(summary.participantUids)].map(uid => {
    // A name another app wrote at length is cut to what is shown, not refused (F-ST-002, §E-1): one participant
    // with a long name used to fail the whole member list of the group.
    const data = mapField(info, uid), name = displayField(data, 'displayName', 512).trim()
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

// «연락처에 추가» for somebody met in a group: their name, Morse ID and picture as the room keeps them. The name is
// cut to what is shown rather than refused (F-ST-002, §E-1) — adding a person whose name another app wrote at length
// used to fail; the Morse ID and the picture's address are still checked strictly.
export function roomContactFields(doc: FirestoreDocument, uid: string): ContactCreateFields {
  const data = mapField(mapField(doc.fields, 'participantInfo'), uid), displayName = displayField(data, 'displayName', 512).trim()
  if (!displayName) throw new Error(tr('추가할 참여자 이름을 확인할 수 없습니다.'))
  return { uid, userId: stringField(data, 'userId', 160), displayName, photoURL: stringField(data, 'photoURL', 10000) }
}
