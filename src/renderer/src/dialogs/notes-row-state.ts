import { useSyncExternalStore } from 'react'
import { positionMilliseconds } from '../../../shared/model'
import type { NotesListPreview } from '../../../shared/space-notes'

// B503: the chat list's «노트» row, kept on this device as the three apps keep it (iOS ChatListLocalStateStore
// memoPinned_<uid> + pinnedAt, MorseNotesListPreview in UserDefaults):
// - it is pinned until it is unpinned here; pinned with no time yet (never moved) it stands below the other pinned
//   rows, pinned again or dragged it takes a time on the pin clock (seconds) and stands among them by it;
// - unpinned it stands among the chats by its newest note (milliseconds, as a chat's last message), the one last
//   read from the server, kept so the row keeps its place and line before the next read.
// It is never archived: Telegram keeps Saved Messages out of the archive (tdesktop CanArchive, window_peer_menu.cpp
// :4674-4676), and the three apps agreed to the same.
export interface NotesRowState { pinned: boolean; pinnedAt: number; at: number | null; line: string }
const ordinary: NotesRowState = { pinned: true, pinnedAt: 0, at: null, line: '' }

const key = (accountUid: string): string => `morse.notesRow.${accountUid}`
const listeners = new Set<() => void>()
const held = new Map<string, NotesRowState>()

function load(accountUid: string): NotesRowState {
  const cached = held.get(accountUid)
  if (cached) return cached
  let value = ordinary
  try {
    const raw = localStorage.getItem(key(accountUid))
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const stored = parsed as Partial<Record<keyof NotesRowState, unknown>>
      const number = (item: unknown): number | null => typeof item === 'number' && Number.isFinite(item) && item > 0 ? item : null
      const pinned = stored.pinned !== false
      value = { pinned, pinnedAt: pinned ? number(stored.pinnedAt) ?? 0 : 0, at: number(stored.at), line: typeof stored.line === 'string' ? stored.line.slice(0, 200) : '' }
    }
  } catch { /* A window with no storage keeps the ordinary state. */ }
  held.set(accountUid, value)
  return value
}
function save(accountUid: string, next: NotesRowState): void {
  const current = load(accountUid)
  if (current.pinned === next.pinned && current.pinnedAt === next.pinnedAt && current.at === next.at && current.line === next.line) return
  held.set(accountUid, next)
  try {
    const stored: Partial<NotesRowState> = {}
    if (!next.pinned) stored.pinned = false
    if (next.pinned && next.pinnedAt) stored.pinnedAt = next.pinnedAt
    if (next.at) { stored.at = next.at; stored.line = next.line }
    if (Object.keys(stored).length) localStorage.setItem(key(accountUid), JSON.stringify(stored)); else localStorage.removeItem(key(accountUid))
  } catch { /* per-device convenience only */ }
  for (const listener of [...listeners]) listener()
}

export function notesRowState(accountUid: string): NotesRowState { return load(accountUid) }
// iOS setMemoPinned: pinned now goes on top of the pinned rows; let go it keeps no time.
export function setNotesPinned(accountUid: string, pinned: boolean): void {
  save(accountUid, { ...load(accountUid), pinned, pinnedAt: pinned ? Date.now() / 1000 : 0 })
}
// A drag of the pinned rows gives the notes row its place on the pin clock (B502).
export function setNotesPinnedAt(accountUid: string, pinnedAt: number): void {
  const current = load(accountUid)
  if (current.pinned && Number.isFinite(pinnedAt) && pinnedAt > 0) save(accountUid, { ...current, pinnedAt })
}
// iOS MorseNotesListPreview.update: the first note, or nothing when there is none.
export function learnNotesPreview(accountUid: string, preview: NotesListPreview | null): void {
  const current = load(accountUid), time = preview ? positionMilliseconds(preview.updated) : NaN
  const known = Number.isFinite(time) && time > 0
  save(accountUid, { ...current, at: known ? time : null, line: known ? preview!.line.slice(0, 200) : '' })
}
export function refreshNotesPreview(accountUid: string): void {
  void window.morse.spaceNotesPreview(accountUid).then(preview => learnNotesPreview(accountUid, preview), () => {})
}

const subscribe = (listener: () => void): (() => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export function useNotesRowState(accountUid: string): NotesRowState {
  return useSyncExternalStore(subscribe, () => load(accountUid))
}
