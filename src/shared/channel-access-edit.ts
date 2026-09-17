import { backgroundPhotoId } from './chat-background'
import { channelCategories, channelChatModes, channelJoinPolicies } from './channel-access'
import { identifier, object } from './validation'
import { tr } from './i18n'
export interface ChannelAccessSettings {
  type: 'public' | 'private' | 'invite'; joinPolicy: keyof typeof channelJoinPolicies; chatMode: keyof typeof channelChatModes
  historyVisible: boolean; category: keyof typeof channelCategories | null
}
export interface ChannelAccessTarget { channelId: string; version: string; title: string; settings: ChannelAccessSettings }
export interface ChannelAccessRequest extends ChannelAccessTarget { id: string; mode: 'edit' | 'sync'; next: ChannelAccessSettings }
export const accessStates = ['prepared', 'saving', 'settings-ready', 'joining', 'discussion-ready', 'syncing', 'completed', 'save-rejected', 'join-rejected', 'sync-rejected'] as const
export type ChannelAccessState = typeof accessStates[number]
export interface PendingChannelAccess extends ChannelAccessRequest { state: ChannelAccessState }
export interface ChannelAccessAction { id: string; state: ChannelAccessState; action: 'continue' | 'check' | 'dismiss' }
export interface ChannelAccessEditSnapshot { status: 'loading' | 'ready' | 'error'; busy: boolean; canContinue: boolean; pending: PendingChannelAccess | null; message: string }
export const continuableAccessStates: readonly ChannelAccessState[] = ['prepared', 'settings-ready', 'discussion-ready', 'save-rejected', 'join-rejected', 'sync-rejected']
export function channelAccessSettings(raw: unknown): ChannelAccessSettings {
  const value = object(raw)
  if (Object.keys(value).some(key => !['type', 'joinPolicy', 'chatMode', 'historyVisible', 'category'].includes(key)) ||
    !['public', 'private', 'invite'].some(type => value.type === type) || typeof value.joinPolicy !== 'string' || !Object.hasOwn(channelJoinPolicies, value.joinPolicy) ||
    typeof value.chatMode !== 'string' || !Object.hasOwn(channelChatModes, value.chatMode) || typeof value.historyVisible !== 'boolean' ||
    (value.category !== null && (typeof value.category !== 'string' || !Object.hasOwn(channelCategories, value.category))) ||
    (value.type !== 'public' && value.category !== null)) throw new Error(tr('채널 접근 설정을 다시 확인해 주세요.'))
  return { type: value.type as ChannelAccessSettings['type'], joinPolicy: value.joinPolicy as ChannelAccessSettings['joinPolicy'], chatMode: value.chatMode as ChannelAccessSettings['chatMode'], historyVisible: value.historyVisible, category: value.category as ChannelAccessSettings['category'] }
}
export function channelAccessTarget(raw: unknown): ChannelAccessTarget {
  const value = object(raw)
  if (Object.keys(value).some(key => !['channelId', 'version', 'title', 'settings'].includes(key)) || typeof value.version !== 'string' || !/^\d{1,12}:\d{1,9}$/.test(value.version) || typeof value.title !== 'string' || !value.title || value.title.length > 512) throw new Error(tr('최신 소유 채널 정보를 확인해 주세요.'))
  return { channelId: identifier(value.channelId), version: value.version, title: value.title, settings: channelAccessSettings(value.settings) }
}
export function channelAccessRequest(raw: unknown): ChannelAccessRequest {
  const value = object(raw)
  if (Object.keys(value).some(key => !['id', 'channelId', 'version', 'title', 'settings', 'mode', 'next'].includes(key)) || (value.mode !== 'edit' && value.mode !== 'sync')) throw new Error(tr('설정 변경 내용을 다시 확인해 주세요.'))
  const target = channelAccessTarget({ channelId: value.channelId, version: value.version, title: value.title, settings: value.settings }), next = channelAccessSettings(value.next)
  if (next.type === 'public' && target.settings.type !== 'public') throw new Error(tr('현재 새 공개 채널 전환은 잠겨 있습니다.'))
  const same = JSON.stringify(target.settings) === JSON.stringify(next)
  if ((value.mode === 'edit' && same) || (value.mode === 'sync' && !same)) throw new Error(tr('설정 변경과 현재 설정 동기화를 구분해 주세요.'))
  return { id: backgroundPhotoId(value.id), ...target, mode: value.mode, next }
}
export function channelAccessAction(raw: unknown): ChannelAccessAction {
  const value = object(raw)
  if (Object.keys(value).some(key => !['id', 'state', 'action'].includes(key)) || !accessStates.some(state => state === value.state) || !['continue', 'check', 'dismiss'].some(action => action === value.action)) throw new Error(tr('최신 설정 작업 기록을 확인해 주세요.'))
  return { id: backgroundPhotoId(value.id), state: value.state as ChannelAccessState, action: value.action as ChannelAccessAction['action'] }
}
