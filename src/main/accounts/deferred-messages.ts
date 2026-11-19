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

// N-36 §1-3 (contracts/N-36-scheduled-messages-list.md): a queued message this device is still sending, or whose result it
// does not know. iOS keeps these in MorseDeferredOutgoingCoordinator (preparing · submitting · unknown), Android in its
// store (AccountDeferredMessages); here they live in memory only — the composer keeps the text until the server takes it
// (compose.tsx sendLater), so nothing typed is lost when the app quits. Once the server's queue holds the document, that
// row is shown instead. «unknown» may be sent again under the same id; a definite failure on a second try is «failed».
export type LocalDeferredState = 'submitting' | 'unknown' | 'failed' | 'rejected'
export interface LocalDeferred { chatId: string; kind: DeferredKind; id: string; text: string; scheduledAt: number | null; fields: Record<string, DeferredWireValue>; state: LocalDeferredState; cancelled?: boolean }
// What a second try learns before it writes (Android AccountDeferredMessages.process: the queue, then the outcome).
export interface DeferredCheck { queued(): Promise<boolean>; outcome(): Promise<'sent' | 'rejected' | null>; create(): Promise<void>; remove(): Promise<void> }
const writeCode = (error: unknown): { uncertain: boolean; code: number } => {
  const value = error as { uncertain?: unknown; code?: unknown }
  return { uncertain: value?.uncertain === true, code: typeof value?.code === 'number' ? value.code : 0 }
}
const failedPrecondition = 9

// MorseChatRoomScreenIngressSession deferred listeners: this account's queued messages for the
// open chat (chatId == chat, senderId == me). A queued document disappears once the server sends it.
export class DeferredMessages {
  private owner: Owner | null = null
  private readonly local = new Map<string, LocalDeferred>()
  constructor(private readonly uid: string, private readonly signal: AbortSignal, private readonly changed: () => void) {}

  // An inquiry room has only a scheduled queue: its participants do not see each other's presence,
  // so «온라인시 보내기» does not exist there (talky-scheduled-online-messages: inquiryAligned).
  bind(chatId: string, reader: FirestoreReader, kinds: readonly DeferredKind[] = ['scheduled', 'online']): void {
    this.clear()
    const owner: Owner = { chatId, rows: { scheduled: new Map(), online: new Map() }, stops: [] }
    this.owner = owner
    const equal = (field: string, value: string) => ({ fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: value } } })
    for (const kind of kinds) {
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
        // A queue document the server marked failed cannot be sent again under its id (the server wrote its outcome, and
        // the rules refuse a second create — firestore.rules hasDeferredTerminalOutcome); it can only be taken away.
        items.push({ id, kind, text: stringField(f, 'text', 30000), scheduledAt, status: status === 'failed' ? 'failed' : 'waiting', retry: false })
      } catch { /* An unreadable queue document is left out. */ }
    }
    const queued = new Set(items.map(item => `${item.kind}:${item.id}`))
    for (const entry of this.local.values()) {
      if (entry.chatId !== owner.chatId || entry.cancelled || queued.has(`${entry.kind}:${entry.id}`)) continue
      items.push({ id: entry.id, kind: entry.kind, text: entry.text, scheduledAt: entry.scheduledAt,
        status: entry.state === 'failed' || entry.state === 'rejected' ? 'failed' : 'checking', retry: entry.state === 'unknown' || entry.state === 'failed' })
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
  // Whether the server's queue holds it (then cancelling deletes that document).
  queued(chatId: string, kind: DeferredKind, messageId: string): boolean {
    const owner = this.owner
    return Boolean(owner && owner.chatId === chatId && owner.rows[kind].has(`${documents}/${deferredCollections[kind]}/${messageId}`))
  }
  localEntry(chatId: string, kind: DeferredKind, messageId: string): LocalDeferred | null {
    const entry = this.local.get(`${kind}:${messageId}`)
    return entry && entry.chatId === chatId && !entry.cancelled ? entry : null
  }
  // The send from the composer: «확인 중» while it is on its way; gone once the server answers, kept as «unknown» when the
  // answer is lost. The error goes back to the composer, which keeps the text.
  async submit(entry: Omit<LocalDeferred, 'state'>, create: () => Promise<void>, remove: () => Promise<void>): Promise<void> {
    const key = `${entry.kind}:${entry.id}`, record: LocalDeferred = { ...entry, state: 'submitting' }
    this.local.set(key, record); this.changed()
    try {
      await create()
      this.forget(key, record)
      if (record.cancelled) await remove().catch(() => {})
    } catch (error) {
      if (record.cancelled) { this.forget(key, record); await remove().catch(() => {}) }
      else if (writeCode(error).uncertain) { record.state = 'unknown'; this.changed() }
      else this.forget(key, record)
      throw error
    }
  }
  // «다시 시도» (N-36 §1-4, the same id): already queued or already settled by the server → nothing is written again.
  async retry(chatId: string, kind: DeferredKind, messageId: string, check: DeferredCheck): Promise<void> {
    const key = `${kind}:${messageId}`, record = this.localEntry(chatId, kind, messageId)
    if (!record || (record.state !== 'unknown' && record.state !== 'failed')) throw new Error('not retryable')
    record.state = 'submitting'; this.changed()
    try {
      if (await check.queued()) { this.forget(key, record); return }
      const outcome = await check.outcome()
      if (outcome === 'sent') { this.forget(key, record); return }
      if (outcome === 'rejected') { record.state = 'rejected'; this.changed(); return }
      await check.create()
      this.forget(key, record)
    } catch (error) {
      const failure = writeCode(error)
      // exists=false refused: the first try did land.
      if (failure.code === failedPrecondition) { this.forget(key, record); return }
      if (this.local.get(key) === record) { record.state = failure.uncertain || !failure.code ? 'unknown' : 'failed'; this.changed() }
      throw error
    }
    // Cancelled while it was being tried: whatever landed is taken away again.
    finally { if (record.cancelled) { this.forget(key, record); await check.remove().catch(() => {}) } }
  }
  // «취소» of a row the server does not show: one still on its way is removed once it lands; one whose result is unknown
  // is deleted if it is there. The row leaves at once.
  async cancelLocal(chatId: string, kind: DeferredKind, messageId: string, remove: () => Promise<void>): Promise<void> {
    const key = `${kind}:${messageId}`, record = this.localEntry(chatId, kind, messageId)
    if (!record) throw new Error('not local')
    record.cancelled = true
    if (record.state === 'submitting') { this.changed(); return }
    try { await remove() } catch (error) { if (writeCode(error).code !== failedPrecondition && writeCode(error).code !== 5) { record.cancelled = false; this.changed(); throw error } }
    this.forget(key, record)
  }
  private forget(key: string, record: LocalDeferred): void { if (this.local.get(key) === record) { this.local.delete(key); this.changed() } }
}
