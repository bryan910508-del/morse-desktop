import type { GroupPhotoImage } from '../../shared/group-photo'
import { FirestoreReader, type ReadCredentials } from '../network/firestore-rpc'
import { documents, type FirestoreDocument } from '../network/firestore-values'
import { ChannelImages } from './channel-images'

// A channel discussion group only keeps the picture address the server copied into it when the room
// was created (ensureDiscussionChat), and nothing updates that copy afterwards, so a channel that
// gained or changed its picture later leaves the chat list row blank. The row therefore falls back
// to the channel's own document, whose picture is public (storage.rules channel_photos).
const maxChannels = 48

export class DiscussionAvatars {
  private reader: FirestoreReader | null = null
  private docs = new Map<string, FirestoreDocument>()
  private wanted: string[] = []
  private loading = new Set<string>()
  private locked = false
  private closed = false
  private readonly photos: ChannelImages

  constructor(private readonly auth: ReadCredentials, private readonly changed: () => void) {
    this.photos = new ChannelImages(auth, id => {
      const doc = this.docs.get(id)
      if (!doc) throw new Error('Channel document not read yet')
      return doc
    }, () => { if (!this.closed) this.changed() })
  }

  // Called where the dialog list changes. Reading a snapshot must never reach this: ChannelImages
  // announces its own change, and a publish that asked for pictures would ask for another publish.
  setVisible(channelIds: string[]): void {
    if (this.closed || this.locked) return
    const ids = [...new Set(channelIds)].slice(0, maxChannels)
    if (ids.length !== this.wanted.length || ids.some((id, index) => id !== this.wanted[index])) {
      this.wanted = ids
      for (const id of [...this.docs.keys()]) if (!ids.includes(id)) this.docs.delete(id)
      this.photos.setVisible(ids.filter(id => this.docs.has(id)))
    }
    for (const id of ids) void this.read(id)
  }
  private async read(id: string): Promise<void> {
    if (this.closed || this.locked || this.docs.has(id) || this.loading.has(id) || !this.wanted.includes(id)) return
    this.loading.add(id)
    try {
      this.reader ??= new FirestoreReader(this.auth)
      const doc = await this.reader.getDocument(`${documents}/channels/${id}`, AbortSignal.any([this.auth.signal, AbortSignal.timeout(35000)]))
      if (this.closed || this.locked || !doc || !this.wanted.includes(id)) return
      this.docs.set(id, doc)
      this.photos.setVisible(this.wanted.filter(value => this.docs.has(value)))
      this.changed()
    } catch { /* Without the channel document the row keeps its initial letters. */ }
    finally { this.loading.delete(id) }
  }
  // The channel document last read for a discussion row, so the row can also be left from the list.
  document(channelId: string): FirestoreDocument | null {
    return this.closed || this.locked ? null : this.docs.get(channelId) ?? null
  }
  snapshot(channelId: string): GroupPhotoImage | null {
    if (this.closed || this.locked) return null
    try { return this.photos.snapshot(channelId) } catch { return null }
  }
  setLocked(locked: boolean): void {
    if (this.locked === locked) return
    this.locked = locked
    if (locked) this.pause()
  }
  pause(): void {
    this.wanted = []; this.docs.clear(); this.loading.clear()
    this.photos.clear()
    this.reader?.close(); this.reader = null
  }
  close(): void { this.closed = true; this.pause(); this.photos.close() }
  response(token: string, request: Request): Response { return this.photos.response(token, request) }
}
