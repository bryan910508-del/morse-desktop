import { backgroundPhotoId } from './chat-background'
import { identifier, object } from './validation'
import { tr } from './i18n'
export interface GroupRemovalRequest { id: string; chatId: string; version: string; title: string; removeUid: string; displayName: string }
export type GroupRemovalState = 'prepared' | 'submitted' | 'confirmed' | 'rejected'
export interface PendingGroupRemoval extends GroupRemovalRequest { state: GroupRemovalState }
export interface GroupRemovalSnapshot { status: 'loading' | 'ready' | 'error'; busy: boolean; canSend: boolean; pending: PendingGroupRemoval | null; message: string }
export interface GroupRemovalAction { id: string; state: GroupRemovalState; action: 'send' | 'check' | 'dismiss' }
export function groupRemovalRequest(raw: unknown): GroupRemovalRequest {
  const value = object(raw)
  if (Object.keys(value).some(key => !['id', 'chatId', 'version', 'title', 'removeUid', 'displayName'].includes(key)) ||
    typeof value.version !== 'string' || !/^\d{1,12}:\d{1,9}$/.test(value.version) ||
    typeof value.title !== 'string' || !value.title || value.title.length > 512 ||
    typeof value.displayName !== 'string' || !value.displayName || value.displayName.length > 512) throw new Error(tr('최신 그룹에서 제거할 참여자를 다시 선택해 주세요.'))
  return { id: backgroundPhotoId(value.id), chatId: identifier(value.chatId), version: value.version, title: value.title,
    removeUid: identifier(value.removeUid), displayName: value.displayName }
}
export function groupRemovalAction(raw: unknown): GroupRemovalAction {
  const value = object(raw)
  if (Object.keys(value).some(key => !['id', 'state', 'action'].includes(key)) || !['prepared', 'submitted', 'confirmed', 'rejected'].includes(String(value.state)) || !['send', 'check', 'dismiss'].includes(String(value.action))) throw new Error(tr('참여자 제거 기록을 다시 확인해 주세요.'))
  return { id: backgroundPhotoId(value.id), state: value.state as GroupRemovalState, action: value.action as GroupRemovalAction['action'] }
}
