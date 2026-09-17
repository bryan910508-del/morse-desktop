import type { MessageActionRequest, MessageActionItem } from '../../shared/message-actions'
export interface StoredMessageAction extends MessageActionRequest {
  chatId: string; preview: string; state: MessageActionItem['state']; reason: string
}
export type MessageActionCommand =
  | { kind: 'action-list' }
  | { kind: 'action-enqueue'; action: StoredMessageAction }
  | { kind: 'action-claim'; id: string }
  | { kind: 'action-state'; id: string; state: 'queued' | 'failed' | 'uncertain'; reason: string }
  | { kind: 'action-finish'; id: string }
  | { kind: 'action-dismiss'; id: string }
  | { kind: 'action-prune'; allowed: string[] }
export interface MessageActionStore { <T>(command: MessageActionCommand): Promise<T> }
