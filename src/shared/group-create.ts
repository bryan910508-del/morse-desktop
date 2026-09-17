import { backgroundPhotoId } from './chat-background'
import { identifier, object } from './validation'
import { tr } from './i18n'
export interface GroupCreateRequest { chatId: string; name: string; participantUids: string[] }
export type GroupCreateState = 'prepared' | 'submitted' | 'confirmed' | 'rejected'
export interface PendingGroup extends GroupCreateRequest { state: GroupCreateState }
export interface GroupCreateSnapshot { status: 'loading' | 'ready' | 'error'; busy: boolean; pending: PendingGroup | null; message: string }
export interface GroupCreateAction { chatId: string; state: GroupCreateState; action: 'send' | 'check' | 'dismiss' }
export function groupCreateRequest(raw: unknown): GroupCreateRequest {
  const value = object(raw)
  if (Object.keys(value).some(key => !['chatId', 'name', 'participantUids'].includes(key)) || typeof value.name !== 'string' ||
    !value.name.trim() || value.name.length > 50 || !Array.isArray(value.participantUids) || value.participantUids.length < 1 || value.participantUids.length > 99) throw new Error(tr('그룹 이름은 1~50자, 연락처는 1~99명을 선택해 주세요.'))
  const participants = value.participantUids.map(identifier)
  if (new Set(participants).size !== participants.length) throw new Error(tr('중복된 참여자를 확인해 주세요.'))
  return { chatId: backgroundPhotoId(value.chatId), name: value.name.trim(), participantUids: participants.sort() }
}
export function groupCreateAction(raw: unknown): GroupCreateAction {
  const value = object(raw)
  if (Object.keys(value).some(key => !['chatId', 'state', 'action'].includes(key)) || !['prepared', 'submitted', 'confirmed', 'rejected'].includes(String(value.state)) || !['send', 'check', 'dismiss'].includes(String(value.action))) throw new Error(tr('그룹 생성 기록을 다시 확인해 주세요.'))
  return { chatId: backgroundPhotoId(value.chatId), state: value.state as GroupCreateState, action: value.action as GroupCreateAction['action'] }
}
