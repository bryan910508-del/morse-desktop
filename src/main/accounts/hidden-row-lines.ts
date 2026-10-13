import type { DialogSummary, MessagePosition } from '../../shared/model'

// B327b: a row whose message was deleted for me takes the newest message left, as tdesktop's History does when its
// last item goes (History::requestChatListMessage, history.cpp:227-235; data_histories.cpp:1019-1030). The room
// document carries only its newest message, so the line comes from the open history when its newest page is read,
// else from one read of the room's newest messages for each (newest message, hidden count); until that read answers
// the row shows no line — never the message deleted for me.
export interface HiddenRowLine { preview: string; position: MessagePosition; fromMe: boolean; messageId: string }
export interface OpenRowLines { ready: boolean; newerAvailable: boolean; hasMore: boolean; count: number; line(index: number): HiddenRowLine }

export class HiddenRowLines {
  private readonly known = new Map<string, { key: string; line: HiddenRowLine | null }>()
  private readonly reading = new Set<string>()
  private readonly failed = new Map<string, { key: string; at: number }>()
  private closed = false

  constructor(private readonly hidden: { has(chatId: string, messageId: string): boolean; count(chatId: string): number },
    private readonly read: (chatId: string) => Promise<HiddenRowLine[]>, private readonly changed: () => void, private readonly now: () => number = Date.now) {}

  // In the list's rebuild, after the row has its line from the server and from this device's own deletions.
  apply(summary: DialogSummary, open: OpenRowLines | null): boolean {
    const top = summary.topMessageId
    if (this.closed || !top || !this.hidden.has(summary.id, top)) return false
    let line: HiddenRowLine | null | undefined
    if (open && open.ready && !open.newerAvailable) line = open.count > 0 ? open.line(open.count - 1) : open.hasMore ? undefined : null
    if (line === undefined) {
      const key = `${top}:${this.hidden.count(summary.id)}`, known = this.known.get(summary.id)
      if (known?.key === key) line = known.line
      else if (!this.reading.has(summary.id) && !this.waiting(summary.id, key)) void this.fetch(summary.id, key)
    }
    if (line) {
      summary.preview = line.preview
      summary.top = { ...line.position, id: summary.top?.id ?? summary.id }
      if (line.fromMe) summary.topFromMe = true; else delete summary.topFromMe
      summary.topMessageId = line.messageId
    } else {
      // Nothing left, or not known yet: no line. The row keeps its place (tdesktop leaves the chat where it was).
      summary.preview = ''
      delete summary.topFromMe
      delete summary.topMessageId
    }
    return true
  }
  close(): void { this.closed = true; this.known.clear(); this.failed.clear() }
  private waiting(chatId: string, key: string): boolean {
    const failed = this.failed.get(chatId)
    return failed?.key === key && this.now() - failed.at < 30000
  }
  private async fetch(chatId: string, key: string): Promise<void> {
    this.reading.add(chatId)
    try {
      const lines = await this.read(chatId)
      if (this.closed) return
      this.known.set(chatId, { key, line: lines.find(line => !this.hidden.has(chatId, line.messageId)) ?? null })
      this.changed()
    } catch { this.failed.set(chatId, { key, at: this.now() }) /* No line; asked again on a later change, 30 s on. */ }
    finally { this.reading.delete(chatId) }
  }
}
