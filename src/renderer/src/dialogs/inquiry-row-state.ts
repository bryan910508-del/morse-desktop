import { useSyncExternalStore } from 'react'

// iOS ChatListLocalStateStore: an inquiry row's notifications, pin, unread mark and archive are kept on
// the device that set them (UserDefaults there, this store here). The room document has no place for
// them — its fields are the conversation, shared with the other side — so these never leave this window.
export interface InquiryRowState { muted: boolean; pinned: boolean; unread: boolean; archived: boolean }
export const noInquiryRowState: InquiryRowState = { muted: false, pinned: false, unread: false, archived: false }

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
  const held = rows.get(mapKey)
  if (held && held.muted === value.muted && held.pinned === value.pinned && held.unread === value.unread && held.archived === value.archived) return held
  rows.set(mapKey, value)
  return value
}

export function inquiryRowState(accountUid: string, id: string): InquiryRowState { return read(accountUid, id) }

export function setInquiryRowState(accountUid: string, id: string, patch: Partial<InquiryRowState>): void {
  const value = { ...all(accountUid) }
  const next: Partial<InquiryRowState> = { ...(value[id] ?? {}), ...patch }
  // Nothing stored for a row that is in its ordinary state.
  for (const name of ['muted', 'pinned', 'unread', 'archived'] as const) if (!next[name]) delete next[name]
  if (Object.keys(next).length) value[id] = next; else delete value[id]
  cache = { account: accountUid, value }
  try { localStorage.setItem(key(accountUid), JSON.stringify(value)) } catch { /* per-device convenience only */ }
  for (const listener of [...listeners]) listener()
}

const subscribe = (listener: () => void): (() => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export function useInquiryRowState(accountUid: string, id: string): InquiryRowState {
  return useSyncExternalStore(subscribe, () => read(accountUid, id))
}
// The rows the list is drawing, so it can order and place them without a hook per row.
export function useInquiryRowStates(accountUid: string): (id: string) => InquiryRowState {
  useSyncExternalStore(subscribe, () => all(accountUid))
  return id => read(accountUid, id)
}
