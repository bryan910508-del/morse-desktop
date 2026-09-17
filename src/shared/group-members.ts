import { backgroundPhotoId } from './chat-background'
import { identifier, object } from './validation'
import { tr } from './i18n'
export interface GroupMembersRequest { id: string; chatId: string; version: string; title: string; addUids: string[] }
export type GroupMembersState = 'prepared' | 'submitted' | 'confirmed' | 'rejected'
export interface PendingGroupMembers extends GroupMembersRequest { state: GroupMembersState }
export interface GroupMembersSnapshot { status: 'loading' | 'ready' | 'error'; busy: boolean; pending: PendingGroupMembers | null; message: string }
export interface GroupMembersAction { id: string; state: GroupMembersState; action: 'send' | 'check' | 'dismiss' }
export function groupMembersRequest(raw: unknown): GroupMembersRequest {
  const value = object(raw)
  if (Object.keys(value).some(key => !['id', 'chatId', 'version', 'title', 'addUids'].includes(key)) ||
    typeof value.version !== 'string' || !/^\d{1,12}:\d{1,9}$/.test(value.version) || typeof value.title !== 'string' || !value.title || value.title.length > 512 ||
    !Array.isArray(value.addUids) || value.addUids.length < 1 || value.addUids.length > 99) throw new Error(tr('최신 그룹에서 추가할 연락처를 1~99명 선택해 주세요.'))
  const addUids = value.addUids.map(identifier)
  if (new Set(addUids).size !== addUids.length) throw new Error(tr('중복된 참여자를 확인해 주세요.'))
  return { id: backgroundPhotoId(value.id), chatId: identifier(value.chatId), version: value.version, title: value.title, addUids: addUids.sort() }
}
export function groupMembersAction(raw: unknown): GroupMembersAction {
  const value = object(raw)
  if (Object.keys(value).some(key => !['id', 'state', 'action'].includes(key)) || !['prepared', 'submitted', 'confirmed', 'rejected'].includes(String(value.state)) || !['send', 'check', 'dismiss'].includes(String(value.action))) throw new Error(tr('참여자 추가 기록을 다시 확인해 주세요.'))
  return { id: backgroundPhotoId(value.id), state: value.state as GroupMembersState, action: value.action as GroupMembersAction['action'] }
}
