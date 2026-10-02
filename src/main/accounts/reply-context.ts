import type { MessageKind, MessagePosition, ReplyPreview } from '../../shared/model'
import { decodeMessage, documents, expiry, historyLimit, pageSize, stringField, type FirestoreDocument, type ReadDialog } from '../network/firestore-values'
import type { FirestoreReader } from '../network/firestore-rpc'
import { tr } from '../../shared/i18n'
import { messageKindLabel } from '../../shared/message-kinds'

interface Original {
  position: MessagePosition
  senderId: string
  system: boolean
  kind: MessageKind
  text: string
  expiresAt: number | null
}
interface Group {
  ids: string[]
  state: 'loading' | 'ready' | 'error'
  originals: Map<string, Original>
  stop(): void
}

// Keep only a bounded excerpt and navigation/expiry metadata. Original media,
// nested reply chains and these excerpts never become history rows or read targets.
export function replyOriginal(doc: FirestoreDocument, dialog: ReadDialog): Original | null {
  const message = decodeMessage(doc, dialog)
  const storedChatId = stringField(doc.fields, 'chatId', 160)
  if (!message || message.encrypted || (storedChatId && storedChatId !== dialog.summary.id)) return null
  const label = message.kind === 'image' && (message.attachments?.length ?? 0) > 1 ? tr('사진 {0}장', [message.attachments!.length]) : messageKindLabel(message.kind)
  const detail = message.kind === 'file' ? message.attachments?.[0]?.name : message.caption
  const text = message.system ? tr('시스템 메시지') : message.kind === 'text' ? message.text : detail ? `${label} · ${detail}` : label
  return { position: message.position, senderId: message.senderId, system: message.system, kind: message.kind,
    text: text.replace(/\s+/g, ' ').trim().slice(0, 240) || tr('내용 없는 메시지'), expiresAt: expiry(doc) }
}
function visible(original: Original | null | undefined): original is Original {
  return Boolean(original && (original.expiresAt === null || original.expiresAt > Date.now()))
}
export function originalPreview(original: Original | null | undefined, dialog: ReadDialog): ReplyPreview {
  if (!visible(original)) return { state: 'unavailable' }
  const senderName = original.system ? tr('시스템') : original.senderId === dialog.accountUid ? tr('나') : dialog.participantNames[original.senderId] || tr('참여자')
  return { state: 'ready', senderName, kind: original.kind, text: original.text }
}

// Telegram R-58: a reply's original, once found, stays what the quote shows (HistoryItem keeps its replyTo item;
// «Loading...» only while it was never found). A target added beside the others starts only its own read, and a read
// that reconnects or starts over keeps what was found until it answers again; only its answer can change it.
export class ReplyContext {
  private groups: Group[] = []
  private byId = new Map<string, Group>()
  private known = new Map<string, Original>()

  constructor(private readonly dialog: ReadDialog, private readonly reader: FirestoreReader,
    private readonly signal: AbortSignal, private readonly changed: () => void) {}

  setTargets(ids: string[]): void {
    const wanted = new Set(ids)
    if (wanted.size > historyLimit) throw new Error('Reply target limit exceeded')
    this.groups = this.groups.filter(group => {
      if (group.ids.every(id => wanted.has(id))) return true
      group.stop(); for (const id of group.ids) this.byId.delete(id)
      return false
    })
    for (const id of [...this.known.keys()]) if (!wanted.has(id)) this.known.delete(id)
    const free = [...wanted].filter(id => !this.byId.has(id)).sort()
    for (let offset = 0; offset < free.length; offset += pageSize) this.watch(free.slice(offset, offset + pageSize))
  }
  private watch(groupIds: string[]): void {
    const names = groupIds.map(id => `${documents}/chats/${this.dialog.summary.id}/messages/${id}`)
    const allowed = new Set(names)
    const group: Group = { ids: groupIds, state: 'loading', originals: new Map(), stop: () => {} }
    this.groups.push(group)
    for (const id of groupIds) this.byId.set(id, group)
    const active = (): boolean => !this.signal.aborted && this.groups.includes(group)
    group.stop = this.reader.watch({ documents: { documents: names } }, this.signal, {
      snapshot: entries => {
        if (!active()) return
        const originals = new Map<string, Original>()
        try {
          for (const doc of entries.values()) {
            if (!allowed.has(doc.name)) throw new Error('Reply document scope mismatch')
            const original = replyOriginal(doc, this.dialog)
            if (original) originals.set(original.position.id, original)
          }
        } catch {
          group.stop(); group.originals.clear(); group.state = 'error'
          for (const id of group.ids) this.known.delete(id)
          this.changed(); return
        }
        // Absence at CURRENT is authoritative for this exact document set.
        group.originals = originals; group.state = 'ready'
        for (const id of group.ids) { const original = originals.get(id); if (original) this.known.set(id, original); else this.known.delete(id) }
        this.changed()
      },
      // The same documents are read again; what they said stays until they answer.
      reconnecting: () => {},
      state: (state, error) => {
        if (!active() || state === 'ready') return
        const next = state === 'error' || error ? 'error' : 'loading'
        if (group.state === next) return
        group.state = next; this.changed()
      },
    }, groupIds.length, 8 * 1024 * 1024)
  }
  preview(id: string): ReplyPreview {
    const group = this.byId.get(id)
    if (group?.state === 'ready') return originalPreview(group.originals.get(id), this.dialog)
    const known = this.known.get(id)
    return known ? originalPreview(known, this.dialog) : { state: group?.state ?? 'loading' }
  }
  target(id: string): MessagePosition | null {
    const group = this.byId.get(id), original = group?.state === 'ready' ? group.originals.get(id) : this.known.get(id)
    return visible(original) ? original.position : null
  }
  nextExpiry(): number | null {
    let next: number | null = null
    for (const original of this.known.values()) {
      const at = original.expiresAt
      if (at !== null && at > Date.now() && (next === null || at < next)) next = at
    }
    return next
  }
  clear(): void {
    for (const group of this.groups) { group.stop(); group.originals.clear() }
    this.groups = []; this.byId.clear(); this.known.clear()
  }
}
