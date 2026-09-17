import { backgroundPhotoId } from './chat-background'
import { identifier, object } from './validation'
import { tr } from './i18n'
export interface ChannelJoinDecisionTarget { channelId: string; version: string; title: string; userId: string; requestVersion: string; approved: boolean }
export interface ChannelJoinDecisionRequest extends ChannelJoinDecisionTarget { id: string }
export type ChannelJoinDecisionState = 'prepared' | 'submitted' | 'confirmed' | 'rejected'
export interface PendingChannelJoinDecision extends ChannelJoinDecisionRequest { state: ChannelJoinDecisionState }
export interface ChannelJoinDecisionSnapshot { status: 'loading' | 'ready' | 'error'; busy: boolean; canSend: boolean; pending: PendingChannelJoinDecision | null; message: string }
export interface ChannelJoinDecisionAction { id: string; state: ChannelJoinDecisionState; action: 'send' | 'check' | 'dismiss' }
export function channelJoinDecisionRequest(raw: unknown): ChannelJoinDecisionRequest {
  const value = object(raw), version = /^\d{1,12}:\d{1,9}$/
  if (Object.keys(value).some(key => !['id', 'channelId', 'version', 'title', 'userId', 'requestVersion', 'approved'].includes(key)) ||
    typeof value.version !== 'string' || !version.test(value.version) || typeof value.requestVersion !== 'string' || !version.test(value.requestVersion) ||
    typeof value.title !== 'string' || !value.title || value.title.length > 512 || typeof value.approved !== 'boolean') throw new Error(tr('최신 가입 요청에서 대상을 다시 선택해 주세요.'))
  return { id: backgroundPhotoId(value.id), channelId: identifier(value.channelId), version: value.version, title: value.title,
    userId: identifier(value.userId), requestVersion: value.requestVersion, approved: value.approved }
}
export function channelJoinDecisionAction(raw: unknown): ChannelJoinDecisionAction {
  const value = object(raw)
  if (Object.keys(value).some(key => !['id', 'state', 'action'].includes(key)) || !['prepared', 'submitted', 'confirmed', 'rejected'].includes(String(value.state)) || !['send', 'check', 'dismiss'].includes(String(value.action))) throw new Error(tr('가입 처리 기록을 다시 확인해 주세요.'))
  return { id: backgroundPhotoId(value.id), state: value.state as ChannelJoinDecisionState, action: value.action as ChannelJoinDecisionAction['action'] }
}
