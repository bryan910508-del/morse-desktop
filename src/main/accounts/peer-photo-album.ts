import type { PeerPhotoCommand } from '../storage/peer-photo-table'
import { maxPeerPhotos } from '../storage/peer-photo-table'
import type { ReadCredentials } from '../network/firestore-rpc'
import { avatarDisplayLimits, ProfilePhoto } from './profile-photo'

type Store = <T>(command: PeerPhotoCommand) => Promise<T>

// Telegram opens a peer's picture from its profile and walks the peer's photo album with the arrows
// (UserPhotos / SharedMediaWithLastSlice). Morse's server keeps no album: what a person's pictures were is only
// what this device watched go by, so — as iOS does with ProfilePhotoHistory — every address seen for a person is
// remembered here, newest first, twenty of them, and those are the pictures the arrows walk.
export class PeerPhotoAlbum {
  private readonly seen = new Map<string, string>()
  private opened: { uid: string; addresses: string[]; index: number; photo: ProfilePhoto | null } | null = null
  private closed = false
  constructor(private readonly auth: ReadCredentials, private readonly store: Store, private readonly changed: () => void) {}

  // Every surface that learns a person's current picture says so; the same address twice is not written twice.
  remember(uid: string, raw: string): void {
    if (this.closed || !uid || !raw || raw.length > 10000) return
    if (this.seen.get(uid) === raw) return
    this.seen.set(uid, raw)
    void this.store({ kind: 'peer-photo-seen', uid, raw, at: Date.now() }).catch(() => {})
  }

  // The pictures of this person, newest first, with the one being shown now always at the front.
  async open(uid: string, current: string): Promise<{ count: number }> {
    if (this.closed) return { count: 0 }
    this.close()
    const stored = await this.store<string[]>({ kind: 'peer-photos-read', uid }).catch(() => [] as string[])
    if (this.closed) return { count: 0 }
    const addresses = [current, ...stored.filter(raw => raw !== current)].filter(Boolean).slice(0, maxPeerPhotos)
    this.opened = { uid, addresses, index: 0, photo: null }
    return { count: addresses.length }
  }
  // One picture at a time is held, as one selection is: moving away frees the one before it.
  async show(uid: string, index: number): Promise<{ url: string } | null> {
    const opened = this.opened
    if (this.closed || !opened || opened.uid !== uid || index < 0 || index >= opened.addresses.length) return null
    const raw = opened.addresses[index]!
    opened.index = index
    opened.photo?.clear()
    // Every picture keeps the one address of its own (userpicURL), so one already drawn is shown at once.
    const photo = new ProfilePhoto(uid, this.auth, () => this.changed(), '__profile-photo', {
      ...avatarDisplayLimits,
      validate: () => { if (this.closed || this.opened !== opened || opened.photo !== photo) throw new Error('Album closed') }
    })
    opened.photo = photo
    await photo.select(raw)
    if (this.closed || this.opened !== opened || opened.photo !== photo) return null
    const value = photo.snapshot
    if (value.status !== 'ready' || !value.url) {
      // A picture the server no longer has is not offered again.
      if (index > 0) { opened.addresses.splice(index, 1); void this.store({ kind: 'peer-photo-forget', uid, raw }).catch(() => {}) }
      return null
    }
    return { url: value.url }
  }
  response(token: string, request: Request): Response {
    return this.opened?.photo?.response(token, request) ?? new Response(null, { status: 403 })
  }
  get count(): number { return this.opened?.addresses.length ?? 0 }
  close(): void {
    this.opened?.photo?.clear()
    this.opened = null
  }
  dispose(): void { this.closed = true; this.close(); this.seen.clear() }
}
