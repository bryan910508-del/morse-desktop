import type { GroupPhotoImage } from '../../shared/group-photo'
import type { FirestoreReader, ReadCredentials } from '../network/firestore-rpc'
import { avatarDisplayLimits, ProfilePhoto } from './profile-photo'
import { photoToken, userpicCacheFor, userpicURL, type UserpicCache } from './userpic-cache'
import { peerProfilesFor, type PeerProfiles } from './peer-profiles'

export interface DirectAvatarSource { uid: string; reader: FirestoreReader; personalURL: string | null }
const idle = (): GroupPhotoImage => ({ status: 'idle', url: null, message: '' })

// One row of a person. Like Dialogs::Row it opens no read of its own: the account's peer data (PeerProfiles) says
// whether this person's picture may be shown and which one it is, and the picture itself comes from the shared store.
// Until that data has answered the row draws the picture the server last confirmed, as Telegram paints a cached
// userpic before its peer data is refreshed, and a photo the user chose for this contact on this device wins over it.
export class DirectAvatar {
  private closed = false
  private raw = ''
  private local: string | null = null
  private localToken = ''
  private photo: ProfilePhoto | null = null
  private started = false
  private readonly cache: UserpicCache | null
  private readonly peers: PeerProfiles | null
  constructor(private readonly binding: DirectAvatarSource, private readonly auth: ReadCredentials,
    private readonly source: () => DirectAvatarSource,
    private readonly localResponse: (url: string, request: Request) => Promise<Response>, private readonly changed: () => void,
    private readonly route: '__direct-avatar' | '__contact-avatar' = '__direct-avatar') {
    this.cache = userpicCacheFor(auth)
    this.peers = peerProfilesFor(auth)
    this.refresh()
  }
  matches(binding: DirectAvatarSource): boolean { return binding.uid === this.binding.uid && binding.reader === this.binding.reader }
  // The peer's current profile name (UserData::name), empty until the account's peer data carries it.
  get profileName(): string {
    try { this.current(); return this.peers?.name(this.binding.uid) ?? '' } catch { return '' }
  }
  private current(): DirectAvatarSource {
    this.auth.signal.throwIfAborted()
    const value = this.source()
    if (this.closed || !this.matches(value)) throw new Error('Current dialog/profile changed')
    return value
  }
  private get answered(): boolean { return this.peers?.hasAnswer(this.binding.uid) ?? false }
  // Whether anything of this person may be drawn: after the answer only a person this account may still see.
  private get allowed(): boolean { return this.answered ? Boolean(this.peers?.profile(this.binding.uid)) : true }
  // The picture this row draws now: the person's own after the answer, the last confirmed one before it.
  private get shownRaw(): string { return this.answered ? this.peers?.photo(this.binding.uid) ?? '' : this.cache?.known(`user:${this.binding.uid}`) ?? '' }

  refresh(): void {
    let local: string | null = null, raw = ''
    try { const value = this.current(); if (this.allowed) { local = value.personalURL; raw = local ? '' : this.shownRaw } } catch { /* Revoke below. */ }
    if (this.local === local && this.raw === raw) return
    // The same picture keeps its loaded bytes when the answer confirms it.
    if (this.raw !== raw || local) { this.photo?.clear(); this.photo = null; this.started = false }
    this.raw = raw; this.local = local; this.localToken = local ? photoToken('personal', local) : ''
    if (raw && !this.photo) {
      const photo = new ProfilePhoto(this.binding.uid, this.auth, this.changed, this.route, {
        ...avatarDisplayLimits,
        validate: () => {
          const current = this.current()
          if (!this.allowed || current.personalURL || this.photo !== photo || this.raw !== raw || this.shownRaw !== raw) throw new Error('Profile visibility changed')
        }
      })
      this.photo = photo
      // A picture already in memory is drawn at once, so a row coming back into view never loses it.
      if (photo.attach(raw)) this.started = true
    }
  }
  get snapshot(): GroupPhotoImage {
    try {
      const current = this.current()
      if (!this.allowed || current.personalURL !== this.local) return idle()
      if (this.local) return { status: 'ready', url: userpicURL(this.localToken), message: '' }
      const value = this.photo?.snapshot
      return value ? { ...value, status: value.status === 'none' ? 'idle' : value.status } : idle()
    } catch { return idle() }
  }
  takeLoad(): (() => Promise<void>) | null {
    const photo = this.photo, raw = this.raw
    if (!photo || this.started || this.closed) return null
    this.started = true
    return async () => { this.current(); if (this.photo === photo && this.raw === raw) await photo.select(raw) }
  }
  async response(token: string, request: Request): Promise<Response> {
    try {
      const current = this.current(), local = this.local
      if (!this.allowed || current.personalURL !== local || !['GET', 'HEAD'].includes(request.method)) throw new Error('Photo unavailable')
      if (!local) return this.photo?.response(token, request) ?? new Response(null, { status: 403 })
      if (token !== this.localToken) throw new Error('Photo expired')
      const result = await this.localResponse(local, request)
      if (!this.allowed || this.current().personalURL !== local || this.local !== local || this.localToken !== token) {
        await result.body?.cancel(); throw new Error('Photo changed during local read')
      }
      return result
    } catch { return new Response(null, { status: 403 }) }
  }
  close(): void { this.closed = true; this.photo?.clear(); this.photo = null; this.local = null; this.raw = '' }
}
