import { useSyncExternalStore } from 'react'
import type { ChatMessage } from '../../../shared/model'
import type { MessageActionsSnapshot, ReactionSummary } from '../../../shared/message-actions'
import { controller } from '../app/ui'
import { errorText } from '../app/format'
import { tr } from '../../../shared/i18n'

// HistoryItem local state: an edit, delete or reaction is shown immediately.
// The durable action queue in main applies it; a failure restores the item.
type Change = { id: string; kind: 'edit'; text: string; version: string } | { id: string; kind: 'delete'; version: string } | { id: string; kind: 'reaction'; reactions: ReactionSummary[]; version: string }
const changes = new Map<string, Change>()
let revision = 0
const listeners = new Set<() => void>()
function touch(): void { revision++; for (const listener of [...listeners]) listener() }
const subscribe = (listener: () => void): (() => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export function useMessageOverlay(): number { return useSyncExternalStore(subscribe, () => revision) }
const key = (chatId: string, messageId: string): string => `${chatId}/${messageId}`

export function overlayMessage(message: ChatMessage): ChatMessage | null {
  const change = changes.get(key(message.chatId, message.id))
  if (!change || change.version !== message.version) return message
  if (change.kind === 'delete') return null
  if (change.kind === 'edit') return { ...message, text: change.text, edited: true }
  return { ...message, reactions: change.reactions }
}

export function reconcileMessages(chatId: string, messages: readonly ChatMessage[]): void {
  let changed = false
  const current = new Map(messages.map(message => [message.id, message.version]))
  for (const [id, change] of changes) {
    if (!id.startsWith(`${chatId}/`)) continue
    const version = current.get(id.slice(chatId.length + 1))
    // The server copy moved to a new version (or disappeared): it is now authoritative.
    if (version !== undefined && version !== change.version) { changes.delete(id); changed = true }
  }
  if (changed) touch()
}

// An uncertain change is never sent again on its own: main checks it (and repeats
// the same conditional write when nothing changed) only when the user asks.
const notified = new Set<string>()
export function reconcileActions(accountUid: string, chatId: string, snapshot: MessageActionsSnapshot): void {
  for (const item of snapshot.items) {
    if (item.state === 'uncertain') {
      if (item.busy || notified.has(item.id)) continue
      notified.add(item.id)
      controller.toast(item.reason || tr('메시지 변경 결과를 확인하지 못했습니다.'), 'default', { label: tr('확인'), run: () => {
        notified.delete(item.id)
        void window.morse.checkMessageAction(accountUid, chatId, item.id).catch(reason => controller.toast(errorText(reason, tr('결과를 확인하지 못했습니다.')), 'error'))
      } })
      continue
    }
    if (item.state !== 'failed') continue
    const id = key(chatId, item.messageId), change = changes.get(id)
    if (change?.id === item.id) { changes.delete(id); touch() }
    controller.toast(item.reason || tr('메시지 변경을 적용하지 못했습니다.'), 'error')
    void window.morse.dismissMessageAction(accountUid, chatId, item.id).catch(() => {})
  }
}

async function mutate(accountUid: string, message: ChatMessage, change: Change, request: { kind: 'edit'; text: string } | { kind: 'delete' } | { kind: 'reaction'; reactions: string[] }): Promise<void> {
  const id = key(message.chatId, message.id)
  changes.set(id, change); touch()
  try { await window.morse.mutateMessage(accountUid, message.chatId, { id: change.id, messageId: message.id, version: message.version, ...request }) }
  catch (error) {
    if (changes.get(id)?.id === change.id) { changes.delete(id); touch() }
    controller.toast(errorText(error, tr('메시지 변경을 저장하지 못했습니다.')), 'error')
  }
}

export function editMessage(accountUid: string, message: ChatMessage, text: string): Promise<void> {
  const change: Change = { id: crypto.randomUUID(), kind: 'edit', text, version: message.version }
  return mutate(accountUid, message, change, { kind: 'edit', text })
}
export function deleteMessage(accountUid: string, message: ChatMessage): Promise<void> {
  return mutate(accountUid, message, { id: crypto.randomUUID(), kind: 'delete', version: message.version }, { kind: 'delete' })
}
export function toggleReaction(accountUid: string, message: ChatMessage, emoji: string): Promise<void> {
  const selected = new Set(message.reactions.filter(reaction => reaction.selected).map(reaction => reaction.emoji))
  const adding = !selected.has(emoji)
  if (adding) selected.add(emoji); else selected.delete(emoji)
  if (selected.size > 20) { controller.toast(tr('반응은 20개까지 선택할 수 있습니다.'), 'error'); return Promise.resolve() }
  const me = { uid: accountUid, name: tr('나') }
  const reactions = message.reactions.map(reaction => reaction.emoji === emoji ? { ...reaction, selected: adding, count: Math.max(0, reaction.count + (adding ? 1 : -1)),
    users: adding ? [me, ...(reaction.users ?? []).filter(user => user.uid !== accountUid)] : reaction.users?.filter(user => user.uid !== accountUid) } : reaction).filter(reaction => reaction.count > 0)
  if (adding && !message.reactions.some(reaction => reaction.emoji === emoji)) reactions.push({ emoji, count: 1, selected: true, users: [me] })
  const change: Change = { id: crypto.randomUUID(), kind: 'reaction', reactions, version: message.version }
  return mutate(accountUid, message, change, { kind: 'reaction', reactions: [...selected].sort() })
}
