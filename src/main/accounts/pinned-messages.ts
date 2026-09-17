import type { ChatMessage, MessagePosition } from '../../shared/model'
import type { PinnedMessageItem, PinnedMessagesSnapshot } from '../../shared/pinned-messages'
import type { FirestoreReader } from '../network/firestore-rpc'
import { decodeMessage, documents, type FirestoreDocument, type ReadDialog } from '../network/firestore-values'
import type { MessageBookmarkCommand } from '../storage/message-bookmark-table'
import { tr } from '../../shared/i18n'

const labels: Partial<Record<ChatMessage['kind'], string>> = { image: tr('사진'), video: tr('동영상'), voice: tr('음성 메시지'), file: tr('파일'), sticker: tr('스티커'), location: tr('위치'), event: tr('이벤트'), channelPost: tr('게시물', [], 'kind') }
function preview(message: ChatMessage): string {
  return message.kind === 'text' ? message.text.replace(/\s+/g, ' ').slice(0, 200) : [labels[message.kind] || tr('메시지'), message.caption].filter(Boolean).join(' · ').slice(0, 200)
}
interface Owner {
  dialog: ReadDialog; reader: FirestoreReader; bookmarks: string[]
  signature: string; docs: Map<string, FirestoreDocument>; loaded: boolean; stop(): void
}

// HistoryView pinned bar for the open chat (iOS MorseChatRoomPinnedBanner): messages pinned for
// me first in pin order, then messages pinned for everyone. Only the pinned documents are watched,
// so a pin far back in history still has its preview and position.
export class PinnedMessages {
  private owner: Owner | null = null
  // "모두에게 고정" shows at once and until the chat document carries the change.
  private readonly expected = new Map<string, boolean>()
  constructor(private readonly signal: AbortSignal, private readonly store: <T>(command: MessageBookmarkCommand) => Promise<T>,
    private readonly changed: () => void) {}

  bind(dialog: ReadDialog, reader: FirestoreReader): void {
    this.clear()
    if (dialog.summary.kind === 'secret' || this.signal.aborted) return
    const owner: Owner = { dialog, reader, bookmarks: [], signature: '', docs: new Map(), loaded: false, stop: () => {} }
    this.owner = owner
    void this.store<string[]>({ kind: 'bookmarks-read', chatId: dialog.summary.id }).then(ids => {
      if (this.owner !== owner) return
      owner.bookmarks = ids; this.watch(owner); this.changed()
    }, () => {})
    this.watch(owner)
  }
  updateDialog(dialog: ReadDialog): void {
    const owner = this.owner
    if (!owner || owner.dialog.summary.id !== dialog.summary.id) return
    owner.dialog = dialog
    const shared = dialog.summary.pinnedForAll ?? []
    for (const [id, pinned] of this.expected) if (shared.includes(id) === pinned) this.expected.delete(id)
    this.watch(owner); this.changed()
  }
  clear(): void {
    this.owner?.stop()
    this.owner = null
    this.expected.clear()
  }
  private forAll(owner: Owner): string[] {
    const ids = (owner.dialog.summary.pinnedForAll ?? []).filter(id => this.expected.get(id) !== false)
    for (const [id, pinned] of this.expected) if (pinned && !ids.includes(id)) ids.push(id)
    return ids
  }
  private entries(owner: Owner): { id: string; forMe: boolean; forAll: boolean }[] {
    const shared = this.forAll(owner)
    return [...owner.bookmarks.map(id => ({ id, forMe: true, forAll: shared.includes(id) })),
      ...shared.filter(id => !owner.bookmarks.includes(id)).map(id => ({ id, forMe: false, forAll: true }))]
  }
  private watch(owner: Owner): void {
    const chatId = owner.dialog.summary.id
    const names = [...new Set(this.entries(owner).map(entry => `${documents}/chats/${chatId}/messages/${entry.id}`))].sort()
    const signature = names.join('\n')
    if (signature === owner.signature) return
    owner.stop(); owner.stop = () => {}; owner.signature = signature; owner.docs = new Map(); owner.loaded = !names.length
    if (!names.length) return
    owner.stop = owner.reader.watch({ documents: { documents: names } }, this.signal, {
      snapshot: rows => {
        if (this.owner !== owner || owner.signature !== signature) return
        owner.docs = new Map(rows); owner.loaded = true; this.changed()
      },
      state: state => {
        if (this.owner !== owner || owner.signature !== signature || state !== 'error') return
        owner.loaded = true; this.changed()
      }
    }, names.length, 4 * 1024 * 1024)
  }
  private items(owner: Owner): PinnedMessageItem[] {
    const chatId = owner.dialog.summary.id
    return this.entries(owner).map(entry => {
      const doc = owner.docs.get(`${documents}/chats/${chatId}/messages/${entry.id}`)
      let message: ChatMessage | null = null
      try { message = doc ? decodeMessage(doc, owner.dialog) : null } catch { message = null }
      const status: PinnedMessageItem['status'] = message && !message.system ? 'ready' : owner.loaded ? 'unavailable' : 'loading'
      return { ...entry, status, preview: status === 'ready' && !message!.encrypted ? preview(message!) : '', position: status === 'ready' ? { ...message!.position } : null }
    })
  }
  snapshot(chatId: string, limit: number): PinnedMessagesSnapshot | null {
    const owner = this.owner
    return owner && owner.dialog.summary.id === chatId ? { chatId, items: this.items(owner), limit } : null
  }
  // Pins that still count: a deleted or expired message leaves the bar, as on iOS.
  count(chatId: string): number {
    const owner = this.owner
    return owner && owner.dialog.summary.id === chatId ? this.items(owner).filter(item => item.status !== 'unavailable').length : 0
  }
  pinned(chatId: string, messageId: string): { forMe: boolean; forAll: boolean } | null {
    const owner = this.owner
    const entry = owner && owner.dialog.summary.id === chatId ? this.entries(owner).find(item => item.id === messageId) : undefined
    return entry ? { forMe: entry.forMe, forAll: entry.forAll } : null
  }
  position(chatId: string, messageId: string): MessagePosition | null {
    const owner = this.owner
    return owner && owner.dialog.summary.id === chatId ? this.items(owner).find(item => item.id === messageId)?.position ?? null : null
  }
  async setForMe(chatId: string, messageId: string, on: boolean): Promise<void> {
    const owner = this.owner
    if (!owner || owner.dialog.summary.id !== chatId) throw new Error(tr('대화를 다시 선택해 주세요.'))
    await this.store({ kind: 'bookmark-set', chatId, messageId, on })
    const ids = await this.store<string[]>({ kind: 'bookmarks-read', chatId })
    if (this.owner !== owner) return
    owner.bookmarks = ids; this.watch(owner); this.changed()
  }
  expectForAll(chatId: string, messageId: string, pinned: boolean): void {
    const owner = this.owner
    if (!owner || owner.dialog.summary.id !== chatId) return
    this.expected.set(messageId, pinned); this.watch(owner); this.changed()
  }
  forgetExpected(messageId: string): void {
    if (!this.expected.delete(messageId) || !this.owner) return
    this.watch(this.owner); this.changed()
  }
}
