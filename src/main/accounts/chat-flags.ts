import type { DialogSummary } from '../../shared/model'
import type { ChatFlagCommand } from '../storage/chat-flag-table'
import { tr } from '../../shared/i18n'

// category: the forum topic this device shows for a group (MorseGroupCategorySelection, selectedCategoryId_*).
interface Flags { muted: boolean; archived: boolean; category: string | null }

// This device's «알림 끄기» / «보관» per chat, read once per session. A change made while that read is on its
// way is newer than what the read brings, so it is kept.
export class ChatFlags {
  private readonly flags = new Map<string, Flags>()
  private readonly touched = new Set<string>()
  private state: 'unread' | 'reading' | 'read' = 'unread'
  private closed = false

  constructor(private readonly store: <T>(command: ChatFlagCommand) => Promise<T>, private readonly arrived: () => void) {}

  load(): void {
    if (this.closed || this.state !== 'unread') return
    this.state = 'reading'
    this.store<({ chatId: string } & Flags)[]>({ kind: 'chat-flags-read' }).then(rows => {
      if (this.closed) return
      if (!Array.isArray(rows)) throw new Error('Unreadable chat flags')
      for (const row of rows) if (!this.touched.has(row.chatId)) this.flags.set(row.chatId, { muted: row.muted, archived: row.archived, category: row.category ?? null })
      this.touched.clear()
      this.state = 'read'
      if (rows.length) this.arrived()
    }).catch(() => { if (!this.closed && this.state === 'reading') this.state = 'unread' })
  }
  // The room's shared isMuted / isArchived never count here; only what this device chose.
  apply(summary: DialogSummary): void {
    const flags = this.closed ? undefined : this.flags.get(summary.id)
    summary.muted = flags?.muted ?? false
    summary.archived = flags?.archived ?? false
    summary.forumSelected = summary.forum && flags?.category && summary.forum.categories.some(category => category.id === flags.category) ? flags.category : null
  }
  async set(chatId: string, patch: Partial<Flags>): Promise<void> {
    if (this.closed) throw new Error(tr('계정이 변경되었습니다.'))
    const before = this.flags.get(chatId)
    const next = { muted: patch.muted ?? before?.muted ?? false, archived: patch.archived ?? before?.archived ?? false, category: patch.category !== undefined ? patch.category : before?.category ?? null }
    if (this.state === 'reading') this.touched.add(chatId)
    this.flags.set(chatId, next)
    this.arrived()
    try { await this.store({ kind: 'chat-flag-set', chatId, ...patch }) }
    catch (error) {
      if (before) this.flags.set(chatId, before); else this.flags.delete(chatId)
      this.arrived()
      throw error
    }
  }
  // What this device currently holds for a chat (defaults when nothing was chosen).
  current(chatId: string): Flags {
    const flags = this.closed ? undefined : this.flags.get(chatId)
    return { muted: flags?.muted ?? false, archived: flags?.archived ?? false, category: flags?.category ?? null }
  }
  close(): void { this.closed = true; this.flags.clear() }
}
