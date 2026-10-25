// Portions of this file follow Telegram Desktop (https://github.com/telegramdesktop/tdesktop, 7.2.8, 272f6f5c),
// Copyright (c) 2014-2026 The Telegram Desktop Authors. Licensed under GPL-3.0-or-later; see LEGAL.
import { useSyncExternalStore } from 'react'
import { versionNewer, type DialogSummary } from '../../../shared/model'
import type { DialogPinSnapshot } from '../../../shared/dialog-pins'
import type { ManualUnreadSnapshot } from '../../../shared/manual-unread'
import { effectiveUnreadCount } from '../../../shared/manual-unread'
import { controller } from '../app/ui'
import { errorText } from '../app/format'
import { tr } from '../../../shared/i18n'

// Optimistic dialog flags: the row shows the requested state immediately and
// falls back to the server list when the write is rejected or observed.
// B104 (b): a flag is a request, not a second copy of the list. tdesktop applies changeDialogUnreadMark and a pin at
// once and lets the server's dialog list overwrite them (data_histories.cpp:516-527); here, once the server has
// answered (saved) and a copy newer than the one the request was made on has come, that copy is what the row shows,
// whatever it says. Every answer writes that copy: the chat for the mark (setMorseChatUnread tx.update), this
// account's dialogStates document for a pin (writeDialogPin) — so a newer copy always follows the answer.
interface Flag { value: boolean; id: string; version: string; answered?: boolean; at?: number }
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

// The pin's copy is its dialogStates document (pinVersion, '' while there is none); the mark's is the chat.
const copy = (key: keyof Override, dialog: DialogSummary): string => key === 'pinned' ? dialog.pinVersion : dialog.version
function overtaken(override: Override | undefined, key: keyof Override, dialog: DialogSummary): boolean {
  const flag = override?.[key]
  return Boolean(flag?.answered && versionNewer(copy(key, dialog), flag.version))
}
function answered(chatId: string, key: keyof Override, id: string): void {
  const current = overrides.get(chatId), flag = current?.[key]
  if (!current || !flag || flag.id !== id || flag.answered) return
  overrides.set(chatId, { ...current, [key]: { ...flag, answered: true } }); touch()
}

export function dialogFlags(dialog: DialogSummary): { pinned: boolean; unread: number; marked: boolean } {
  const override = overrides.get(dialog.id)
  const pinned = override?.pinned && !overtaken(override, 'pinned', dialog) ? override.pinned.value : dialog.pinned
  if (override?.unread && !overtaken(override, 'unread', dialog)) return { pinned, unread: override.unread.value ? dialog.unreadCount : 0, marked: override.unread.value && dialog.unreadCount === 0 }
  return { pinned, unread: dialog.unreadCount, marked: dialog.markedUnread && dialog.unreadCount === 0 }
}

export async function setPinned(accountUid: string, dialog: DialogSummary, pinned: boolean): Promise<void> {
  const id = crypto.randomUUID()
  overrides.set(dialog.id, { ...overrides.get(dialog.id), pinned: { value: pinned, id, version: dialog.pinVersion, at: Date.now() / 1000 } }); touch()
  try { await window.morse.setDialogPin(accountUid, { id, chatId: dialog.id, pinned, version: dialog.pinVersion }) }
  catch (error) { clear(dialog.id, 'pinned', id); controller.toast(errorText(error, tr('고정 상태를 바꾸지 못했습니다.')), 'error') }
}

export async function setUnread(accountUid: string, dialog: DialogSummary, markedUnread: boolean): Promise<void> {
  const id = crypto.randomUUID()
  overrides.set(dialog.id, { ...overrides.get(dialog.id), unread: { value: markedUnread, id, version: dialog.version } }); touch()
  try { await window.morse.setManualUnread(accountUid, { id, chatId: dialog.id, markedUnread, version: dialog.version }) }
  catch (error) { clear(dialog.id, 'unread', id); controller.toast(errorText(error, tr('읽음 표시를 바꾸지 못했습니다.')), 'error') }
}

// B502: a dropped order shows at once, the way a pin does: each chat stands at the rank it was given until a pin copy
// newer than the one the order was made on has come after the answer (or the chat is no longer pinned there).
interface Order { rank: number; id: string; version: string; answered?: boolean }
const orders = new Map<string, Order>()
function clearOrder(id: string): void {
  let changed = false
  for (const [chatId, order] of orders) if (order.id === id) { orders.delete(chatId); changed = true }
  if (changed) touch()
}
// Where a chat stands among the pinned rows, highest first, on the clock inquiry rows use (pinnedAt).
export function pinRank(dialog: DialogSummary): number {
  const order = orders.get(dialog.id)
  if (order) return order.rank
  const flag = overrides.get(dialog.id)?.pinned
  if (flag?.value && !dialog.pinned && !overtaken(overrides.get(dialog.id), 'pinned', dialog)) return flag.at ?? Infinity
  return dialog.pinRank ?? 0
}
// A pin or an order of this chat not yet settled keeps a new drag from starting over it.
export function pinUnsettled(dialog: DialogSummary): boolean {
  return Boolean(overrides.get(dialog.id)?.pinned || orders.has(dialog.id))
}
export async function setPinOrder(accountUid: string, chats: readonly { dialog: DialogSummary; rank: number }[]): Promise<void> {
  if (!chats.length) return
  const id = crypto.randomUUID()
  for (const { dialog, rank } of chats) orders.set(dialog.id, { rank, id, version: dialog.pinVersion })
  touch()
  try {
    await window.morse.setDialogPinOrder(accountUid, { id, chats: chats.map(({ dialog, rank }) => ({ chatId: dialog.id, version: dialog.pinVersion, rank })) })
    let changed = false
    for (const order of orders.values()) if (order.id === id && !order.answered) { order.answered = true; changed = true }
    if (changed) touch()
  } catch (error) { clearOrder(id); controller.toast(errorText(error, tr('고정 순서를 바꾸지 못했습니다.')), 'error') }
}

export function reconcileDialogs(dialogs: readonly DialogSummary[]): void {
  for (const dialog of dialogs) {
    const order = orders.get(dialog.id)
    if (order && (!dialog.pinned || (order.answered && versionNewer(dialog.pinVersion, order.version)))) { orders.delete(dialog.id); touch() }
    const override = overrides.get(dialog.id)
    if (!override) continue
    if (override.pinned && (override.pinned.value === dialog.pinned || overtaken(override, 'pinned', dialog))) clear(dialog.id, 'pinned')
    if (override.unread && ((effectiveUnreadCount(dialog) > 0) === override.unread.value || overtaken(override, 'unread', dialog))) clear(dialog.id, 'unread')
  }
}

export function reconcilePin(accountUid: string, state: DialogPinSnapshot | null): void {
  const flag = state && overrides.get(state.chatId)?.pinned
  if (!state || !flag || flag.id !== state.id) return
  if (state.state === 'rejected') { clear(state.chatId, 'pinned', state.id); controller.toast(state.message || tr('고정 상태를 바꾸지 못했습니다.'), 'error') }
  else if (state.state === 'observed') clear(state.chatId, 'pinned', state.id)
  else if (state.state === 'saved') answered(state.chatId, 'pinned', state.id)
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
  else if (state.state === 'saved') answered(state.chatId, 'unread', state.id)
  else if (state.state === 'uncertain' && !state.checking && !checked.has(state.id)) {
    checked.add(state.id)
    void window.morse.checkManualUnread(accountUid, state.chatId).catch(() => clear(state.chatId, 'unread', state.id))
  }
}
