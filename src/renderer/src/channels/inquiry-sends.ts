import { useCallback } from 'react'
import type { DesktopSnapshot } from '../../../shared/model'
import type { InquirySendItem } from '../../../shared/channel-inquiries'
import { useDesktop } from '../app/store'

// What this account has sent to an inquiry room and the room has not shown yet, per room: on its way, refused and
// waiting to be sent again or deleted, or just sent. The device's own queue keeps it (main/accounts/inquiry-sends.ts),
// so it outlives the open room, the window and a restart, as a chat's local messages do (HistoryItem stays in its
// History); the room's row marks it (iOS MorseInquiryListRowModel hasFailedOutgoing / hasSendingOutgoing, 1f27102b).
export type PendingEntry = { id: string; text: string; at: number; failed?: string; sent?: true; sticker?: import('../../../shared/stickers').StickerDraw }

const none: PendingEntry[] = []
function entries(snapshot: DesktopSnapshot | null, accountUid: string, inquiryId: string): PendingEntry[] {
  if (!snapshot || snapshot.activeAccountUid !== accountUid) return none
  const items = snapshot.inquirySends.filter(item => item.inquiryId === inquiryId)
  return items.length ? items.map(entry) : none
}
function entry(item: InquirySendItem): PendingEntry {
  return { id: item.id, text: item.text, at: item.at, ...(item.state === 'failed' ? { failed: item.reason } : {}), ...(item.state === 'sent' ? { sent: true as const } : {}), ...(item.sticker ? { sticker: item.sticker } : {}) }
}
const same = (a: PendingEntry[], b: PendingEntry[]): boolean => a.length === b.length &&
  a.every((item, index) => { const other = b[index]!; return item.id === other.id && item.text === other.text && item.at === other.at && item.failed === other.failed && item.sent === other.sent && item.sticker?.url === other.sticker?.url })

export function useInquiryPending(accountUid: string, inquiryId: string): PendingEntry[] {
  const select = useCallback((snapshot: DesktopSnapshot | null) => entries(snapshot, accountUid, inquiryId), [accountUid, inquiryId])
  return useDesktop(select, same)
}
// A room's row: a message of mine that did not go, and one still on its way.
export function useInquirySendState(accountUid: string, inquiryId: string | null): { sending: boolean; failed: boolean } {
  const select = useCallback((snapshot: DesktopSnapshot | null) => {
    const items = inquiryId ? entries(snapshot, accountUid, inquiryId) : none
    return { sending: items.some(item => item.failed === undefined && !item.sent), failed: items.some(item => item.failed !== undefined) }
  }, [accountUid, inquiryId])
  return useDesktop(select, (a, b) => a.sending === b.sending && a.failed === b.failed)
}
