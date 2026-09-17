import type { DeferredItem, DeferredKind, DeferredMessagesSnapshot, DeferredSendRequest } from '../../shared/deferred-send'
import { positionMilliseconds } from '../../shared/model'
import type { FirestoreReader } from '../network/firestore-rpc'
import { documents, stringField, timestamp, type FirestoreDocument } from '../network/firestore-values'

export const deferredCollections: Record<DeferredKind, 'scheduledMessages' | 'pendingOnlineMessages'> = { scheduled: 'scheduledMessages', online: 'pendingOnlineMessages' }
export type DeferredWireValue = { stringValue: string } | { booleanValue: boolean } | { timestampValue: { seconds: string; nanos: number } }

// MorseDeferredOutgoingRequest.payload, text only. A Timestamp travels over gRPC as seconds and
// nanos like every other write here (positionValue); a test covers what the queue time serializes to.
export function deferredFields(request: DeferredSendRequest, senderUid: string, text: string, recipientId: string): Record<string, DeferredWireValue> {
  const fields: Record<string, DeferredWireValue> = {
    messageId: { stringValue: request.messageId }, chatId: { stringValue: request.chatId }, senderId: { stringValue: senderUid }, text: { stringValue: text },
    type: { stringValue: 'text' }, isSilent: { booleanValue: request.silent }, isEncrypted: { booleanValue: false }, status: { stringValue: 'pending' } }
  if (request.kind === 'scheduled' && request.scheduledAt !== null)
    fields.scheduledAt = { timestampValue: { seconds: String(Math.floor(request.scheduledAt / 1000)), nanos: request.scheduledAt % 1000 * 1000000 } }
  if (recipientId) fields.recipientId = { stringValue: recipientId }
  if (request.reply) fields.replyToId = { stringValue: request.reply.messageId }
  return fields
}
interface Owner { chatId: string; rows: Record<DeferredKind, Map<string, FirestoreDocument>>; stops: (() => void)[] }

// MorseChatRoomScreenIngressSession deferred listeners: this account's queued messages for the
// open chat (chatId == chat, senderId == me). A queued document disappears once the server sends it.
export class DeferredMessages {
  private owner: Owner | null = null
  constructor(private readonly uid: string, private readonly signal: AbortSignal, private readonly changed: () => void) {}

  bind(chatId: string, reader: FirestoreReader): void {
    this.clear()
    const owner: Owner = { chatId, rows: { scheduled: new Map(), online: new Map() }, stops: [] }
    this.owner = owner
    const equal = (field: string, value: string) => ({ fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: value } } })
    for (const kind of ['scheduled', 'online'] as const) {
      owner.stops.push(reader.watch({ query: { parent: documents, structuredQuery: { from: [{ collectionId: deferredCollections[kind] }],
        where: { compositeFilter: { op: 'AND', filters: [equal('chatId', chatId), equal('senderId', this.uid)] } } } } }, this.signal, {
        snapshot: rows => { if (this.owner !== owner) return; owner.rows[kind] = new Map(rows); this.changed() },
        state: () => {}
      }, 100, 4 * 1024 * 1024))
    }
  }
  clear(): void {
    for (const stop of this.owner?.stops ?? []) stop()
    this.owner = null
  }
  private items(owner: Owner): DeferredItem[] {
    const items: DeferredItem[] = []
    for (const kind of ['scheduled', 'online'] as const) for (const doc of owner.rows[kind].values()) {
      try {
        const f = doc.fields, id = doc.name.slice(doc.name.lastIndexOf('/') + 1), status = stringField(f, 'status', 32)
        if (stringField(f, 'senderId', 160) !== this.uid || stringField(f, 'chatId', 160) !== owner.chatId || (status !== 'pending' && status !== 'failed')) continue
        let scheduledAt: number | null = null
        try { if (f.scheduledAt?.timestampValue) scheduledAt = positionMilliseconds(timestamp(f.scheduledAt.timestampValue, id)) } catch { /* Unknown time stays unknown. */ }
        items.push({ id, kind, text: stringField(f, 'text', 30000), scheduledAt, failed: status === 'failed' })
      } catch { /* An unreadable queue document is left out. */ }
    }
    return items.sort((a, b) => (a.scheduledAt ?? Number.MAX_SAFE_INTEGER) - (b.scheduledAt ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id))
  }
  snapshot(chatId: string): DeferredMessagesSnapshot | null {
    const owner = this.owner
    return owner && owner.chatId === chatId ? { chatId, items: this.items(owner) } : null
  }
  has(chatId: string, kind: DeferredKind, messageId: string): boolean {
    const owner = this.owner
    return Boolean(owner && owner.chatId === chatId && this.items(owner).some(item => item.kind === kind && item.id === messageId))
  }
}
