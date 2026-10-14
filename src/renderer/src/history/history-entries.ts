import type { ChatMessage } from '../../../shared/model'
import { deliveryFailed, type LocalOutgoing } from '../../../shared/delivery'

// One row of a chat's history: a message as the server has it, or one of this device's still on its way.
export type Entry = { kind: 'message'; key: string; message: ChatMessage; own: boolean; time: number } | { kind: 'local'; key: string; item: LocalOutgoing; time: number }
// B90 (Telegram adds a local message once at the bottom and keeps its place through the answer and a failure —
// History::addNewLocalMessage, history.cpp:884-930; HistoryItem::setRealId, history_item.cpp:3165-3195; sendFailed,
// :4384-4393): the history first, then this device's messages it does not show yet, in the order they were written.
// A message leaves the local part the moment the history shows it, so each answer moves nothing.
export function historyEntries(messages: readonly ChatMessage[], items: readonly LocalOutgoing[], shown: (message: ChatMessage) => Entry | null): Entry[] {
  const list: Entry[] = [], ids = new Set<string>()
  for (const raw of messages) {
    ids.add(raw.id)
    const entry = shown(raw)
    if (entry) list.push(entry)
  }
  const locals = items.filter(item => !ids.has(item.id)).sort((a, b) => a.sequence - b.sequence || a.createdAt - b.createdAt)
  // B409-4 (tdesktop: a message that failed stays where it was written — HistoryItem::sendFailed keeps the item in its
  // block, and what comes later is added below it): one that did not go is placed by when it was written, among the
  // history, so a message sent or received after it lands below it and nothing above moves. Those still on their way are
  // the newest and stay at the bottom, in the order they were written (B90).
  for (const item of locals.filter(item => deliveryFailed(item.state))) {
    let at = list.length
    while (at > 0 && list[at - 1]!.time > item.createdAt) at--
    list.splice(at, 0, { kind: 'local', key: item.id, item, time: item.createdAt })
  }
  for (const item of locals.filter(item => !deliveryFailed(item.state))) list.push({ kind: 'local', key: item.id, item, time: item.createdAt })
  return list
}
