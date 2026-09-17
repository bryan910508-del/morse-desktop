import { channelDiscussionNavigation } from './channel-discussion-navigation'
import { backgroundPhotoId } from './chat-background'
import { object } from './validation'
import { tr } from './i18n'
export interface DiscussionJoinRequest { id: string; channelId: string; chatId: string; version: string; title: string }
export type DiscussionJoinState = 'prepared' | 'submitted' | 'confirmed' | 'rejected'
export interface PendingDiscussionJoin extends DiscussionJoinRequest { state: DiscussionJoinState }
export interface DiscussionJoinSnapshot { status: 'loading' | 'ready' | 'error'; busy: boolean; canSend: boolean; pending: PendingDiscussionJoin | null; message: string }
export interface DiscussionJoinAction { id: string; state: DiscussionJoinState; action: 'send' | 'check' | 'dismiss' }
export function discussionJoinRequest(raw: unknown): DiscussionJoinRequest {
  const value = object(raw)
  if (Object.keys(value).some(key => !['id', 'channelId', 'chatId', 'version', 'title'].includes(key)) || typeof value.title !== 'string' || !value.title.trim() || value.title.length > 512) throw new Error(tr('최신 채널에서 토론방 참여를 다시 선택해 주세요.'))
  return { id: backgroundPhotoId(value.id), ...channelDiscussionNavigation({ channelId: value.channelId, chatId: value.chatId, version: value.version }), title: value.title }
}
export function discussionJoinAction(raw: unknown): DiscussionJoinAction {
  const value = object(raw)
  if (Object.keys(value).some(key => !['id', 'state', 'action'].includes(key)) || !['prepared', 'submitted', 'confirmed', 'rejected'].includes(String(value.state)) || !['send', 'check', 'dismiss'].includes(String(value.action))) throw new Error(tr('최신 토론방 참여 기록을 확인해 주세요.'))
  return { id: backgroundPhotoId(value.id), state: value.state as DiscussionJoinState, action: value.action as DiscussionJoinAction['action'] }
}
