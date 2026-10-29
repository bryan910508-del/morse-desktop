import { useEffect } from 'react'
import { subscriberRowId, type InquiryRow } from '../../../shared/channel-inquiries'
import { forgetInquiryRows, storedSubscriberRooms } from './inquiry-row-state'

// B484: the asking side's rooms that this device keeps row state for but the lists no longer show are asked about once
// per run; those the server says are gone lose that state (inquiry-row-state forgetInquiryRows). A room still listed is
// never asked, and an answer given before both lists have answered is not an answer — it is asked again with the next list.
const asked = new Map<string, Set<string>>()
export async function forgetGoneInquiryRows(accountUid: string, rows: readonly Pick<InquiryRow, 'inquiryId' | 'kind'>[]): Promise<void> {
  const listed = new Set(rows.flatMap(row => row.kind === 'subscriber' && row.inquiryId ? [row.inquiryId] : []))
  const done = asked.get(accountUid) ?? new Set<string>()
  asked.set(accountUid, done)
  const candidates = storedSubscriberRooms(accountUid).filter(id => !listed.has(id) && !done.has(id)).slice(0, 20)
  if (!candidates.length) return
  for (const id of candidates) done.add(id)
  try {
    const answer = await window.morse.goneInquiries(accountUid, candidates)
    if (!answer.answered) { for (const id of candidates) done.delete(id); return }
    forgetInquiryRows(accountUid, answer.gone.map(subscriberRowId))
  } catch { for (const id of candidates) done.delete(id) }
}
export function useGoneInquiryRows(accountUid: string, rows: readonly InquiryRow[]): void {
  useEffect(() => { void forgetGoneInquiryRows(accountUid, rows) }, [accountUid, rows])
}
