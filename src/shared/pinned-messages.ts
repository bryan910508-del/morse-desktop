import type { MessagePosition } from './model'
import { identifier, object } from './validation'
import { tr } from './i18n'

// MorseMessenger iOS ChatRoomView bookmarkLimit: pinned messages per chat, both kinds together.
export const freePinLimit = 3
export const premiumPinLimit = 10

// One pinned message of the open chat: "나에게만 고정" is kept on this device (iOS isBookmarked),
// "모두에게 고정" is chats/{id}.pinnedForAllMessageIds shared with everyone in the chat.
export interface PinnedMessageItem {
  id: string
  forMe: boolean
  forAll: boolean
  status: 'loading' | 'ready' | 'unavailable'
  preview: string
  position: MessagePosition | null
}
export interface PinnedMessagesSnapshot { chatId: string; items: PinnedMessageItem[]; limit: number }
export interface PinMessageRequest { chatId: string; messageId: string; scope: 'me' | 'all'; pin: boolean }

export function pinMessageRequest(raw: unknown): PinMessageRequest {
  const value = object(raw)
  if ((value.scope !== 'me' && value.scope !== 'all') || typeof value.pin !== 'boolean') throw new Error(tr('고정 방식을 다시 선택해 주세요.'))
  return { chatId: identifier(value.chatId), messageId: identifier(value.messageId), scope: value.scope, pin: value.pin }
}
