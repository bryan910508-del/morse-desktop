import type { GroupPhotoSnapshot } from './group-photo'
import { identifier, object } from './validation'
import { tr } from './i18n'

export interface ParticipantSummary {
  uid: string
  displayName: string
  self: boolean
  owner: boolean
  withdrawn: boolean
  canOpenContact: boolean
  canAddContact: boolean
}
export interface ParticipantsSnapshot {
  requestId: string
  chatId: string
  version: string
  status: 'loading' | 'ready' | 'unavailable' | 'unsupported' | 'error'
  discussion: boolean
  groupName: string | null
  groupPhoto: GroupPhotoSnapshot | null
  groupAnnouncement: string | null
  canEditGroupAnnouncement: boolean
  members: ParticipantSummary[]
  message: string
}
export interface ParticipantContactRequest { requestId: string; chatId: string; uid: string; version: string }
export interface ParticipantAddRequest extends ParticipantContactRequest { id: string }
export interface ParticipantAddResult { outcome: 'added' | 'exists' | 'rejected' | 'uncertain'; message: string }
// Add a 1:1 peer or group member of a chat to my contacts.
export interface ChatContactRequest { id: string; chatId: string; uid: string }
export function chatContactRequest(raw: unknown): ChatContactRequest {
  const value = object(raw)
  return { id: identifier(value.id), chatId: identifier(value.chatId), uid: identifier(value.uid) }
}
export function participantAddRequest(raw: unknown): ParticipantAddRequest {
  return { ...participantContactRequest(raw), id: identifier(object(raw).id) }
}
export function participantContactRequest(raw: unknown): ParticipantContactRequest {
  const value = object(raw)
  if (typeof value.version !== 'string' || !/^\d{1,12}:\d{1,9}$/.test(value.version)) throw new Error(tr('최신 참여자 정보를 다시 선택해 주세요.'))
  return { requestId: identifier(value.requestId), chatId: identifier(value.chatId), uid: identifier(value.uid), version: value.version }
}
