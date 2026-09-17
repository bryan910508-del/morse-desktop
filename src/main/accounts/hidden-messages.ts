import type { HiddenMessageCommand } from '../storage/hidden-message-table'
import { tr } from '../../shared/i18n'

// Messages deleted for this person only. They are read from this device once per session; a message hidden
// while that read is on its way stays hidden, since the read only ever adds.
export class HiddenMessages {
  private readonly ids = new Map<string, Set<string>>()
  private state: 'unread' | 'reading' | 'read' = 'unread'
  private closed = false

  constructor(private readonly store: <T>(command: HiddenMessageCommand) => Promise<T>,
    private readonly arrived: () => void, private readonly now: () => number = Date.now) {}

  load(): void {
    if (this.closed || this.state !== 'unread') return
    this.state = 'reading'
    this.store<{ chatId: string; messageId: string }[]>({ kind: 'hidden-messages-read' }).then(rows => {
      if (this.closed) return
      if (!Array.isArray(rows)) throw new Error('Unreadable hidden messages')
      for (const row of rows) this.add(row.chatId, row.messageId)
      this.state = 'read'
      if (rows.length) this.arrived()
    }).catch(() => { if (!this.closed && this.state === 'reading') this.state = 'unread' })
  }
  has(chatId: string, messageId: string): boolean {
    return !this.closed && this.ids.get(chatId)?.has(messageId) === true
  }
  // Shown as gone at once; kept on this device before the promise settles.
  async hide(chatId: string, messageIds: string[]): Promise<void> {
    if (this.closed) throw new Error(tr('계정이 변경되었습니다.'))
    for (const id of messageIds) this.add(chatId, id)
    this.arrived()
    await this.store({ kind: 'hidden-messages-add', chatId, messageIds, at: this.now() })
  }
  close(): void { this.closed = true; this.ids.clear() }
  private add(chatId: string, messageId: string): void {
    let set = this.ids.get(chatId)
    if (!set) this.ids.set(chatId, set = new Set())
    set.add(messageId)
  }
}
