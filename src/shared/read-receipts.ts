import type { MessagePosition } from './model'
import { positionMilliseconds } from './model'

// Railway compares Timestamp.toMillis() then ASCII ID. History pagination keeps
// its separate nanosecond cursor; never replace that cursor with this wire value.
export interface ReadCursor { at: number; id: string }
export interface ReadAcknowledgement { cursor: ReadCursor; unreadCount: number; alreadyExisted: boolean }
export interface ReadSyncState { state: 'ready' | 'pending' | 'error'; message: string }
export const idleReadSync: ReadSyncState = { state: 'ready', message: '' }
export function readCursor(position: MessagePosition): ReadCursor { return { at: positionMilliseconds(position), id: position.id } }
export function compareReadCursor(a: ReadCursor, b: ReadCursor): number {
  return a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}
export function readCovers(cursor: ReadCursor | null | undefined, target: ReadCursor): boolean {
  if (!cursor) return false
  // The authoritative ID also identifies the exact target when Firestore's
  // fromMillis() round trip loses sub-microsecond floating-point precision.
  if (cursor.id && cursor.id === target.id) return true
  return cursor.id ? compareReadCursor(cursor, target) >= 0 : cursor.at > target.at
}

// History::outboxReadTillId: a room keeps one boundary up to which what this account sent has been read
// (History::isServerSideUnread compares a message with it), and it only moves forward (History::outboxRead). In a
// group it is where the furthest reader has come — what iOS and Android show as read once anyone has read it; there
// is no count of readers. The boundary is the furthest of the other people's read positions.
export function outboxReadTill(positions: Readonly<Record<string, ReadCursor>>, peers: readonly string[]): ReadCursor | null {
  let furthest: ReadCursor | null = null
  for (const uid of peers) {
    const cursor = positions[uid]
    if (cursor && (!furthest || compareReadCursor(cursor, furthest) > 0)) furthest = cursor
  }
  return furthest
}
