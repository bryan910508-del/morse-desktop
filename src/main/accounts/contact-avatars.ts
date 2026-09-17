import type { GroupPhotoImage } from '../../shared/group-photo'
import { maxDialogAvatars } from '../../shared/dialog-avatars'
import type { ReadCredentials } from '../network/firestore-rpc'
import { DirectAvatar, type DirectAvatarSource } from './direct-avatar'
import { recordAvatarStep } from '../platform/avatar-diagnostics'
import { userpicURL } from './userpic-cache'

const retainedAvatars = 48
// Contact-list demand is independent of chat-list availability and selection.
export class ContactAvatars {
  private wanted: string[] = []
  private retained: string[] = []
  private entries = new Map<string, DirectAvatar>()
  private jobs = new Set<Promise<void>>()
  private closed = false
  constructor(private readonly uid: string, private readonly auth: ReadCredentials,
    private readonly source: (uid: string) => DirectAvatarSource,
    private readonly localResponse: (url: string, request: Request) => Promise<Response>, private readonly changed: () => void) {}
  snapshot(uid: string): GroupPhotoImage | null {
    try { this.source(uid); return this.entries.get(uid)?.snapshot ?? { status: 'idle', url: null, message: '' } }
    catch { return null }
  }
  setVisible(ids: string[]): void {
    if (this.closed) return
    this.wanted = [...new Set(ids)].slice(0, maxDialogAvatars)
    // Like Telegram's userpic cache, photos of rows that scrolled away stay ready for a while;
    // only rows on screen start new downloads.
    this.retained = [...this.wanted, ...this.retained.filter(id => !this.wanted.includes(id))].slice(0, retainedAvatars)
    this.prune(); this.changed()
  }
  prune(): void {
    if (this.closed) return
    const sources = new Map<string, DirectAvatarSource>()
    for (const uid of this.retained) { try { sources.set(uid, this.source(uid)) } catch (error) { recordAvatarStep('contacts', uid, 'source-unavailable', error instanceof Error ? error.message : '') } }
    for (const [uid, entry] of this.entries) {
      const binding = sources.get(uid)
      if (!binding || !entry.matches(binding)) { this.entries.delete(uid); entry.close() }
      else entry.refresh()
    }
    for (const [uid, binding] of sources) {
      if (!this.entries.has(uid)) this.entries.set(uid, new DirectAvatar(binding, this.auth, () => this.source(uid), this.localResponse,
        () => { if (!this.closed) { this.pump(); this.changed() } }, '__contact-avatar'))
    }
    this.pump()
  }
  private pump(): void {
    if (this.closed) return
    for (const uid of this.wanted) {
      if (this.jobs.size >= 2) break
      const load = this.entries.get(uid)?.takeLoad()
      if (!load) continue
      const task = Promise.resolve().then(load).catch(() => {}).finally(() => {
        this.jobs.delete(task)
        if (!this.closed) { this.pump(); this.changed() }
      })
      this.jobs.add(task)
    }
  }
  async response(token: string, request: Request): Promise<Response> {
    for (const entry of this.entries.values()) {
      if (entry.snapshot.url === userpicURL(token)) return entry.response(token, request)
    }
    return new Response(null, { status: 403 })
  }
  clear(): void {
    this.wanted = []; this.retained = []
    for (const entry of this.entries.values()) entry.close()
    this.entries.clear()
  }
  async close(): Promise<void> { this.closed = true; this.clear(); await Promise.allSettled(this.jobs) }
}
