import { backgroundPhotoId } from './chat-background'
import { identifier, object } from './validation'
import { tr } from './i18n'
export interface DiscussionLeaveScope { channelId: string; version: string; title: string }
export interface GroupLeaveRequest { discussion?: DiscussionLeaveScope; id: string; chatId: string; version: string; title: string; owner: boolean; participantCount: number }
export type GroupLeaveState = 'prepared' | 'submitted' | 'confirmed' | 'rejected'
export interface PendingGroupLeave extends GroupLeaveRequest { state: GroupLeaveState }
export interface GroupLeaveSnapshot { status: 'loading' | 'ready' | 'error'; busy: boolean; canSend: boolean; pending: PendingGroupLeave | null; message: string }
export interface GroupLeaveAction { id: string; state: GroupLeaveState; action: 'send' | 'check' | 'dismiss' }
export function groupLeaveRequest(raw: unknown): GroupLeaveRequest {
  const value = object(raw)
  let discussion: DiscussionLeaveScope | undefined
  if (value.discussion !== undefined) {
    const scope = object(value.discussion)
    if (Object.keys(scope).some(key => !['channelId', 'version', 'title'].includes(key)) || typeof scope.version !== 'string' || !/^\d{1,12}:\d{1,9}$/.test(scope.version) || typeof scope.title !== 'string' || !scope.title || scope.title.length > 512) throw new Error(tr('최신 채널에서 토론방 나가기를 다시 선택해 주세요.'))
    discussion = { channelId: identifier(scope.channelId), version: scope.version, title: scope.title }
  }
  if (Object.keys(value).some(key => !['id', 'chatId', 'version', 'title', 'owner', 'participantCount', 'discussion'].includes(key)) ||
    typeof value.version !== 'string' || !/^\d{1,12}:\d{1,9}$/.test(value.version) ||
    typeof value.title !== 'string' || !value.title || value.title.length > 512 || typeof value.owner !== 'boolean' ||
    typeof value.participantCount !== 'number' || !Number.isInteger(value.participantCount) || value.participantCount < 1 || value.participantCount > (discussion ? 101 : 100)) throw new Error(tr('최신 그룹에서 나가기를 다시 선택해 주세요.'))
  return { id: backgroundPhotoId(value.id), chatId: identifier(value.chatId), version: value.version, title: value.title,
    owner: value.owner, participantCount: value.participantCount, ...(discussion ? { discussion } : {}) }
}
export function groupLeaveAction(raw: unknown): GroupLeaveAction {
  const value = object(raw)
  if (Object.keys(value).some(key => !['id', 'state', 'action'].includes(key)) || !['prepared', 'submitted', 'confirmed', 'rejected'].includes(String(value.state)) || !['send', 'check', 'dismiss'].includes(String(value.action))) throw new Error(tr('그룹 나가기 기록을 다시 확인해 주세요.'))
  return { id: backgroundPhotoId(value.id), state: value.state as GroupLeaveState, action: value.action as GroupLeaveAction['action'] }
}
