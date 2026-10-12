import type { LocalOutgoing } from '../../../shared/delivery'

// B306 (tdesktop HistoryWidget::sendTextWithTags, history_widget.cpp:6004-6020: the local message goes into the history
// in the same pass that clears the field — api().sendMessage(…, nextLocalMessageId) then clearFieldText()): a text is
// drawn as a message on its way the moment the composer empties, under the id it is sent with, instead of after the
// queue has stored it and told the window. The queue's own item for that id, or the history's message, takes its place
// — one message is one item (B303) — and a send the queue refused takes it away again.
export interface PressedSend { id: string; chatId: string; text: string; replyToId?: string; createdAt: number }

// After the queue's items, in the order they were pressed (historyEntries sorts by sequence, then by time).
const pressedSequence = Number.MAX_SAFE_INTEGER
export function pressedItem(send: PressedSend): LocalOutgoing {
  return { id: send.id, chatId: send.chatId, sequence: pressedSequence, text: send.text, ...(send.replyToId ? { replyToId: send.replyToId } : {}),
    createdAt: send.createdAt, state: 'queued', reason: '', busy: true, retryable: false }
}
export const isPressedItem = (item: Pick<LocalOutgoing, 'sequence'>): boolean => item.sequence === pressedSequence
// The window's items: the queue's, then each pressed text the queue does not list yet.
export function withPressed(items: readonly LocalOutgoing[], pressed: readonly PressedSend[]): readonly LocalOutgoing[] {
  const waiting = pressed.filter(send => !items.some(item => item.id === send.id))
  return waiting.length ? [...items, ...waiting.map(pressedItem)] : items
}
// The pressed texts still waiting for their item: one the queue or the history shows has handed over. The same array
// when nothing changed, so a render does not ask for another.
export function stillPressed(pressed: readonly PressedSend[], items: readonly Pick<LocalOutgoing, 'id'>[], shown: ReadonlySet<string>): readonly PressedSend[] {
  const next = pressed.filter(send => !shown.has(send.id) && !items.some(item => item.id === send.id))
  return next.length === pressed.length ? pressed : next
}
