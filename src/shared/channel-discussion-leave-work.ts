import type { DeliveryState } from './delivery'
import type { MessageActionKind, MessageActionItem } from './message-actions'
import { channelDiscussionNavigation, type ChannelDiscussionNavigation } from './channel-discussion-navigation'
import { replyBinding, type ReplyBinding } from './reply-draft'
import { draftText, identifier, object } from './validation'
import { tr } from './i18n'
export interface LeaveOutgoingRecord { id: string; state: DeliveryState; createdAt: number }
export interface LeaveActionRecord { id: string; messageId: string; actionKind: MessageActionKind; state: MessageActionItem['state']; digest: string }
export interface DiscussionLeaveWork { outgoingItems: LeaveOutgoingRecord[]; actionItems: LeaveActionRecord[]; chatId: string; draft: string; reply: ReplyBinding | null; outgoing: number; actions: number; selectedAttachment: boolean; voiceDraft:boolean }
export interface DiscussionLeaveWorkClear { target: ChannelDiscussionNavigation; draft: string; reply: ReplyBinding | null; clearText: boolean; clearReply: boolean }
export function discussionLeaveWorkClear(raw: unknown): DiscussionLeaveWorkClear {
  const value = object(raw)
  if (Object.keys(value).some(key => !['target', 'draft', 'reply', 'clearText', 'clearReply'].includes(key)) ||
    typeof value.clearText !== 'boolean' || typeof value.clearReply !== 'boolean' || (!value.clearText && !value.clearReply) || value.reply === undefined) throw new Error(tr('정리할 로컬 초안을 다시 선택해 주세요.'))
  if (value.reply !== null && Object.keys(object(value.reply)).some(key => !['selectionId', 'messageId'].includes(key))) throw new Error(tr('답장 선택을 다시 확인해 주세요.'))
  return { target: channelDiscussionNavigation(value.target), draft: draftText(value.draft), reply: replyBinding(value.reply), clearText: value.clearText, clearReply: value.clearReply }
}

export type LeaveRecordSelection = { kind: 'outgoing'; id: string; state: DeliveryState } | { kind: 'action'; id: string; state: MessageActionItem['state']; digest: string }
export type DiscussionLeaveWorkDismiss = LeaveRecordSelection & { target: ChannelDiscussionNavigation }
export function discussionLeaveWorkDismiss(raw: unknown): DiscussionLeaveWorkDismiss {
  const value = object(raw), target = channelDiscussionNavigation(value.target), id = identifier(value.id)
  if (value.kind === 'outgoing' && Object.keys(value).every(key => ['target', 'kind', 'id', 'state'].includes(key)) && ['queued', 'uncertain', 'failed', 'uploading', 'upload-failed'].includes(String(value.state))) return { target, id, kind: 'outgoing', state: value.state as DeliveryState }
  if (value.kind === 'action' && Object.keys(value).every(key => ['target', 'kind', 'id', 'state', 'digest'].includes(key)) && ['queued', 'uncertain', 'failed'].includes(String(value.state)) && typeof value.digest === 'string' && /^[a-f0-9]{64}$/.test(value.digest)) return { target, id, kind: 'action', state: value.state as MessageActionItem['state'], digest: value.digest }
  throw new Error(tr('최신 로컬 작업에서 정리할 기록을 다시 선택해 주세요.'))
}
