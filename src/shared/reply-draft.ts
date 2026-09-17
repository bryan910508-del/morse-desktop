import type { ChatMessage, ReplyPreview } from './model'
import { identifier, object } from './validation'

export interface ReplyBinding { selectionId: string; messageId: string }
export interface ReplyDraftSnapshot {
  revision: number
  selection: ReplyBinding | null
  status: 'none' | 'loading' | 'ready' | 'unavailable' | 'error'
  preview: ReplyPreview | null
}
export function replyBinding(raw: unknown): ReplyBinding | null {
  if (raw === null || raw === undefined) return null
  const value = object(raw)
  return { selectionId: identifier(value.selectionId), messageId: identifier(value.messageId) }
}
export function canReply(message: ChatMessage): boolean {
  return message.serverConfirmed && message.readEligible && !message.encrypted && !message.system && message.kind !== 'unsupported' && Boolean(message.version)
}
