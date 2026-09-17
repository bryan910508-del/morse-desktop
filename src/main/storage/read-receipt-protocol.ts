import type { MessagePosition } from '../../shared/model'
import type { ReadCursor } from '../../shared/read-receipts'

export interface StoredReadReceipt {
  chatId: string
  observed: MessagePosition
  confirmed: ReadCursor | null
  pending: boolean
  reason: string
}
export interface ReadAuthority { chatId: string; cursor: ReadCursor | null; cutoff: MessagePosition | null }
export type ReadReceiptCommand =
  | { kind: 'read-list' }
  | { kind: 'read-enqueue'; chatId: string; target: MessagePosition }
  | { kind: 'read-confirm'; chatId: string; cursor: ReadCursor }
  | { kind: 'read-reject'; chatId: string; through: MessagePosition; reason: string }
  | { kind: 'read-sync'; authorities: ReadAuthority[] }

export interface ReadReceiptStore { <T>(command: ReadReceiptCommand): Promise<T> }
