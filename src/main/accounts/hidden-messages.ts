import type { HiddenMessageCommand, HiddenUpload } from '../storage/hidden-message-table'
import { maxHiddenMessagesPerCall, maxHiddenMessagesPerRoom } from '../storage/hidden-message-table'
import type { FirestoreDocument } from '../network/firestore-values'
import { documents, stringField } from '../network/firestore-values'
import { inquiryQueueChatId } from '../../shared/channel-inquiries'
import { identifier } from '../../shared/validation'
import { tr } from '../../shared/i18n'

// B327b: users/{uid}/hiddenMessages/{chat_<id>|inquiry_<id>} = { kind, roomId, ids: { <messageId>: <createdAtMs> } },
// the account's «나에게만 삭제» for its other devices (contract B327b §2-1), read here under this device's own keys —
// a chat by its id, an inquiry room by the key its messages already use (inquiryQueueChatId).
export function decodeHiddenMessages(rows: Iterable<FirestoreDocument>, uid: string): Map<string, Set<string>> {
  const prefix = `${documents}/users/${uid}/hiddenMessages/`, result = new Map<string, Set<string>>()
  for (const doc of rows) {
    try {
      if (!doc.name.startsWith(prefix)) continue
      const f = doc.fields ?? {}
      const kind = stringField(f, 'kind', 16), roomId = identifier(stringField(f, 'roomId', 160))
      if (kind !== 'chat' && kind !== 'inquiry') continue
      const ids = (f.ids as { mapValue?: { fields?: Record<string, unknown> } } | undefined)?.mapValue?.fields ?? {}
      const set = new Set<string>()
      for (const id of Object.keys(ids).slice(0, maxHiddenMessagesPerRoom)) { try { set.add(identifier(id)) } catch { /* not a message id */ } }
      if (set.size) result.set(kind === 'chat' ? roomId : inquiryQueueChatId(roomId), set)
    } catch { /* an unreadable document is left out */ }
  }
  return result
}

// Messages deleted for this person only. They are read from this device once per session; a message hidden
// while that read is on its way stays hidden, since the read only ever adds. The server's list only adds too.
export class HiddenMessages {
  private readonly ids = new Map<string, Map<string, HiddenUpload>>()
  private state: 'unread' | 'reading' | 'read' = 'unread'
  private closed = false

  constructor(private readonly store: <T>(command: HiddenMessageCommand) => Promise<T>,
    private readonly arrived: () => void, private readonly now: () => number = Date.now, private readonly loaded: () => void = () => {}) {}

  load(): void {
    if (this.closed || this.state !== 'unread') return
    this.state = 'reading'
    this.store<{ chatId: string; messageId: string; uploaded?: HiddenUpload }[]>({ kind: 'hidden-messages-read' }).then(rows => {
      if (this.closed) return
      if (!Array.isArray(rows)) throw new Error('Unreadable hidden messages')
      let added = false
      for (const row of rows) added = this.add(row.chatId, row.messageId, row.uploaded ?? 0) || added
      this.state = 'read'
      if (added) this.arrived()
      this.loaded()
    }).catch(() => { if (!this.closed && this.state === 'reading') this.state = 'unread' })
  }
  get read(): boolean { return this.state === 'read' && !this.closed }
  has(chatId: string, messageId: string): boolean {
    return !this.closed && this.ids.get(chatId)?.has(messageId) === true
  }
  // How many of a room's messages are hidden here: a room list line needs another look only where there are some.
  count(chatId: string): number { return this.closed ? 0 : this.ids.get(chatId)?.size ?? 0 }
  // Shown as gone at once; kept on this device before the promise settles. Not sent yet (the upload queue sends it).
  async hide(chatId: string, messageIds: string[]): Promise<void> {
    if (this.closed) throw new Error(tr('계정이 변경되었습니다.'))
    for (const id of messageIds) this.add(chatId, id, 0)
    this.arrived()
    await this.store({ kind: 'hidden-messages-add', chatId, messageIds, at: this.now() })
  }
  // B327b: the server's list, as users/{uid}/hiddenMessages last gave it. What this device did not have is hidden and
  // kept here; what it was still to send is known to the server already. Whether anything new is hidden.
  setServer(server: Map<string, Set<string>>): boolean {
    if (this.closed) return false
    let added = false
    for (const [chatId, ids] of server) {
      const known = this.ids.get(chatId), merge: string[] = []
      for (const id of ids) {
        const state = known?.get(id)
        if (state === 1 || state === 2) continue
        if (state === undefined) added = true
        this.add(chatId, id, 1)
        merge.push(id)
      }
      for (let offset = 0; offset < merge.length; offset += maxHiddenMessagesPerRoom)
        void this.store({ kind: 'hidden-messages-merge', chatId, messageIds: merge.slice(offset, offset + maxHiddenMessagesPerRoom), at: this.now() }).catch(() => {})
    }
    if (added) this.arrived()
    return added
  }
  // Those not sent yet, a room's at most 100 at a time (hideMorseMessagesForMe takes 1–100), the most recently hidden
  // first (contract B327b §6: all of them, newest first).
  pending(): { chatId: string; messageIds: string[] }[] {
    if (this.closed) return []
    return [...this.ids].flatMap(([chatId, ids]) => {
      const waiting = [...ids].flatMap(([id, state]) => state === 0 ? [id] : []).reverse()
      const batches: { chatId: string; messageIds: string[] }[] = []
      for (let offset = 0; offset < waiting.length; offset += maxHiddenMessagesPerCall) batches.push({ chatId, messageIds: waiting.slice(offset, offset + maxHiddenMessagesPerCall) })
      return batches
    })
  }
  async settle(chatId: string, messageIds: string[], state: 1 | 2): Promise<void> {
    if (this.closed) return
    const known = this.ids.get(chatId)
    for (const id of messageIds) if (known?.get(id) === 0) known.set(id, state)
    await this.store({ kind: 'hidden-messages-uploaded', chatId, messageIds, state })
  }
  close(): void { this.closed = true; this.ids.clear() }
  private add(chatId: string, messageId: string, state: HiddenUpload): boolean {
    let map = this.ids.get(chatId)
    if (!map) this.ids.set(chatId, map = new Map())
    const known = map.get(messageId)
    if (known === undefined || (known === 0 && state !== 0)) map.set(messageId, state)
    return known === undefined
  }
}
