import type { ChatMessage } from '../../../shared/model'
import type { LocalOutgoing } from '../../../shared/delivery'

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
  for (const item of locals) list.push({ kind: 'local', key: item.id, item, time: item.createdAt })
  return list
}
