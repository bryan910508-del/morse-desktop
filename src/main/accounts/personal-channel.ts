import type { OwnedChannelList, PersonalChannelCard, PersonalChannelCardRequest, PersonalChannelLink, PersonalChannelPost, PersonalChannelsSnapshot } from '../../shared/personal-channel'
import { comparePosition, positionMilliseconds, type MessagePosition } from '../../shared/model'
import { DocumentWriteFailure, FirestoreReader, type ReadCredentials } from '../network/firestore-rpc'
import { documents, stringField, timestamp, type FirestoreDocument, type WireObject } from '../network/firestore-values'
import { ChannelImages } from './channel-images'
import { decodeChannelSummary } from './channels'
import { tr } from '../../shared/i18n'

// users/{uid}.personalChannelId (iOS MorsePersonalChannel.fieldKey). Its owner writes it to their own user document
// in one plain commit, and taking the link away deletes the field. firestore.rules `match /users/{userId}` keeps no
// list of allowed fields, so no rule names it. Others read it from the person's public profile (A7 §3-1), where the
// server copies it only while that channel's owner is the person.
export const personalChannelField = 'personalChannelId'

// The id as the clients write it, or '' for anything else: a malformed value must not cost the whole profile.
export function personalChannelIdField(fields: Record<string, WireObject>): string {
  const raw = fields[personalChannelField]?.stringValue
  const value = typeof raw === 'string' ? raw.trim() : ''
  return /^[A-Za-z0-9_-]{1,160}$/.test(value) ? value : ''
}

// The line under the channel's name (MorsePersonalChannel.previewText): the post's text, or what its first media is.
export function personalChannelPost(doc: FirestoreDocument): PersonalChannelPost | null {
  try {
    const f = doc.fields
    const time = positionMilliseconds(timestamp(f.createdAt?.timestampValue, doc.name))
    const text = Array.from(stringField(f, 'text', 100000).trim()).slice(0, 500).join('')
    const types = (f.mediaTypes?.arrayValue as { values?: unknown } | undefined)?.values
    const first = Array.isArray(types) ? (types[0] as { stringValue?: unknown } | undefined)?.stringValue : undefined
    return { text, kind: first === 'image' || first === 'video' ? first : null, time }
  } catch { return null }
}

interface Row { id: string; name: string; subscriberCount: number }
// A channel `ownerUid` owns now, or null: a profile shows its channel only while the person still owns it
// (MorsePersonalChannel.loadDisplay), and the chooser offers only the account's own.
function ownedRow(doc: FirestoreDocument, ownerUid: string): (Row & { updated: MessagePosition | null }) | null {
  try {
    const channel = decodeChannelSummary(doc, ownerUid, false)
    return channel.owned ? { id: channel.id, name: channel.name, subscriberCount: channel.subscriberCount ?? 0, updated: channel.updated } : null
  } catch { return null }
}

interface Card { request: PersonalChannelCardRequest; status: PersonalChannelCard['status']; doc: FirestoreDocument | null; row: Row | null; post: PersonalChannelPost | null; abort: AbortController | null }
interface Owned { requestId: string; status: OwnedChannelList['status']; docs: FirestoreDocument[]; rows: Row[]; abort: AbortController | null }
// Profiles open at once: my own in settings and a contact's in the side panel.
const maxCards = 4
// iOS reads up to 100 (MorsePersonalChannel.ownedChannels); FirestoreReader.query refuses an answer of more than 80
// documents, and the apps let an account own one channel.
const maxOwned = 80

// A profile's personal channel and the chooser's list. Each surface holds its own handle for as long as it is on
// screen (Telegram reads a person's channel with their full profile, users.getFullUser); both are read once when
// opened, as iOS reads them when the screen appears, and read again after a lock or a lost connection.
export class PersonalChannels {
  readonly avatars: ChannelImages
  private cards: Card[] = []
  private owned: Owned | null = null
  private writing: Promise<unknown> = Promise.resolve()
  private locked = false
  private closed = false
  constructor(private readonly uid: string, private readonly auth: ReadCredentials, private readonly changed: () => void) {
    this.avatars = new ChannelImages(auth, id => this.document(id), () => this.publish())
  }
  private publish(): void { if (!this.closed) this.changed() }
  // The channel document a card or the chooser read, for the channel's picture (channel_photos are public reads).
  private document(id: string): FirestoreDocument {
    const path = `${documents}/channels/${id}`
    const doc = this.cards.find(card => card.status === 'ready' && card.doc?.name === path)?.doc
      ?? (this.owned?.status === 'ready' ? this.owned.docs.find(item => item.name === path) : undefined)
    if (this.closed || this.locked || !doc) throw new Error('Channel not on a profile')
    return doc
  }
  // Read by every publish, so it only reads.
  get snapshot(): PersonalChannelsSnapshot | null {
    if (this.closed || this.locked) return null
    const summary = (row: Row) => ({ ...row, avatar: this.avatars.snapshot(row.id) })
    return {
      cards: this.cards.map(card => ({ ...card.request, status: card.status, channel: card.status === 'ready' && card.row ? summary(card.row) : null, post: card.status === 'ready' ? card.post : null })),
      owned: this.owned ? { requestId: this.owned.requestId, status: this.owned.status, channels: this.owned.status === 'ready' ? this.owned.rows.map(summary) : [] } : null
    }
  }

  openCard(request: PersonalChannelCardRequest): void {
    if (this.closed) return
    for (const card of this.cards) if (card.request.requestId === request.requestId) card.abort?.abort()
    const card: Card = { request, status: 'loading', doc: null, row: null, post: null, abort: null }
    const kept = [...this.cards.filter(item => item.request.requestId !== request.requestId), card]
    for (const dropped of kept.slice(0, -maxCards)) dropped.abort?.abort()
    this.cards = kept.slice(-maxCards)
    this.load(card)
    this.avatars.prune(); this.publish()
  }
  closeCard(requestId: string): void {
    const card = this.cards.find(item => item.request.requestId === requestId)
    if (!card) return
    card.abort?.abort()
    this.cards = this.cards.filter(item => item !== card)
    this.avatars.prune(); this.publish()
  }
  openOwned(requestId: string): void {
    if (this.closed) return
    this.owned?.abort?.abort()
    this.owned = { requestId, status: 'loading', docs: [], rows: [], abort: null }
    this.loadOwned(this.owned)
    this.avatars.prune(); this.publish()
  }
  closeOwned(requestId: string): void {
    if (this.owned?.requestId !== requestId) return
    this.owned.abort?.abort(); this.owned = null
    this.avatars.prune(); this.publish()
  }

  // The linked channel, shown only while its owner is the profile's person, and its newest post. The posts are asked
  // for as iOS asks (ChannelService.loadPosts: newest first, no filter), which the rules answer for the channel's
  // owner, subscribers and admins; anyone else gets the channel without a post line.
  private load(card: Card): void {
    if (this.closed || this.locked) return
    card.abort?.abort()
    const abort = new AbortController()
    card.abort = abort; card.status = 'loading'; card.doc = null; card.row = null; card.post = null
    const signal = AbortSignal.any([abort.signal, this.auth.signal, AbortSignal.timeout(40000)])
    const current = (): boolean => !this.closed && !this.locked && card.abort === abort && this.cards.includes(card)
    void (async () => {
      let reader: FirestoreReader | null = null
      try {
        reader = new FirestoreReader(this.auth)
        const doc = await reader.getDocument(`${documents}/channels/${card.request.channelId}`, signal)
        const row = doc ? ownedRow(doc, card.request.profileUid) : null
        let post: PersonalChannelPost | null = null
        if (doc && row) {
          try {
            const posts = await reader.query(doc.name, { from: [{ collectionId: 'posts' }],
              orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }], limit: { value: 1 } }, signal)
            post = posts[0] ? personalChannelPost(posts[0]) : null
          } catch (error) { if (signal.aborted) throw error }
        }
        if (!current()) return
        if (doc && row) { card.doc = doc; card.row = row; card.post = post; card.status = 'ready' }
        else card.status = 'hidden'
      } catch { if (current()) card.status = 'error' }
      finally {
        reader?.close()
        if (card.abort === abort) {
          card.abort = null
          if (!this.closed && !this.locked && this.cards.includes(card)) { this.avatars.prune(); this.publish() }
        }
      }
    })()
  }
  // MorsePersonalChannel.ownedChannels: channels whose ownerId is this account, public or private, newest activity
  // (lastPostAt, else createdAt) first — the owner query of ChannelsSession, read once for the chooser.
  private loadOwned(owned: Owned): void {
    if (this.closed || this.locked) return
    owned.abort?.abort()
    const abort = new AbortController()
    owned.abort = abort; owned.status = 'loading'; owned.docs = []; owned.rows = []
    const signal = AbortSignal.any([abort.signal, this.auth.signal, AbortSignal.timeout(40000)])
    const current = (): boolean => !this.closed && !this.locked && owned.abort === abort && this.owned === owned
    void (async () => {
      let reader: FirestoreReader | null = null
      try {
        reader = new FirestoreReader(this.auth)
        const docs = await reader.query(documents, { from: [{ collectionId: 'channels' }],
          where: { fieldFilter: { field: { fieldPath: 'ownerId' }, op: 'EQUAL', value: { stringValue: this.uid } } }, limit: { value: maxOwned } }, signal)
        if (!current()) return
        const rows = docs.flatMap(doc => { const row = ownedRow(doc, this.uid); return row ? [{ doc, row }] : [] })
          .sort((a, b) => a.row.updated && b.row.updated ? comparePosition(b.row.updated, a.row.updated) : a.row.updated ? -1 : b.row.updated ? 1 : 0)
        owned.docs = rows.map(item => item.doc)
        owned.rows = rows.map(({ row: { id, name, subscriberCount } }) => ({ id, name, subscriberCount }))
        owned.status = 'ready'
      } catch { if (current()) owned.status = 'error' }
      finally {
        reader?.close()
        if (owned.abort === abort) {
          owned.abort = null
          if (!this.closed && !this.locked && this.owned === owned) { this.avatars.prune(); this.publish() }
        }
      }
    })()
  }
  // What a lock or a lost connection left unread is read again for the surfaces still open.
  resume(): void {
    if (this.closed || this.locked) return
    let reading = false
    for (const card of this.cards) if (!card.abort && (card.status === 'error' || card.status === 'loading')) { this.load(card); reading = true }
    if (this.owned && !this.owned.abort && (this.owned.status === 'error' || this.owned.status === 'loading')) { this.loadOwned(this.owned); reading = true }
    if (reading) this.publish()
  }
  // A locked screen forgets what it read and reads nothing; the open surfaces are read again when it opens.
  setLocked(locked: boolean): void {
    if (this.locked === locked) return
    this.locked = locked
    if (locked) {
      for (const card of this.cards) { card.abort?.abort(); card.abort = null; card.status = 'loading'; card.doc = null; card.row = null; card.post = null }
      if (this.owned) { this.owned.abort?.abort(); this.owned.abort = null; this.owned.status = 'loading'; this.owned.docs = []; this.owned.rows = [] }
      this.avatars.clear(); this.publish()
    } else this.resume()
  }

  // MorsePersonalChannel.setLinkedChannelId, written the way AuthService.updateProfile writes it: the field alone
  // (updateMask), on a document that exists, in one commit — never a transaction, which this project refuses.
  // Taking the link away names the field with no value, which deletes it. The picks go out one at a time, so the
  // last one chosen is the one that stays.
  async save(link: PersonalChannelLink): Promise<'done' | 'unconfirmed'> {
    if (this.closed || this.locked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    // The chooser offers only this account's channels (Telegram's server accepts only its own list, for_personal).
    if (link.channelId !== null && !(this.owned?.status === 'ready' && this.owned.rows.some(row => row.id === link.channelId))) throw new Error(tr('현재 내 채널 목록에서 채널을 확인해 주세요.'))
    const task = this.writing.catch(() => {}).then(() => this.write(link.channelId))
    this.writing = task
    return task
  }
  private async write(channelId: string | null): Promise<'done' | 'unconfirmed'> {
    let reader: FirestoreReader | null = null
    try {
      reader = new FirestoreReader(this.auth)
      await reader.updateUserFields(this.uid, channelId ? { [personalChannelField]: { stringValue: channelId } } : {}, [personalChannelField],
        AbortSignal.any([this.auth.signal, AbortSignal.timeout(35000)]))
      return 'done'
    } catch (error) {
      if (error instanceof DocumentWriteFailure && error.uncertain) return 'unconfirmed'
      throw new Error(tr('저장하지 못했습니다.'))
    } finally { reader?.close() }
  }
  close(): void {
    this.closed = true
    for (const card of this.cards) card.abort?.abort()
    this.owned?.abort?.abort()
    this.cards = []; this.owned = null
    this.avatars.close()
  }
}
