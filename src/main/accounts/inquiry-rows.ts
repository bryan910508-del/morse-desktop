import type { MyHistoryClear } from './hidden-chats'
import { inquiryPreviewText, ownerRowId, subscriberRowId, type InquiryForwardRoom, type InquiryRole, type InquiryRow } from '../../shared/channel-inquiries'
import type { InquiryNotice } from './inquiry-notifications'
import { positionMilliseconds } from '../../shared/model'
import { FirestoreReader, type ReadCredentials } from '../network/firestore-rpc'
import { callMorseFunction } from '../network/morse-callable'
import { boolField, documents, numberField, stringField, timestamp, type FirestoreDocument, type WireObject } from '../network/firestore-values'
import { ChannelImages } from './channel-images'
import { tr } from '../../shared/i18n'

// ChannelInquiryLimits: a subscriber's rooms and an owner's rooms across every channel they own.
const maxSubscriberRooms = 200, maxOwnerRooms = 500

function time(fields: Record<string, WireObject>, key: string): number | null {
  const raw = fields[key]?.timestampValue
  if (!raw) return null
  try { return positionMilliseconds(timestamp(raw, '')) } catch { return null }
}
function preview(fields: Record<string, WireObject>): string {
  return inquiryPreviewText(stringField(fields, 'lastMessage', 100000).slice(0, 300))
}
function channelName(fields: Record<string, WireObject>): string {
  return boolField(fields, 'channelDeleted') ? tr('알 수 없는 채널') : stringField(fields, 'channelName', 512) || tr('채널')
}

// The line of one message as the server writes a room's `lastMessage` (functions morse-message-preview.js
// lastMessagePreview), for a room whose newest messages this device deleted for itself.
export function messageLine(fields: Record<string, WireObject>): string {
  const type = stringField(fields, 'type', 32) || 'text', text = stringField(fields, 'text', 100000)
  if (type === 'text' || type === 'channelPost') return text
  if (type === 'file') return stringField(fields, 'fileName', 1000) || text || '📎 File'
  if (type === 'event' && stringField(fields, 'eventTitle', 1000)) return `📅 ${stringField(fields, 'eventTitle', 1000)}`
  if (type === 'poll') return stringField(fields, 'pollQuestion', 1000)
  return ({ image: '📷 Photo', video: '🎬 Video', voice: '🎤 Voice message', sticker: 'Sticker', location: 'Location', event: 'Event', contact: 'Contact' } as Record<string, string>)[type] ?? ''
}
// What a room's line shows in place of the room document's own when its newest messages are deleted here: the newest
// message left, and when it was sent (null keeps the room's time), or nothing to say (null).
export type RemainingLine = (inquiryId: string, roomAt: number | null) => { preview: string; lastMessageAt: number | null } | null
// B327: this account's boundary for an inquiry room (users/{uid}/historyClears), in milliseconds, and whether it took the
// room out of the list. A room whose newest message is at or before it shows no line, or none at all.
export type MyInquiryClear = (inquiryId: string) => { cutoff: number; removeRow: boolean } | null
// Messages this device deleted for itself in inquiry rooms (hidden-messages.ts, by the room's queue id).
export interface HiddenInquiryMessages { count(inquiryId: string): number; has(inquiryId: string, messageId: string): boolean }

// ChatListView's rows for these rooms: one per inquiry for a subscriber, one folder per channel for
// an owner (ChannelInquirySummary gathers that channel's rooms). `addresses` keeps each channel's
// cached picture address, taken from the newest room that carries one.
// The rooms one gone check reads at most; the window keeps state for few rooms, and asks again for the rest later.
export const goneCheckLimit = 20
export function buildInquiryRows(uid: string, subscriber: Iterable<FirestoreDocument>, owner: Iterable<FirestoreDocument>, remaining: RemainingLine = () => null,
  mine: MyInquiryClear = () => null): { rows: InquiryRow[]; addresses: Map<string, string> } {
  // What a room shows after this account's boundary: its line, or nothing when the row goes. B484b: a room with no
  // message yet is placed by when it was made (its createdAt, which all three apps write), so a room made again under an
  // id after this account cleared the old one is a new room, not one still inside the old boundary — as tdesktop's
  // boundary is a place in that chat's history and what comes after it shows (History::clearUpTill, history.cpp:4518-4540).
  const cleared = (id: string, at: number | null): 'row' | 'line' | null => {
    const clear = mine(id)
    if (!clear || (at !== null && at > clear.cutoff)) return null
    return clear.removeRow ? 'row' : 'line'
  }
  const addresses = new Map<string, string>(), rows: InquiryRow[] = []
  const remember = (channelId: string, fields: Record<string, WireObject>): void => {
    const raw = boolField(fields, 'channelDeleted') ? '' : stringField(fields, 'channelPhotoURL', 10000)
    if (raw && !addresses.has(channelId)) addresses.set(channelId, raw)
  }
  for (const doc of subscriber) {
    const f = doc.fields, channelId = stringField(f, 'channelId', 160), id = doc.name.slice(doc.name.lastIndexOf('/') + 1)
    if (!channelId || !id || stringField(f, 'subscriberId', 160) !== uid) continue
    remember(channelId, f)
    const roomAt = time(f, 'lastMessageAt'), left = remaining(id, roomAt), mark = cleared(id, left?.lastMessageAt ?? roomAt ?? time(f, 'createdAt'))
    if (mark === 'row') continue
    // B474: a cleared room keeps its place by its time, and shows neither a line nor the time (DialogSummary.topCleared).
    rows.push({ id: subscriberRowId(id), kind: 'subscriber', channelId, inquiryId: id, title: channelName(f), preview: mark ? '' : left ? left.preview : preview(f),
      lastMessageAt: left?.lastMessageAt ?? roomAt, ...(mark ? { cleared: true as const } : {}), unread: Math.max(0, Math.trunc(numberField(f, 'unreadForSubscriber'))), rooms: 1 })
  }
  const folders = new Map<string, InquiryRow>()
  for (const doc of owner) {
    const f = doc.fields, channelId = stringField(f, 'channelId', 160)
    if (!channelId || stringField(f, 'channelOwnerId', 160) !== uid) continue
    remember(channelId, f)
    const id = doc.name.slice(doc.name.lastIndexOf('/') + 1), roomAt = time(f, 'lastMessageAt'), left = id ? remaining(id, roomAt) : null
    const at = left?.lastMessageAt ?? roomAt, mark = id ? cleared(id, at ?? time(f, 'createdAt')) : null
    if (mark === 'row') continue
    const line = mark ? '' : left ? left.preview : preview(f), unread = Math.max(0, Math.trunc(numberField(f, 'unreadForOwner')))
    const current = folders.get(channelId)
    if (!current) {
      folders.set(channelId, { id: ownerRowId(channelId), kind: 'ownerFolder', channelId, inquiryId: null, title: channelName(f),
        preview: line, lastMessageAt: at, ...(mark ? { cleared: true as const } : {}), unread, rooms: 1 })
      continue
    }
    current.rooms += 1
    current.unread += unread
    if (at !== null && (current.lastMessageAt === null || at > current.lastMessageAt)) {
      current.lastMessageAt = at; current.preview = line; current.title = channelName(f)
      if (mark) current.cleared = true; else delete current.cleared
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
  private mine = new Map<string, { cutoff: number; removeRow: boolean }>()
  // A row shows the channel's own picture, which is public (storage.rules channel_photos).
  private readonly photos: ChannelImages
  private addresses = new Map<string, string>()
  private visible: string[] = []
  // The newest message left in rooms whose newest messages are deleted here, read once per room time and hidden count.
  private readonly remaining = new Map<string, { key: string; value: { preview: string; lastMessageAt: number | null } | null }>()
  private readonly reading = new Set<string>()
  // B484: told the rooms both lists hold once each has answered in this run, with a way to ask whether a room is there.
  listed: ((ids: ReadonlySet<string>, exists: (inquiryId: string) => Promise<boolean>) => void) | null = null
  private answered = { subscriber: false, owner: false }

  constructor(private readonly uid: string, private readonly auth: ReadCredentials,
    private readonly allowed: () => void, private readonly changed: () => void,
    // What each room's newest message is, for the banner this window shows in place of a push.
    private readonly noticed: (rooms: InquiryNotice[]) => void = () => {},
    private readonly hidden: HiddenInquiryMessages | null = null) {
    this.photos = new ChannelImages(auth, id => ({ name: `${documents}/channels/${id}`,
      fields: { photoURL: { stringValue: this.addresses.get(id) ?? '' } } } as unknown as FirestoreDocument), () => { if (!this.closed) this.changed() })
  }

  resume(): void {
    // F-RT-004: the rooms are listened to under a lock too, so a message still makes its (hidden) banner; nothing of them is
    // shown while locked (snapshot, opened rooms and pictures wait for the unlock).
    if (this.closed || this.running) return
    try { this.allowed() } catch { return }
    this.reader ??= new FirestoreReader(this.auth)
    const reader = this.reader
    this.running = true
    const watch = (field: 'subscriberId' | 'channelOwnerId', limit: number, rows: Map<string, FirestoreDocument>, side: 'subscriber' | 'owner'): void => {
      this.stops.push(reader.watch({ query: { parent: documents, structuredQuery: { from: [{ collectionId: 'channelInquiries' }],
        where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: this.uid } } },
        orderBy: [{ field: { fieldPath: 'lastMessageAt' }, direction: 'DESCENDING' }, { field: { fieldPath: '__name__' }, direction: 'DESCENDING' }],
        limit: { value: limit } } } }, this.auth.signal, {
        snapshot: next => {
          if (this.closed || !this.running) return
          rows.clear()
          for (const [name, doc] of next) rows.set(name, doc)
          if (!this.locked) this.choosePhotos()
          try { this.noticed(this.notices()) } catch { /* A banner is never worth losing the list over. */ }
          this.answered[side] = true
          this.tellListed(reader)
          this.changed()
        },
        // A dropped listener leaves the rows that are already on screen; the next snapshot replaces them.
        state: () => {}
      }, limit, 8 * 1024 * 1024))
    }
    watch('subscriberId', maxSubscriberRooms, this.subscriber, 'subscriber')
    watch('channelOwnerId', maxOwnerRooms, this.owner, 'owner')
  }
  private tellListed(reader: FirestoreReader): void {
    if (!this.listed || !this.answered.subscriber || !this.answered.owner) return
    const ids = new Set([...this.subscriber.keys(), ...this.owner.keys()].map(name => name.slice(name.lastIndexOf('/') + 1)))
    try {
      this.listed(ids, async inquiryId => (await reader.getDocument(`${documents}/channelInquiries/${inquiryId}`, this.auth.signal)) !== null)
    } catch { /* The queue is asked again with the next list. */ }
  }
  // B521: «읽음으로 표시» on a row with unread messages reads them, as Telegram's «Mark as read» moves the read position to
  // the end (TA DialogsActivity markAsRead :9573-9574 · markDialogsAsRead :9587-9601) — the room, or each unread room of an
  // owner's folder, to its newest message (markMorseInquiryRead with no message, morse-release-authority.js:527-549).
  // Only the device's own mark changed before, so a room with unread messages stayed unread. Android 0c5c6aca.
  unreadRooms(rowId: string): string[] {
    const name = (doc: FirestoreDocument): string => doc.name.slice(doc.name.lastIndexOf('/') + 1)
    const subscriber = [...this.subscriber.values()].filter(doc => subscriberRowId(name(doc)) === rowId && stringField(doc.fields, 'subscriberId', 160) === this.uid &&
      numberField(doc.fields, 'unreadForSubscriber') > 0)
    const owner = [...this.owner.values()].filter(doc => ownerRowId(stringField(doc.fields, 'channelId', 160)) === rowId && stringField(doc.fields, 'channelOwnerId', 160) === this.uid &&
      numberField(doc.fields, 'unreadForOwner') > 0)
    return [...subscriber, ...owner].map(name).filter(Boolean)
  }
  async readRow(rowId: string, call: typeof callMorseFunction = callMorseFunction): Promise<number> {
    if (this.closed || this.locked) throw new Error(tr('읽음 요청과 연결 상태를 확인해 주세요.'))
    this.allowed()
    const rooms = this.unreadRooms(rowId)
    let next = 0, failed = 0
    const work = async (): Promise<void> => {
      while (next < rooms.length) {
        const inquiryId = rooms[next++]!
        try { await call(this.auth, 'markMorseInquiryRead', { inquiryId, expectedUid: this.uid }, AbortSignal.timeout(65000)) } catch { failed++ }
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, rooms.length) }, work))
    if (failed) throw new Error(tr('읽음 요청과 연결 상태를 확인해 주세요.'))
    return rooms.length
  }
  // B484 (tdesktop Session::deleteConversationLocally, data_session.cpp:1699-1726): which of these rooms are gone, so the
  // window drops what it kept on this device for them. Gone is known only once both lists have answered in this run, the
  // room is in neither, and reading it finds nothing; a room pushed out of a full list is still there when read, and a
  // read that fails knows nothing. `answered` is false until both lists have answered, so the window asks again later.
  async gone(ids: readonly string[]): Promise<{ answered: boolean; gone: string[] }> {
    const reader = this.reader
    if (this.closed || this.locked || !reader || !this.answered.subscriber || !this.answered.owner) return { answered: false, gone: [] }
    const listed = new Set([...this.subscriber.keys(), ...this.owner.keys()].map(name => name.slice(name.lastIndexOf('/') + 1)))
    const gone: string[] = []
    for (const inquiryId of [...new Set(ids)].slice(0, goneCheckLimit)) {
      if (listed.has(inquiryId)) continue
      try { if ((await reader.getDocument(`${documents}/channelInquiries/${inquiryId}`, this.auth.signal)) === null) gone.push(inquiryId) }
      catch { /* Not known: kept, and asked again in a later run. */ }
    }
    return { answered: true, gone }
  }
  pause(): void {
    for (const stop of this.stops) stop()
    this.stops = []; this.running = false
    this.subscriber.clear(); this.owner.clear(); this.addresses.clear(); this.visible = []
    this.answered = { subscriber: false, owner: false }
    this.photos.clear()
    this.reader?.close(); this.reader = null
  }
  setLocked(locked: boolean): void {
    if (this.locked === locked) return
    this.locked = locked
    if (!locked) { this.resume(); this.choosePhotos() }
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
  // Telegram's dialog row shows the last message it still has. A room document carries only its newest message, so a
  // room with messages deleted here has its latest ones read, once for each newest-message time, and the newest one
  // left becomes its line; until that read answers, the room's own line stays.
  private remainingLine(inquiryId: string, roomAt: number | null): { preview: string; lastMessageAt: number | null } | null {
    const count = this.hidden?.count(inquiryId) ?? 0
    if (!count) return null
    const key = `${roomAt ?? 0}:${count}`, known = this.remaining.get(inquiryId)
    if (known?.key === key) return known.value
    if (!this.reading.has(key + inquiryId)) void this.readRemaining(inquiryId, key, count)
    return null
  }
  private async readRemaining(inquiryId: string, key: string, count: number): Promise<void> {
    const reader = this.reader, hidden = this.hidden
    if (!reader || !hidden || this.closed) return
    this.reading.add(key + inquiryId)
    try {
      const docs = await reader.query(`${documents}/channelInquiries/${inquiryId}`, { from: [{ collectionId: 'messages' }],
        orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }, { field: { fieldPath: '__name__' }, direction: 'DESCENDING' }],
        limit: { value: Math.min(100, count + 1) } }, this.auth.signal)
      if (this.closed) return
      const left = docs.find(doc => !hidden.has(inquiryId, doc.name.slice(doc.name.lastIndexOf('/') + 1)))
      this.remaining.set(inquiryId, { key, value: left ? { preview: inquiryPreviewText(messageLine(left.fields).slice(0, 300)), lastMessageAt: time(left.fields, 'createdAt') } : { preview: '', lastMessageAt: null } })
      this.changed()
    } catch { /* The room's own line stays; the next change of the room asks again. */ }
    finally { this.reading.delete(key + inquiryId) }
  }
  // B327: this account's inquiry boundaries as last received.
  setMine(clears: Map<string, MyHistoryClear>): void {
    this.mine = new Map([...clears].map(([id, value]) => [id, { cutoff: positionMilliseconds(value.cutoff), removeRow: value.removeRow }]))
  }
  snapshot(): InquiryRow[] {
    if (this.closed || this.locked) return []
    // A fault here must not break the whole snapshot; the rows simply stay away until the next one.
    try {
      const { rows } = buildInquiryRows(this.uid, this.subscriber.values(), this.owner.values(), (id, at) => this.remainingLine(id, at), id => this.mine.get(id) ?? null)
      return rows.map(row => ({ ...row, photo: this.photos.snapshot(row.channelId) }))
    } catch { return [] }
  }

  // What each room says about its newest message: who sent it, what it was, and whether this side has read it.
  // F-RT-004: read under a lock too — these go only to InquiryNotifications, which hides the words under the app's lock
  // and drops nothing else; the rooms themselves stay off screen (snapshot) until the unlock.
  notices(): InquiryNotice[] {
    if (this.closed) return []
    const notices: InquiryNotice[] = []
    const add = (doc: FirestoreDocument, role: InquiryRole): void => {
      const f = doc.fields, id = doc.name.slice(doc.name.lastIndexOf('/') + 1), channelId = stringField(f, 'channelId', 160)
      if (!id || !channelId || id.includes('/')) return
      if (stringField(f, role === 'owner' ? 'channelOwnerId' : 'subscriberId', 160) !== this.uid) return
      const title = role === 'owner'
        ? (boolField(f, 'subscriberAccountDeleted') ? tr('탈퇴한 계정') : stringField(f, 'subscriberName', 512) || tr('구독자'))
        : channelName(f)
      notices.push({ inquiryId: id, channelId, title, preview: preview(f), at: time(f, 'lastMessageAt') ?? 0,
        unread: Math.max(0, Math.trunc(numberField(f, role === 'owner' ? 'unreadForOwner' : 'unreadForSubscriber'))),
        fromMe: stringField(f, 'lastSenderId', 160) === this.uid })
    }
    try {
      for (const doc of this.subscriber.values()) add(doc, 'subscriber')
      for (const doc of this.owner.values()) add(doc, 'owner')
    } catch { return [] }
    return notices
  }

  // The rooms a forward may go into: this account's own rooms, whichever side of them it is on. A subscriber's room
  // is named by its channel, an owner's by the person asking, as each side already sees them in the list.
  forwardRooms(): InquiryForwardRoom[] {
    if (this.closed || this.locked) return []
    const rooms: InquiryForwardRoom[] = []
    const add = (doc: FirestoreDocument, role: InquiryRole): void => {
      const f = doc.fields, id = doc.name.slice(doc.name.lastIndexOf('/') + 1), channelId = stringField(f, 'channelId', 160)
      if (!id || !channelId || id.includes('/')) return
      if (stringField(f, role === 'owner' ? 'channelOwnerId' : 'subscriberId', 160) !== this.uid) return
      const title = role === 'owner'
        ? (boolField(f, 'subscriberAccountDeleted') ? tr('탈퇴한 계정') : stringField(f, 'subscriberName', 512) || tr('구독자'))
        : channelName(f)
      rooms.push({ inquiryId: id, channelId, title, role })
    }
    try {
      for (const doc of this.subscriber.values()) add(doc, 'subscriber')
      for (const doc of this.owner.values()) add(doc, 'owner')
    } catch { return [] }
    return rooms
  }

  response(token: string, request: Request): Response { return this.photos.response(token, request) }
}
