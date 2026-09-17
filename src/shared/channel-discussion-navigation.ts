import { identifier, object } from './validation'
import { tr } from './i18n'
export type ChannelDiscussionReference = { status: 'none' | 'unknown'; chatId: null } | { status: 'known'; chatId: string }
export interface ChannelDiscussionNavigation { channelId: string; version: string; chatId: string }
export interface ChannelDiscussionDestination { chatId: string; version: string }
export function channelDiscussionNavigation(raw: unknown): ChannelDiscussionNavigation {
  const value = object(raw)
  if (Object.keys(value).some(key => !['channelId', 'version', 'chatId'].includes(key)) || typeof value.version !== 'string' || !/^\d{1,12}:\d{1,9}$/.test(value.version)) throw new Error(tr('최신 채널에서 토론방을 다시 선택해 주세요.'))
  return { channelId: identifier(value.channelId), version: value.version, chatId: identifier(value.chatId) }
}
