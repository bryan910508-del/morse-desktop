import { identifier, object, outgoingText } from './validation'
import { tr } from './i18n'

export type MessageActionKind = 'edit' | 'delete' | 'reaction'
// users: who reacted (Telegram's WhoReacted, iOS MorseReactionPeer), up to 50, the viewer first.
export interface ReactionSummary { emoji: string; count: number; selected: boolean; users?: { uid: string; name: string }[] }
export interface MessageActionRequest {
  id: string
  messageId: string
  version: string
  kind: MessageActionKind
  text?: string
  reactions?: string[]
}
export interface MessageActionItem {
  id: string; messageId: string; kind: MessageActionKind; preview: string
  state: 'queued' | 'uncertain' | 'failed'; reason: string; busy: boolean
}
export interface MessageActionsSnapshot { revision: number; ready: boolean; message: string; items: MessageActionItem[] }
export function reactionSelection(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length > 20 || raw.some(value => typeof value !== 'string' || !value.length || value.length > 32)) throw new Error(tr('반응은 20개까지 선택할 수 있습니다.'))
  return [...new Set(raw as string[])].sort()
}
export function actionRequest(raw: unknown): MessageActionRequest {
  const value = object(raw)
  if (!['edit', 'delete', 'reaction'].includes(String(value.kind)) || typeof value.version !== 'string' || !/^\d{1,12}:\d{1,9}$/.test(value.version)) throw new Error(tr('메시지를 다시 선택해 주세요.'))
  return { id: identifier(value.id), messageId: identifier(value.messageId), version: value.version, kind: value.kind as MessageActionKind,
    ...(value.kind === 'edit' ? { text: outgoingText(value.text) } : {}),
    ...(value.kind === 'reaction' ? { reactions: reactionSelection(value.reactions) } : {}) }
}
