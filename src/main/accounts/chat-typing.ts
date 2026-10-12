import type { FirestoreReader, WatchEvents } from '../network/firestore-rpc'
import { documents, timestamp, type FirestoreDocument, type WireObject } from '../network/firestore-values'
import { positionMilliseconds, type DialogSummary } from '../../shared/model'

// iOS ChatRoomView typing (Telegram PeerInputActivityManager): chats/{chatId}/watchers/{uid} carries
// typing + typingAt; a writer repeats "typing" at most every 5 seconds and a reader trusts it for 8.
export const typingRepeatMs = 5000
export const typingExpiryMs = 8000

export interface TypingSnapshot { chatId: string; until: number }

export function typingUntil(rows: Iterable<FirestoreDocument>, me: string, now: number): number {
  let until = 0
  for (const doc of rows) {
    if (doc.name.endsWith(`/watchers/${me}`)) continue
    const typing = doc.fields?.typing?.booleanValue === true, at = doc.fields?.typingAt?.timestampValue
    if (!typing || !at) continue
    try {
      const expires = positionMilliseconds(timestamp(at, '')) + typingExpiryMs
      if (expires > now) until = Math.max(until, expires)
    } catch { /* A watcher without a readable time says nothing. */ }
  }
  return until
}

interface Owner { chatId: string; rows: Map<string, FirestoreDocument>; stop: () => void }
// The limit is a google.protobuf.Int32Value, so it goes as { value }: a bare number fails to serialize before it leaves
// (B20 — every group room's typing read failed that way from e861f79 on).
export function typingTarget(chatId: string, peer: string | null): WireObject {
  return peer ? { documents: { documents: [`${documents}/chats/${chatId}/watchers/${peer}`] } }
    : { query: { parent: `${documents}/chats/${chatId}`, structuredQuery: { from: [{ collectionId: 'watchers' }], limit: { value: 500 } } } }
}

export class ChatTyping {
  private owner: Owner | null = null
  private sent: { chatId: string; typing: boolean; at: number } | null = null

  constructor(private readonly uid: string, private readonly signal: AbortSignal, private readonly changed: () => void) {}

  // A 1:1 room follows the other person's watcher document; a group follows every watcher.
  bind(chatId: string, peer: string | null, reader: FirestoreReader): void {
    this.clear()
    const owner: Owner = { chatId, rows: new Map(), stop: () => {} }
    this.owner = owner
    owner.stop = reader.watch(typingTarget(chatId, peer), this.signal, {
      snapshot: rows => { if (this.owner !== owner) return; owner.rows = new Map(rows); this.changed() },
      state: () => {}
    }, 500, 2 * 1024 * 1024)
  }
  clear(): void {
    this.owner?.stop()
    this.owner = null
  }
  snapshot(now = Date.now()): TypingSnapshot | null {
    const owner = this.owner
    if (!owner) return null
    const until = typingUntil(owner.rows.values(), this.uid, now)
    return until ? { chatId: owner.chatId, until } : null
  }

  // updateTypingStateIfNeeded: "typing" is repeated no sooner than every 5 seconds; "stopped" is sent once.
  shouldWrite(chatId: string, typing: boolean, now = Date.now()): boolean {
    const last = this.sent
    if (typing) {
      if (last && last.chatId === chatId && last.typing && now - last.at < typingRepeatMs) return false
    } else if (!last || last.chatId !== chatId || !last.typing) return false
    this.sent = { chatId, typing, at: now }
    return true
  }
  // The chat that still shows "typing" to others when this device leaves it.
  pendingStop(): string | null {
    return this.sent?.typing ? this.sent.chatId : null
  }
}

// Telegram's dialog row «typing…» (Dialogs::Ui row send actions): the chat list follows the watcher documents of its
// first chats, a 1:1 chat's other person and every member of a small group.
export const listTypingChats = 30
export const listTypingDocuments = 500
const listTypingGroupMembers = 100

// One room the list follows: the target is ChatTyping's (typingTarget), the members are what its row says now.
export interface ListTypingRoom { chatId: string; peer: string | null; members: string }

export function listTypingRooms(dialogs: readonly DialogSummary[], me: string): ListTypingRoom[] {
  const rooms: ListTypingRoom[] = []
  let followed = 0
  for (const dialog of dialogs) {
    if (rooms.length >= listTypingChats) break
    if (dialog.kind === 'secret' || dialog.id === `memo_${me}` || !dialog.participantUids.includes(me)) continue
    const others = dialog.participantUids.filter(uid => uid !== me)
    if (!others.length || (dialog.kind === 'group' && others.length > listTypingGroupMembers) || followed + others.length > listTypingDocuments) continue
    followed += others.length
    rooms.push({ chatId: dialog.id, peer: dialog.kind !== 'group' && others.length === 1 ? others[0] ?? null : null, members: [...dialog.participantUids].sort().join(',') })
  }
  return rooms
}

export interface ListTypingEntry { until: number; uids: string[] }
export function listTypingState(rows: Iterable<FirestoreDocument>, me: string, now: number): Record<string, ListTypingEntry> {
  const state: Record<string, ListTypingEntry> = {}
  const prefix = `${documents}/chats/`
  for (const doc of rows) {
    if (!doc.name.startsWith(prefix)) continue
    const [chatId, collection, uid] = doc.name.slice(prefix.length).split('/')
    if (!chatId || collection !== 'watchers' || !uid || uid === me) continue
    const until = typingUntil([doc], me, now)
    if (!until) continue
    const entry = state[chatId] ??= { until: 0, uids: [] }
    entry.until = Math.max(entry.until, until)
    entry.uids.push(uid)
  }
  return state
}

// What DialogTyping needs of a FirestoreReader: one Listen stream that carries many targets (B277 ②, ListenTargets).
export interface TypingListen {
  add(wire: WireObject, events: WatchEvents, maxDocuments: number, maxBytes?: number): () => void
  close(): void
}
export interface TypingReader { listenTargets(signal: AbortSignal): TypingListen }

interface ListenedRoom { room: ListTypingRoom; rows: Map<string, FirestoreDocument>; stop: () => void }

// B333: every room is its own target on one stream, as Telegram takes a send action for the one history it names
// (Api::Updates::handleSendActionUpdate, api_updates.cpp:1095-1103) and paints it in that row alone
// (dialogs_layout.cpp:695-696). A room the server refuses — it is no longer one this account is in, or one listen
// asked more of the rules than they allow — ends that room only; the others go on. The list changing adds the rooms
// that came into it and removes the ones that left, by id: a new order listens to nothing again.
export class DialogTyping {
  private reader: TypingReader | null = null
  private listen: TypingListen | null = null
  private readonly rooms = new Map<string, ListenedRoom>()
  // A room whose listen ended, with the members its row had then: it is listened again only once they change.
  private readonly ended = new Map<string, string>()

  constructor(private readonly uid: string, private readonly signal: AbortSignal, private readonly changed: () => void,
    private readonly refused: () => void = () => {}) {}

  bind(dialogs: readonly DialogSummary[], reader: TypingReader | null): void {
    if (reader !== this.reader) {
      this.clear()
      if (!reader) return
      this.reader = reader
      this.listen = reader.listenTargets(this.signal)
    }
    const listen = this.listen
    if (!listen) return
    const present = new Set(dialogs.map(dialog => dialog.id))
    for (const chatId of [...this.ended.keys()]) if (!present.has(chatId)) this.ended.delete(chatId)
    const wanted = new Map(listTypingRooms(dialogs, this.uid).map(room => [room.chatId, room]))
    let dropped = false
    for (const [chatId, listened] of [...this.rooms]) {
      const room = wanted.get(chatId)
      if (room && room.peer === listened.room.peer) { listened.room = room; continue }
      listened.stop(); this.rooms.delete(chatId)
      if (listened.rows.size) dropped = true
    }
    for (const room of wanted.values()) {
      if (this.rooms.has(room.chatId)) continue
      const members = this.ended.get(room.chatId)
      if (members === room.members) continue
      this.ended.delete(room.chatId)
      this.start(listen, room)
    }
    if (dropped) this.changed()
  }

  private start(listen: TypingListen, room: ListTypingRoom): void {
    const listened: ListenedRoom = { room, rows: new Map(), stop: () => {} }
    this.rooms.set(room.chatId, listened)
    const mine = (): boolean => this.rooms.get(room.chatId) === listened
    listened.stop = listen.add(typingTarget(room.chatId, room.peer), {
      snapshot: rows => { if (!mine()) return; listened.rows = new Map(rows); this.changed() },
      state: (state, error) => {
        if (!mine() || state !== 'error') return
        this.rooms.delete(room.chatId)
        this.ended.set(room.chatId, listened.room.members)
        if (error?.code === 'permission') this.refused()
        if (listened.rows.size) this.changed()
      }
    }, room.peer ? 1 : 500, 2 * 1024 * 1024)
  }

  // Sign-out, a lock or a new reader: every room stops, and one that ended may be listened again.
  clear(): void {
    let had = false
    for (const listened of this.rooms.values()) { listened.stop(); if (listened.rows.size) had = true }
    this.rooms.clear(); this.ended.clear()
    this.listen?.close(); this.listen = null; this.reader = null
    if (had) this.changed()
  }

  // The rooms listened to now, for tests and diagnostics.
  get size(): number { return this.rooms.size }

  snapshot(now = Date.now()): Record<string, ListTypingEntry> {
    return listTypingState([...this.rooms.values()].flatMap(listened => [...listened.rows.values()]), this.uid, now)
  }
}
