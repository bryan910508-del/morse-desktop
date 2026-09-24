import { useEffect, useSyncExternalStore } from 'react'
import { desktop } from '../app/store'
import { controller } from '../app/ui'
import { errorText } from '../app/format'
import { tr } from '../../../shared/i18n'
import { waitFor } from '../app/contacts'

// SpaceNotes keeps one open list per account; the list widget and the note
// editor share its request id.
let session: { accountUid: string; requestId: string } | null = null
const listeners = new Set<() => void>()
const emit = (): void => { for (const listener of [...listeners]) listener() }
const subscribe = (listener: () => void): (() => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }

export function useNotesRequest(accountUid: string): string | null {
  const value = useSyncExternalStore(subscribe, () => session)
  return value?.accountUid === accountUid ? value.requestId : null
}

// A narrow window shows one column at a time, so the list column is unmounted the moment a note is
// opened. Telegram's narrow mode swaps which column is drawn and keeps the dialogs it has loaded; the
// list here is opened while the notes section is the one on screen, whichever column that is, so the
// note being edited still has the list its editing is bound to.
export function useNotesSession(accountUid: string, active: boolean): void {
  useEffect(() => {
    if (!active) return
    void openNotesList(accountUid).catch(reason => controller.toast(errorText(reason, tr('노트를 불러오지 못했습니다.')), 'error'))
    return () => closeNotesList(accountUid)
  }, [accountUid, active])
}

export async function openNotesList(accountUid: string): Promise<string> {
  const previous = session
  const requestId = crypto.randomUUID()
  session = { accountUid, requestId }; emit()
  if (previous) await window.morse.closeSpaceNotes(previous.accountUid, previous.requestId).catch(() => {})
  await window.morse.openSpaceNotes(accountUid, requestId)
  return requestId
}

export function adoptNotesRequest(accountUid: string, requestId: string): void {
  session = { accountUid, requestId }; emit()
}

export function closeNotesList(accountUid: string): void {
  const current = session
  if (current?.accountUid !== accountUid) return
  session = null; emit()
  void window.morse.closeSpaceNotes(accountUid, current.requestId).catch(() => {})
}

// Notes are read per request, so a change is followed by a fresh list.
export async function reloadNotes(accountUid: string, select?: string): Promise<void> {
  const requestId = await openNotesList(accountUid)
  if (!select) return
  const state = await waitFor(() => { const value = desktop.value?.spaceNotes; return value?.requestId === requestId && value.status !== 'loading' && value.status !== 'idle' ? value : null }, 10000).catch(() => null)
  if (state?.rows.some(row => row.id === select)) controller.openNote(select)
}
