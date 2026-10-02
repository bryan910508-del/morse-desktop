import { canForwardMessage } from './forward'
import { maxForwardMessages } from './forward-batch'
import { selectedMessagesText } from './message-copy'
import type { ChatMessage } from './model'

// What can be done with the chosen messages, written once for the selection bar and the menu on a chosen message.
export interface SelectionActions { copy: boolean; forward: boolean; delete: boolean }
export function selectionActions(messages: ChatMessage[]): SelectionActions {
  const some = messages.length > 0
  return {
    copy: some && selectedMessagesText(messages, () => '') !== '',
    forward: some && messages.length <= maxForwardMessages && messages.every(canForwardMessage),
    delete: some && messages.length <= 100 && messages.every(message => Boolean(message.version))
  }
}
// B61 (Telegram history_inner_widget.cpp:3541-3551, 3732-3759): the menu on a chosen message, in Telegram's order —
// copy, forward when every chosen message can go, delete when every one can be deleted, and clearing the selection.
// Telegram's translate, unpin and download rows are left out: the selection bar has none of them.
export type SelectionMenuRow = 'copy' | 'forward' | 'delete' | 'clear'
export function selectionMenuRows(can: SelectionActions): SelectionMenuRow[] {
  return [...(can.copy ? ['copy' as const] : []), ...(can.forward ? ['forward' as const] : []), ...(can.delete ? ['delete' as const] : []), 'clear']
}
