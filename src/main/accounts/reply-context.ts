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

export class ReplyContext {
  private groups: Group[] = []
  private byId = new Map<string, Group>()
  private signature = ''
  private generation = 0

  constructor(private readonly dialog: ReadDialog, private readonly reader: FirestoreReader,
    private readonly signal: AbortSignal, private readonly changed: () => void) {}

  setTargets(ids: string[]): void {
    const sorted = [...new Set(ids)].sort()
    if (sorted.length > historyLimit) throw new Error('Reply target limit exceeded')
    const signature = sorted.join('\n')
    if (signature === this.signature) return
    this.clear(); this.signature = signature
    const generation = this.generation
    for (let offset = 0; offset < sorted.length; offset += pageSize) {
      const groupIds = sorted.slice(offset, offset + pageSize)
      const names = groupIds.map(id => `${documents}/chats/${this.dialog.summary.id}/messages/${id}`)
      const allowed = new Set(names)
      const group: Group = { state: 'loading', originals: new Map(), stop: () => {} }
      this.groups.push(group)
      for (const id of groupIds) this.byId.set(id, group)
      const active = (): boolean => !this.signal.aborted && generation === this.generation
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
            group.stop(); group.originals.clear(); group.state = 'error'; this.changed(); return
          }
          // Absence at CURRENT is authoritative for this exact document set.
          group.originals = originals; group.state = 'ready'; this.changed()
        },
        state: (state, error) => {
          if (!active() || state === 'ready') return
          const next = state === 'error' || error ? 'error' : 'loading'
          const changed = group.state !== next || group.originals.size > 0
          group.originals.clear(); group.state = next
          if (changed) this.changed()
        },
      }, groupIds.length, 8 * 1024 * 1024)
    }
  }
  preview(id: string): ReplyPreview {
    const group = this.byId.get(id)
    return !group ? { state: 'loading' } : group.state !== 'ready' ? { state: group.state } : originalPreview(group.originals.get(id), this.dialog)
  }
  target(id: string): MessagePosition | null {
    const group = this.byId.get(id), original = group?.originals.get(id)
    return group?.state === 'ready' && visible(original) ? original.position : null
  }
  nextExpiry(): number | null {
    let next: number | null = null
    for (const group of this.groups) for (const original of group.originals.values()) {
      const at = original.expiresAt
      if (at !== null && at > Date.now() && (next === null || at < next)) next = at
    }
    return next
  }
  clear(): void {
    this.generation++
    for (const group of this.groups) { group.stop(); group.originals.clear() }
    this.groups = []; this.byId.clear(); this.signature = ''
  }
}
