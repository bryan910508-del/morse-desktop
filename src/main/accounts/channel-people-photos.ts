import type { GroupPhotoImage } from '../../shared/group-photo'
import type { ReadCredentials } from '../network/firestore-rpc'
import { avatarDisplayLimits, ProfilePhoto } from './profile-photo'
import { userpicURL } from './userpic-cache'

export type PeoplePhotoResolver = (uid: string, raw: string | null) => GroupPhotoImage | null
interface Entry { photo: ProfilePhoto; raw: string; started: boolean }
const retainedPhotos = 96

// Photos of people on channel screens (subscribers, administrators, comment authors, inquiries).
// Telegram shows every member's userpic there, and iOS draws them from the photo address the
// channel record keeps (AvatarView photoURL). Profile photos are readable by any signed-in user
// in storage.rules, so no contact relationship is needed. Recently shown photos stay cached.
export class ChannelPeoplePhotos {
  private readonly entries = new Map<string, Entry>()
  private readonly jobs = new Set<Promise<void>>()
  private scheduled = false
  private closed = false
  constructor(private readonly auth: ReadCredentials, private readonly changed: () => void) {}

  image(uid: string, raw: string | null): GroupPhotoImage | null {
    if (this.closed || !uid || !raw) return null
    const key = `${uid}\n${raw}`
    let entry = this.entries.get(key)
    if (entry) { this.entries.delete(key); this.entries.set(key, entry) }
    else {
      const photo: ProfilePhoto = new ProfilePhoto(uid, this.auth, () => { if (!this.closed) this.changed() }, '__channel-person', {
        ...avatarDisplayLimits, validate: () => { if (this.closed || !this.entries.has(key) || this.entries.get(key)!.photo !== photo) throw new Error('Photo no longer shown') }
      })
      // A picture already in memory is drawn at once when a channel screen shows this person again.
      entry = { photo, raw, started: photo.attach(raw) }
      this.entries.set(key, entry)
      while (this.entries.size > retainedPhotos) {
        const [oldest, old] = this.entries.entries().next().value!
        this.entries.delete(oldest); old.photo.clear()
      }
      this.schedule()
    }
    const value = entry.photo.snapshot
    return { status: value.status === 'none' ? 'idle' : value.status, url: value.url, message: '' }
  }
  // Snapshots ask for photos while they are built; downloads start right after, two at a time.
  private schedule(): void {
    if (this.scheduled || this.closed) return
    this.scheduled = true
    queueMicrotask(() => { this.scheduled = false; this.pump() })
  }
  private pump(): void {
    if (this.closed) return
    for (const entry of [...this.entries.values()].reverse()) {
      if (this.jobs.size >= 2) break
      if (entry.started) continue
      entry.started = true
      const task = entry.photo.select(entry.raw).catch(() => {}).finally(() => {
        this.jobs.delete(task)
        if (!this.closed) { this.pump(); this.changed() }
      })
      this.jobs.add(task)
    }
  }
  response(token: string, request: Request): Response {
    for (const entry of this.entries.values()) {
      if (entry.photo.snapshot.url === userpicURL(token)) return entry.photo.response(token, request)
    }
    return new Response(null, { status: 403 })
  }
  clear(): void {
    for (const entry of this.entries.values()) entry.photo.clear()
    this.entries.clear()
  }
  async close(): Promise<void> { this.closed = true; this.clear(); await Promise.allSettled(this.jobs) }
}
