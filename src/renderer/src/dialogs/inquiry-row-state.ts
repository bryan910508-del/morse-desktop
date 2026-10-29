import { useSyncExternalStore } from 'react'
import { subscriberRowId } from '../../../shared/channel-inquiries'

// iOS ChatListLocalStateStore: an inquiry row's notifications, pin, unread mark and archive are kept on
// the device that set them (UserDefaults there, this store here). The room document has no place for
// them — its fields are the conversation, shared with the other side — so these never leave this window.
// B502: pinnedAt is the moment the row was pinned (or the rank a drag gave it), in seconds, on the clock a chat's pin
// rank uses, so pinned chats and pinned inquiry rows stand in one order (iOS ChatListInquiryPinStore pinnedAt).
export interface InquiryRowState { muted: boolean; pinned: boolean; unread: boolean; archived: boolean; pinnedAt: number }
export const noInquiryRowState: InquiryRowState = { muted: false, pinned: false, unread: false, archived: false, pinnedAt: 0 }

const key = (accountUid: string): string => `morse.inquiryRows.${accountUid}`
const listeners = new Set<() => void>()
let cache: { account: string; value: Record<string, Partial<InquiryRowState>> } | null = null

function all(accountUid: string): Record<string, Partial<InquiryRowState>> {
  if (cache?.account === accountUid) return cache.value
  let value: Record<string, Partial<InquiryRowState>> = {}
  try {
    const raw = localStorage.getItem(key(accountUid))
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) value = parsed as typeof value
  } catch { /* A window with no storage simply keeps nothing. */ }
  cache = { account: accountUid, value }
  return value
}
// One frozen value per row, so a row that did not change is the same object it was.
const rows = new Map<string, InquiryRowState>()
function read(accountUid: string, id: string): InquiryRowState {
  const stored = all(accountUid)[id], mapKey = `${accountUid}\n${id}`
  const value: InquiryRowState = { ...noInquiryRowState, ...(stored ?? {}) }
  if (typeof value.pinnedAt !== 'number' || !Number.isFinite(value.pinnedAt) || !value.pinned) value.pinnedAt = 0
  const held = rows.get(mapKey)
  if (held && held.muted === value.muted && held.pinned === value.pinned && held.unread === value.unread && held.archived === value.archived && held.pinnedAt === value.pinnedAt) return held
  rows.set(mapKey, value)
  return value
}

export function inquiryRowState(accountUid: string, id: string): InquiryRowState { return read(accountUid, id) }

export function setInquiryRowState(accountUid: string, id: string, patch: Partial<InquiryRowState>): void {
  const value = { ...all(accountUid) }
  const next: Partial<InquiryRowState> = { ...(value[id] ?? {}), ...patch }
  // A row pinned now goes on top of the pinned rows; one let go keeps no time.
  if (patch.pinned === true && patch.pinnedAt === undefined && !value[id]?.pinned) next.pinnedAt = Date.now() / 1000
  if (!next.pinned) delete next.pinnedAt
  // Nothing stored for a row that is in its ordinary state.
  for (const name of ['muted', 'pinned', 'unread', 'archived', 'pinnedAt'] as const) if (!next[name]) delete next[name]
  if (Object.keys(next).length) value[id] = next; else delete value[id]
  cache = { account: accountUid, value }
  try { localStorage.setItem(key(accountUid), JSON.stringify(value)) } catch { /* per-device convenience only */ }
  for (const listener of [...listeners]) listener()
}

// B484 (tdesktop Session::deleteConversationLocally, data_session.cpp:1699-1726): a room that is gone takes what this
// device kept for its row — archive, pin, notifications, unread mark — so a room made again under the same id
// (a subscriber's room is always <channel>_<uid>) starts as a new one.
export function forgetInquiryRows(accountUid: string, ids: readonly string[]): void {
  const value = { ...all(accountUid) }
  let changed = false
  for (const id of ids) if (id in value) { delete value[id]; changed = true }
  if (!changed) return
  cache = { account: accountUid, value }
  try { localStorage.setItem(key(accountUid), JSON.stringify(value)) } catch { /* per-device convenience only */ }
  for (const listener of [...listeners]) listener()
}
// The asking side's rooms this device keeps row state for (owner rows are a channel's folder, not a room).
export function storedSubscriberRooms(accountUid: string): string[] {
  return Object.keys(all(accountUid)).flatMap(id => id.startsWith(subscriberRowPrefix) ? [id.slice(subscriberRowPrefix.length)] : [])
}
const subscriberRowPrefix = subscriberRowId('')

const subscribe = (listener: () => void): (() => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export function useInquiryRowState(accountUid: string, id: string): InquiryRowState {
  return useSyncExternalStore(subscribe, () => read(accountUid, id))
}
// The rows the list is drawing, so it can order and place them without a hook per row.
export function useInquiryRowStates(accountUid: string): (id: string) => InquiryRowState {
  useSyncExternalStore(subscribe, () => all(accountUid))
  return id => read(accountUid, id)
}
