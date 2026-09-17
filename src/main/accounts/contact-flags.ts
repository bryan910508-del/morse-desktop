import type { ContactFlagCommand } from '../storage/contact-flag-table'
import { tr } from '../../shared/i18n'

interface Flags { favorite: boolean; archived: boolean }

// This device's contact «즐겨찾기» / «보관», read once per session like ChatFlags.
export class ContactFlags {
  private readonly flags = new Map<string, Flags>()
  private readonly touched = new Set<string>()
  private state: 'unread' | 'reading' | 'read' = 'unread'
  private closed = false
  constructor(private readonly store: <T>(command: ContactFlagCommand) => Promise<T>, private readonly changed: () => void) {}
  load(): void {
    if (this.closed || this.state !== 'unread') return
    this.state = 'reading'
    this.store<({ uid: string } & Flags)[]>({ kind: 'contact-flags-read' }).then(rows => {
      if (this.closed) return
      if (!Array.isArray(rows)) throw new Error('Unreadable contact flags')
      for (const row of rows) if (!this.touched.has(row.uid)) this.flags.set(row.uid, { favorite: row.favorite, archived: row.archived })
      this.touched.clear(); this.state = 'read'
      if (rows.length) this.changed()
    }).catch(() => { if (!this.closed && this.state === 'reading') this.state = 'unread' })
  }
  get(uid: string): Flags { return this.flags.get(uid) ?? { favorite: false, archived: false } }
  async set(uid: string, patch: Partial<Flags>): Promise<void> {
    if (this.closed) throw new Error(tr('계정이 변경되었습니다.'))
    const before = this.flags.get(uid)
    if (this.state === 'reading') this.touched.add(uid)
    this.flags.set(uid, { favorite: patch.favorite ?? before?.favorite ?? false, archived: patch.archived ?? before?.archived ?? false })
    this.changed()
    try { await this.store({ kind: 'contact-flag-set', uid, ...patch }) }
    catch (error) { if (before) this.flags.set(uid, before); else this.flags.delete(uid); this.changed(); throw error }
  }
  close(): void { this.closed = true; this.flags.clear() }
}
