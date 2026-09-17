import { ownerRowId, subscriberRowId, type InquiryRow } from '../../shared/channel-inquiries'
import { positionMilliseconds } from '../../shared/model'
import { FirestoreReader, type ReadCredentials } from '../network/firestore-rpc'
import { boolField, documents, numberField, stringField, timestamp, type FirestoreDocument, type WireObject } from '../network/firestore-values'
import { ChannelImages } from './channel-images'
import { tr } from '../../shared/i18n'

// ChannelInquiryLimits: a subscriber's rooms and an owner's rooms across every channel they own.
const maxSubscriberRooms = 200, maxOwnerRooms = 500
const managedMedia = /^https:\/\/firebasestorage\.googleapis\.com\//

function time(fields: Record<string, WireObject>, key: string): number | null {
  const raw = fields[key]?.timestampValue
  if (!raw) return null
  try { return positionMilliseconds(timestamp(raw, '')) } catch { return null }
}
// A media message keeps its download URL in lastMessage, the way iOS stores it in text as well.
function preview(fields: Record<string, WireObject>): string {
  const raw = stringField(fields, 'lastMessage', 100000).slice(0, 300)
  return managedMedia.test(raw) ? tr('사진') : raw
}
function channelName(fields: Record<string, WireObject>): string {
  return boolField(fields, 'channelDeleted') ? tr('알 수 없는 채널') : stringField(fields, 'channelName', 512) || tr('채널')
}

// ChatListView's rows for these rooms: one per inquiry for a subscriber, one folder per channel for
// an owner (ChannelInquirySummary gathers that channel's rooms). `addresses` keeps each channel's
// cached picture address, taken from the newest room that carries one.
export function buildInquiryRows(uid: string, subscriber: Iterable<FirestoreDocument>, owner: Iterable<FirestoreDocument>): { rows: InquiryRow[]; addresses: Map<string, string> } {
  const addresses = new Map<string, string>(), rows: InquiryRow[] = []
  const remember = (channelId: string, fields: Record<string, WireObject>): void => {
    const raw = boolField(fields, 'channelDeleted') ? '' : stringField(fields, 'channelPhotoURL', 10000)
    if (raw && !addresses.has(channelId)) addresses.set(channelId, raw)
  }
  for (const doc of subscriber) {
    const f = doc.fields, channelId = stringField(f, 'channelId', 160), id = doc.name.slice(doc.name.lastIndexOf('/') + 1)
    if (!channelId || !id || stringField(f, 'subscriberId', 160) !== uid) continue
    remember(channelId, f)
    rows.push({ id: subscriberRowId(id), kind: 'subscriber', channelId, inquiryId: id, title: channelName(f), preview: preview(f),
      lastMessageAt: time(f, 'lastMessageAt'), unread: Math.max(0, Math.trunc(numberField(f, 'unreadForSubscriber'))), rooms: 1 })
  }
  const folders = new Map<string, InquiryRow>()
  for (const doc of owner) {
    const f = doc.fields, channelId = stringField(f, 'channelId', 160)
    if (!channelId || stringField(f, 'channelOwnerId', 160) !== uid) continue
    remember(channelId, f)
    const at = time(f, 'lastMessageAt'), unread = Math.max(0, Math.trunc(numberField(f, 'unreadForOwner')))
    const current = folders.get(channelId)
    if (!current) {
      folders.set(channelId, { id: ownerRowId(channelId), kind: 'ownerFolder', channelId, inquiryId: null, title: channelName(f),
        preview: preview(f), lastMessageAt: at, unread, rooms: 1 })
      continue
    }
    current.rooms += 1
    current.unread += unread
    if (at !== null && (current.lastMessageAt === null || at > current.lastMessageAt)) {
      current.lastMessageAt = at; current.preview = preview(f); current.title = channelName(f)
    }
  }
  rows.push(...folders.values())
  rows.sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return { rows, addresses }
}

// The chat list's inquiry rooms, kept for the whole session: ChannelInquiryService
// listenToSubscriberInquiries and listenToAllOwnerInquiries, both by latest message.
export class InquiryRows {
  private reader: FirestoreReader | null = null
  private stops: (() => void)[] = []
  private running = false
  private locked = false
  private closed = false
  private subscriber = new Map<string, FirestoreDocument>()
  private owner = new Map<string, FirestoreDocument>()
  // A row shows the channel's own picture, which is public (storage.rules channel_photos).
  private readonly photos: ChannelImages
  private addresses = new Map<string, string>()
  private visible: string[] = []

  constructor(private readonly uid: string, private readonly auth: ReadCredentials,
    private readonly allowed: () => void, private readonly changed: () => void) {
    this.photos = new ChannelImages(auth, id => ({ name: `${documents}/channels/${id}`,
      fields: { photoURL: { stringValue: this.addresses.get(id) ?? '' } } } as unknown as FirestoreDocument), () => { if (!this.closed) this.changed() })
  }

  resume(): void {
    if (this.closed || this.locked || this.running) return
    try { this.allowed() } catch { return }
    this.reader ??= new FirestoreReader(this.auth)
    const reader = this.reader
    this.running = true
    const watch = (field: 'subscriberId' | 'channelOwnerId', limit: number, rows: Map<string, FirestoreDocument>): void => {
      this.stops.push(reader.watch({ query: { parent: documents, structuredQuery: { from: [{ collectionId: 'channelInquiries' }],
        where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: this.uid } } },
        orderBy: [{ field: { fieldPath: 'lastMessageAt' }, direction: 'DESCENDING' }, { field: { fieldPath: '__name__' }, direction: 'DESCENDING' }],
        limit: { value: limit } } } }, this.auth.signal, {
        snapshot: next => {
          if (this.closed || !this.running) return
          rows.clear()
          for (const [name, doc] of next) rows.set(name, doc)
          this.choosePhotos()
          this.changed()
        },
        // A dropped listener leaves the rows that are already on screen; the next snapshot replaces them.
        state: () => {}
      }, limit, 8 * 1024 * 1024))
    }
    watch('subscriberId', maxSubscriberRooms, this.subscriber)
    watch('channelOwnerId', maxOwnerRooms, this.owner)
  }
  pause(): void {
    for (const stop of this.stops) stop()
    this.stops = []; this.running = false
    this.subscriber.clear(); this.owner.clear(); this.addresses.clear(); this.visible = []
    this.photos.clear()
    this.reader?.close(); this.reader = null
  }
  setLocked(locked: boolean): void {
    if (this.locked === locked) return
    this.locked = locked
    if (locked) this.pause()
    else this.resume()
    this.changed()
  }
  close(): void { this.closed = true; this.pause(); this.photos.close() }

  // Reading a snapshot changes nothing: ChannelImages announces its own change, so asking for
  // pictures while a publish is being assembled would ask for another publish without end.
  private choosePhotos(): void {
    const { rows, addresses } = buildInquiryRows(this.uid, this.subscriber.values(), this.owner.values())
    this.addresses = addresses
    const ids = rows.map(row => row.channelId)
    if (ids.length === this.visible.length && ids.every((id, index) => id === this.visible[index])) return
    this.visible = ids
    this.photos.setVisible(ids)
  }
  snapshot(): InquiryRow[] {
    if (this.closed || this.locked) return []
    // A fault here must not break the whole snapshot; the rows simply stay away until the next one.
    try {
      const { rows } = buildInquiryRows(this.uid, this.subscriber.values(), this.owner.values())
      return rows.map(row => ({ ...row, photo: this.photos.snapshot(row.channelId) }))
    } catch { return [] }
  }

  response(token: string, request: Request): Response { return this.photos.response(token, request) }
}
