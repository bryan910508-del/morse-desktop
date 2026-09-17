import type { FirestoreReader } from '../network/firestore-rpc'
import { documents, timestamp, type FirestoreDocument } from '../network/firestore-values'
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

export class ChatTyping {
  private owner: Owner | null = null
  private sent: { chatId: string; typing: boolean; at: number } | null = null

  constructor(private readonly uid: string, private readonly signal: AbortSignal, private readonly changed: () => void) {}

  // A 1:1 room follows the other person's watcher document; a group follows every watcher.
  bind(chatId: string, peer: string | null, reader: FirestoreReader): void {
    this.clear()
    const owner: Owner = { chatId, rows: new Map(), stop: () => {} }
    this.owner = owner
    const target = peer ? { documents: { documents: [`${documents}/chats/${chatId}/watchers/${peer}`] } }
      : { query: { parent: `${documents}/chats/${chatId}`, structuredQuery: { from: [{ collectionId: 'watchers' }], limit: 500 } } }
    owner.stop = reader.watch(target, this.signal, {
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
// first chats in one listen, a 1:1 chat's other person and every other member of a small group.
export const listTypingChats = 30
export const listTypingDocuments = 500
const listTypingGroupMembers = 100

export function listTypingDocumentNames(dialogs: readonly DialogSummary[], me: string): string[] {
  const names: string[] = []
  let chats = 0
  for (const dialog of dialogs) {
    if (chats >= listTypingChats) break
    if (dialog.kind === 'secret' || dialog.id === `memo_${me}` || !dialog.participantUids.includes(me)) continue
    const others = dialog.participantUids.filter(uid => uid !== me)
    if (!others.length || (dialog.kind === 'group' && others.length > listTypingGroupMembers) || names.length + others.length > listTypingDocuments) continue
    for (const uid of others) names.push(`${documents}/chats/${dialog.id}/watchers/${uid}`)
    chats++
  }
  return names
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

export class DialogTyping {
  private key = ''
  private reader: FirestoreReader | null = null
  private rows = new Map<string, FirestoreDocument>()
  private stop: () => void = () => {}

  constructor(private readonly uid: string, private readonly signal: AbortSignal, private readonly changed: () => void) {}

  bind(dialogs: readonly DialogSummary[], reader: FirestoreReader | null): void {
    const names = reader ? listTypingDocumentNames(dialogs, this.uid) : []
    const key = names.join('\n')
    if (key === this.key && reader === this.reader) return
    this.clear()
    this.key = key; this.reader = reader
    if (!reader || !names.length) return
    let current = true
    const stop = reader.watch({ documents: { documents: names } }, this.signal, {
      snapshot: rows => { if (!current) return; this.rows = new Map(rows); this.changed() },
      state: () => {}
    }, names.length, 2 * 1024 * 1024)
    this.stop = () => { current = false; stop() }
  }
  clear(): void {
    this.stop(); this.stop = () => {}
    const had = this.rows.size > 0
    this.rows = new Map(); this.key = ''; this.reader = null
    if (had) this.changed()
  }
  snapshot(now = Date.now()): Record<string, ListTypingEntry> {
    return listTypingState(this.rows.values(), this.uid, now)
  }
}
