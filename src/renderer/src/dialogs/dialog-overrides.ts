import { useSyncExternalStore } from 'react'
import type { DialogSummary } from '../../../shared/model'
import type { DialogPinSnapshot } from '../../../shared/dialog-pins'
import type { ManualUnreadSnapshot } from '../../../shared/manual-unread'
import { effectiveUnreadCount } from '../../../shared/manual-unread'
import { controller } from '../app/ui'
import { errorText } from '../app/format'
import { tr } from '../../../shared/i18n'

// Optimistic dialog flags: the row shows the requested state immediately and
// falls back to the server list when the write is rejected or observed.
interface Flag { value: boolean; id: string }
interface Override { pinned?: Flag; unread?: Flag }
const overrides = new Map<string, Override>()
const checked = new Set<string>()
let version = 0
const listeners = new Set<() => void>()
function touch(): void { version++; for (const listener of [...listeners]) listener() }
const subscribe = (listener: () => void): (() => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export function useDialogOverrides(): number { return useSyncExternalStore(subscribe, () => version) }

function clear(chatId: string, key: keyof Override, id?: string): void {
  const current = overrides.get(chatId)
  if (!current?.[key] || (id && current[key]!.id !== id)) return
  const next = { ...current }; delete next[key]
  if (next.pinned || next.unread) overrides.set(chatId, next); else overrides.delete(chatId)
  touch()
}

export function dialogFlags(dialog: DialogSummary): { pinned: boolean; unread: number; marked: boolean } {
  const override = overrides.get(dialog.id)
  const pinned = override?.pinned ? override.pinned.value : dialog.pinned
  if (override?.unread) return { pinned, unread: override.unread.value ? dialog.unreadCount : 0, marked: override.unread.value && dialog.unreadCount === 0 }
  return { pinned, unread: dialog.unreadCount, marked: dialog.markedUnread && dialog.unreadCount === 0 }
}

export async function setPinned(accountUid: string, dialog: DialogSummary, pinned: boolean): Promise<void> {
  const id = crypto.randomUUID()
  overrides.set(dialog.id, { ...overrides.get(dialog.id), pinned: { value: pinned, id } }); touch()
  try { await window.morse.setDialogPin(accountUid, { id, chatId: dialog.id, pinned, version: dialog.pinVersion }) }
  catch (error) { clear(dialog.id, 'pinned', id); controller.toast(errorText(error, tr('고정 상태를 바꾸지 못했습니다.')), 'error') }
}

export async function setUnread(accountUid: string, dialog: DialogSummary, markedUnread: boolean): Promise<void> {
  const id = crypto.randomUUID()
  overrides.set(dialog.id, { ...overrides.get(dialog.id), unread: { value: markedUnread, id } }); touch()
  try { await window.morse.setManualUnread(accountUid, { id, chatId: dialog.id, markedUnread, version: dialog.version }) }
  catch (error) { clear(dialog.id, 'unread', id); controller.toast(errorText(error, tr('읽음 표시를 바꾸지 못했습니다.')), 'error') }
}

export function reconcileDialogs(dialogs: readonly DialogSummary[]): void {
  for (const dialog of dialogs) {
    const override = overrides.get(dialog.id)
    if (!override) continue
    if (override.pinned && override.pinned.value === dialog.pinned) clear(dialog.id, 'pinned')
    if (override.unread && (effectiveUnreadCount(dialog) > 0) === override.unread.value) clear(dialog.id, 'unread')
  }
}

export function reconcilePin(accountUid: string, state: DialogPinSnapshot | null): void {
  const flag = state && overrides.get(state.chatId)?.pinned
  if (!state || !flag || flag.id !== state.id) return
  if (state.state === 'rejected') { clear(state.chatId, 'pinned', state.id); controller.toast(state.message || tr('고정 상태를 바꾸지 못했습니다.'), 'error') }
  else if (state.state === 'observed') clear(state.chatId, 'pinned', state.id)
  else if (state.state === 'uncertain' && !state.checking && !checked.has(state.id)) {
    checked.add(state.id)
    void window.morse.checkDialogPin(accountUid, state.chatId).catch(() => clear(state.chatId, 'pinned', state.id))
  }
}

export function reconcileUnread(accountUid: string, state: ManualUnreadSnapshot | null): void {
  const flag = state && overrides.get(state.chatId)?.unread
  if (!state || !flag || flag.id !== state.id) return
  if (state.state === 'rejected') { clear(state.chatId, 'unread', state.id); controller.toast(state.message || tr('읽음 표시를 바꾸지 못했습니다.'), 'error') }
  else if (state.state === 'observed') clear(state.chatId, 'unread', state.id)
  else if (state.state === 'uncertain' && !state.checking && !checked.has(state.id)) {
    checked.add(state.id)
    void window.morse.checkManualUnread(accountUid, state.chatId).catch(() => clear(state.chatId, 'unread', state.id))
  }
}
