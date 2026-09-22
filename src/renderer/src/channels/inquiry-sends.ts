import { useSyncExternalStore } from 'react'

// What this window has sent to an inquiry room and the server has not shown yet, per account and room: on its way,
// or failed and waiting to be sent again or deleted. It outlives the open room, as a chat's local messages do
// (HistoryItem stays in its History), so a failed message is still there when the room is opened again, and the
// room's row can mark it (iOS MorseInquiryListRowModel hasFailedOutgoing / hasSendingOutgoing, 1f27102b).
export type PendingEntry = { id: string; text: string; at: number; failed?: string; sent?: true }

const rooms = new Map<string, PendingEntry[]>()
const retries = new Map<string, () => Promise<void>>()
const listeners = new Set<() => void>()
const none: PendingEntry[] = []
const key = (accountUid: string, inquiryId: string): string => `${accountUid}\n${inquiryId}`

function subscribe(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } }
export function updateInquiryPending(accountUid: string, inquiryId: string, update: (current: PendingEntry[]) => PendingEntry[]): void {
  const id = key(accountUid, inquiryId), current = rooms.get(id) ?? none, next = update(current)
  if (next === current) return
  if (next.length) rooms.set(id, next); else rooms.delete(id)
  for (const entry of current) if (!next.some(item => item.id === entry.id)) retries.delete(`${id}\n${entry.id}`)
  for (const listener of listeners) listener()
}
export function useInquiryPending(accountUid: string, inquiryId: string): PendingEntry[] {
  return useSyncExternalStore(subscribe, () => rooms.get(key(accountUid, inquiryId)) ?? none)
}
// The server has it: it stays on screen until the room's history shows it, as a chat's sent item does, and leaves
// by itself after a minute when no open room is there to see it arrive.
export function markInquirySent(accountUid: string, inquiryId: string, id: string): void {
  updateInquiryPending(accountUid, inquiryId, current => current.some(entry => entry.id === id) ? current.map(entry => entry.id === id ? { ...entry, sent: true as const } : entry) : current)
  setTimeout(() => updateInquiryPending(accountUid, inquiryId, current => current.some(entry => entry.id === id && entry.sent) ? current.filter(entry => entry.id !== id) : current), 60000)
}
// A room's row: a message of mine that did not go, and one still on its way.
export function useInquirySendState(accountUid: string, inquiryId: string | null): { sending: boolean; failed: boolean } {
  const failed = useSyncExternalStore(subscribe, () => Boolean(inquiryId && rooms.get(key(accountUid, inquiryId))?.some(entry => entry.failed !== undefined)))
  const sending = useSyncExternalStore(subscribe, () => Boolean(inquiryId && rooms.get(key(accountUid, inquiryId))?.some(entry => entry.failed === undefined && !entry.sent)))
  return { sending, failed }
}
export function setInquiryRetry(accountUid: string, inquiryId: string, id: string, retry: (() => Promise<void>) | null): void {
  if (retry) retries.set(`${key(accountUid, inquiryId)}\n${id}`, retry); else retries.delete(`${key(accountUid, inquiryId)}\n${id}`)
}
export function inquiryRetry(accountUid: string, inquiryId: string, id: string): (() => Promise<void>) | undefined {
  return retries.get(`${key(accountUid, inquiryId)}\n${id}`)
}
