import { FirestoreReader, type ReadCredentials } from '../network/firestore-rpc'
import { documents, type FirestoreDocument, type WireObject } from '../network/firestore-values'
import { ComposerDraftWriteFailure, commitNanos, maxCloudDraftChars, type CommitTime } from '../network/composer-draft-write'

// B530 (contract B530-cloud-drafts §4·§5·§11): a chat's unsent text follows the account to its other devices, as
// Telegram's cloud drafts do. This device's own draft (local_drafts, outbox.ts) stays what the field is typed into; the
// cloud copy users/{uid}/composerDrafts/{chatId} follows it (tdesktop keeps a local and a cloud draft per history the
// same way, history.cpp:311-346), and one listener on the collection brings the other devices' copies: all of them when
// it starts (messages.getAllDrafts), then each change (updateDraftMessage, api_updates.cpp:2841).
export const maxCloudDrafts = 1000
// tdesktop kSaveCloudDraftTimeout (apiwrap.cpp:114): a change goes up a second after the last one.
export const cloudDraftDelay = 1000
// tdesktop kSkipCloudDraftsFor (history.cpp:90): for a while after this device's write, what the server sends of that
// chat is not taken; a deletion carries no time of its own, so this is how an earlier one is told from a new one.
const skipAfterWrite = 2000

export function cloudDraftTarget(uid: string): WireObject {
  return { query: { parent: `${documents}/users/${uid}`, structuredQuery: { from: [{ collectionId: 'composerDrafts' }] } } }
}
// What the cloud copy of a draft is: nothing for a blank one (the document is deleted), else its first 8000 characters
// (the rules' limit; this device keeps up to 30000, Android AccountRemoteComposerDrafts takes the same prefix).
export function cloudDraftValue(text: string): string { return text.trim() === '' ? '' : text.slice(0, maxCloudDraftChars) }
// Each document of the account's collection: its text (null when it cannot be read: kept as there, never applied), the
// server's time of its last write, and its updatedAt in milliseconds (what a draft's own edit time is compared with).
export interface CloudDraftRow { text: string | null; at: CommitTime | null; updatedAt: number | null }
export function cloudDraftRows(uid: string, rows: Iterable<FirestoreDocument>): Map<string, CloudDraftRow> {
  const prefix = `${documents}/users/${uid}/composerDrafts/`, result = new Map<string, CloudDraftRow>()
  for (const doc of rows) {
    if (!doc.name.startsWith(prefix)) continue
    const chatId = doc.name.slice(prefix.length)
    if (!chatId || chatId.includes('/') || chatId.length > 256) continue
    const raw = doc.fields.text?.stringValue
    let at: CommitTime | null = null, updatedAt: number | null = null
    try { if (doc.updateTime) at = commitNanos(doc.updateTime) } catch { /* no time: compared as one */ }
    try { const stamp = doc.fields.updatedAt?.timestampValue ?? doc.updateTime; if (stamp) updatedAt = Number(commitNanos(stamp) / 1_000_000n) } catch { /* unknown */ }
    result.set(chatId, { text: typeof raw === 'string' && raw.length <= maxCloudDraftChars ? cloudDraftValue(raw) : null, at, updatedAt })
  }
  return result
}

export interface CloudDraftSource {
  watch(target: WireObject, snapshot: (rows: Iterable<FirestoreDocument>) => void): () => void
  write(chatId: string, text: string): Promise<CommitTime>
  close(): void
}
export function firestoreCloudDrafts(uid: string, auth: ReadCredentials, validate: () => void): () => CloudDraftSource {
  return () => {
    const reader = new FirestoreReader(auth)
    return {
      // The rows this device holds stay while the listener reconnects.
      watch: (target, snapshot) => reader.watch(target, auth.signal, { snapshot: rows => snapshot(rows.values()), state: () => {} }, maxCloudDrafts),
      write: (chatId, text) => reader.writeComposerDraft(uid, chatId, text, auth.signal, validate),
      close: () => reader.close()
    }
  }
}
// What a copy from another device does here. Each draft keeps, on this device, the cloud copy it last matched (synced,
// null when not known) and when it was last typed here (editedAt), so a listener started again knows them (§11 ⑥).
export interface LocalDraftState { text: string; synced: string | null; editedAt: number | null }
export interface CloudDraftHost {
  // The chat's draft on this device; throws for a chat this device does not hold.
  state(chatId: string): Promise<LocalDraftState>
  // Another device's copy becomes this device's draft, and what it last matched.
  adopt(chatId: string, text: string): Promise<void>
  markSynced(chatId: string, text: string): Promise<void>
  // Every draft with text on this device, for those the first snapshot does not name.
  unsynced(): Promise<({ chatId: string } & Omit<LocalDraftState, 'editedAt'>)[]>
  // The chat is open: its field decides (compose.tsx), as Telegram's applyDraftMaybe does.
  open(chatId: string): boolean
  show(chatId: string, text: string, previous: string | null): void
  // A secret chat has no cloud copy (Telegram's secret chats neither).
  eligible(chatId: string): boolean
}

export class CloudDrafts {
  private source: CloudDraftSource | null = null
  private stop: (() => void) | null = null
  private locked = false
  private closed = false
  // What the server holds for each chat as far as this device knows ('' = no document); a chat whose write may or may
  // not have landed is not here.
  private readonly server = new Map<string, string>()
  private readonly wanted = new Map<string, string>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  // One write per chat at a time; a change made meanwhile is written after it (tdesktop changedWhileSaving).
  private readonly writing = new Map<string, Promise<void>>()
  private readonly unsent = new Set<string>()
  private readonly written = new Map<string, { at: CommitTime; when: number }>()
  private present = new Set<string>()
  // The listener has just started: its first snapshot is every copy there is (getAllDrafts).
  private fresh = false

  constructor(private readonly uid: string, private readonly open: () => CloudDraftSource, private readonly allowed: () => void,
    private readonly host: CloudDraftHost, private readonly now = Date.now, private readonly delay = cloudDraftDelay) {}

  resume(): void {
    if (this.closed || this.locked || this.stop) return
    try { this.allowed() } catch { return }
    this.source ??= this.open()
    this.fresh = true
    this.stop = this.source.watch(cloudDraftTarget(this.uid), rows => { if (!this.closed && this.stop) this.receive(rows) })
    this.retryNow()
  }
  pause(): void {
    this.stop?.(); this.stop = null
    this.source?.close(); this.source = null
  }
  setLocked(locked: boolean): void {
    if (this.locked === locked) return
    this.locked = locked
    if (locked) this.pause(); else this.resume()
  }
  close(): void {
    this.closed = true
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear(); this.pause()
    this.server.clear(); this.wanted.clear(); this.unsent.clear(); this.written.clear(); this.present.clear()
  }

  // The field changed (outbox saveDraft): the copy follows a second after the last change, at once when asked (the room
  // is left, the app goes away), and a blank field deletes it.
  changed(chatId: string, text: string, now = false): void {
    if (this.closed || !this.host.eligible(chatId)) return
    const value = cloudDraftValue(text)
    if (!this.writing.has(chatId) && !this.unsent.has(chatId) && this.server.get(chatId) === value) { this.wanted.delete(chatId); this.cancel(chatId); return }
    this.wanted.set(chatId, value)
    this.cancel(chatId)
    if (now) { void this.go(chatId); return }
    this.timers.set(chatId, setTimeout(() => { this.timers.delete(chatId); void this.go(chatId) }, this.delay))
  }
  // The room is left (tdesktop SessionController::setActiveChatEntry → saveCurrentDraftToCloud): a change still waiting
  // goes now, and so does a field that kept its own text over a copy that came while the room was open (contract §11 ⑦,
  // iOS ComposerDraftMerge «hold»: leaving, the field's text wins and goes up over it).
  push(chatId: string): void {
    if (this.timers.has(chatId)) { void this.go(chatId); return }
    void this.leave(chatId).catch(() => {})
  }
  private async leave(chatId: string): Promise<void> {
    if (this.closed || !this.host.eligible(chatId) || this.writing.has(chatId) || !this.server.has(chatId)) return
    const local = await this.host.state(chatId)
    if (this.closed || this.timers.has(chatId) || this.writing.has(chatId)) return
    if (this.server.get(chatId) !== cloudDraftValue(local.text)) this.changed(chatId, local.text, true)
  }
  // Telegram clears the cloud draft in the send itself (clear_draft, apiwrap.cpp:4616); Morse deletes it after the send
  // whenever the server may hold one — a write still on its way included, which may land after (Android CloudDraftCopy).
  sent(chatId: string): void {
    if (this.closed || !this.host.eligible(chatId)) return
    this.cancel(chatId)
    if (this.server.get(chatId) === '' && !this.writing.has(chatId) && !this.unsent.has(chatId)) { this.wanted.delete(chatId); return }
    this.wanted.set(chatId, ''); void this.go(chatId)
  }
  // Quitting: every waiting change goes now, and the writes are waited for.
  async flush(): Promise<void> {
    for (const chatId of [...this.timers.keys()]) void this.go(chatId)
    await Promise.all([...this.writing.values()])
  }
  // The network is back (reachability.ts), or the account listens again.
  retryNow(): void { for (const chatId of [...this.unsent]) void this.go(chatId) }

  private cancel(chatId: string): void {
    const timer = this.timers.get(chatId)
    if (timer) { clearTimeout(timer); this.timers.delete(chatId) }
  }
  private go(chatId: string): Promise<void> {
    this.cancel(chatId)
    const running = this.writing.get(chatId)
    if (running) return running
    const run: Promise<void> = Promise.resolve().then(async () => {
      for (;;) {
        const value = this.wanted.get(chatId)
        if (value === undefined || this.closed) return
        if (!this.unsent.has(chatId) && this.server.get(chatId) === value) { this.wanted.delete(chatId); return }
        const source = this.locked ? null : this.source
        if (!source) { this.unsent.add(chatId); return }
        this.wanted.delete(chatId)
        try {
          const at = await source.write(chatId, value)
          this.server.set(chatId, value); this.unsent.delete(chatId)
          this.written.set(chatId, { at, when: this.now() })
          void this.host.markSynced(chatId, value).catch(() => {})
        } catch (error) {
          // What the server holds is not known now: a send deletes whatever it is.
          this.server.delete(chatId)
          if (error instanceof ComposerDraftWriteFailure && !error.retry) { this.unsent.delete(chatId); continue }
          if (!this.wanted.has(chatId)) this.wanted.set(chatId, value)
          this.unsent.add(chatId); return
        }
      }
    }).finally(() => { if (this.writing.get(chatId) === run) this.writing.delete(chatId) })
    this.writing.set(chatId, run)
    return run
  }

  private receive(rows: Iterable<FirestoreDocument>): void {
    const next = cloudDraftRows(this.uid, rows), seen = this.present, fresh = this.fresh
    this.present = new Set(next.keys()); this.fresh = false
    for (const [chatId, row] of next) if (row.text !== null) this.arrived(chatId, row.text, row.at, row.updatedAt)
    for (const chatId of seen) if (!next.has(chatId)) this.arrived(chatId, '', null, null)
    if (fresh) void this.catchUp(new Set(next.keys())).catch(() => {})
  }
  // tdesktop History::skipCloudDraftUpdate (history.cpp:451-466): a chat this device is writing, or wrote a moment ago
  // with a later time than what arrives, keeps its own copy — this is how this device's own write coming back, or an
  // older one overtaken by it, is not applied again.
  private arrived(chatId: string, text: string, at: CommitTime | null, updatedAt: number | null): void {
    if (this.writing.has(chatId) || this.timers.has(chatId) || this.unsent.has(chatId)) return
    const last = this.written.get(chatId)
    if (last && (at === null ? this.now() - last.when < skipAfterWrite : at <= last.at)) return
    if (this.server.get(chatId) === text) return
    this.server.set(chatId, text)
    if (this.host.eligible(chatId)) void this.settle(chatId, text, updatedAt).catch(() => {})
  }
  // A draft on this device that the first snapshot does not name has no copy on the server: deleted on another device
  // while this one was away if it is still as last synced, else typed here and not yet up (contract §11 ⑥).
  private async catchUp(present: Set<string>): Promise<void> {
    for (const row of await this.host.unsynced()) {
      if (this.closed || present.has(row.chatId) || !this.host.eligible(row.chatId)) continue
      if (cloudDraftValue(row.text) === '') continue
      if (!this.server.has(row.chatId)) this.server.set(row.chatId, '')
      await this.settle(row.chatId, '', null).catch(() => {})
    }
  }
  // Contract §5·§11 ⑥. Telegram Android's applyDraftMaybe takes a draft into the field only while it is empty; a chat not
  // on screen takes it into this device's draft the same way (tdesktop createLocalDraftFromCloud) when that draft is empty
  // or still as it last matched the server. Otherwise — typed here since, or what it last matched not known — the one
  // edited later wins: the server's copy if this device's draft is no newer than its updatedAt (a draft from before B530
  // has no time and counts as older), else this device's draft stays and goes up again. A deletion carries no time, so
  // it clears only a draft still as it last matched (§11 ②).
  private async settle(chatId: string, text: string, updatedAt: number | null): Promise<void> {
    const local = await this.host.state(chatId)
    if (this.closed || this.server.get(chatId) !== text || this.timers.has(chatId) || this.writing.has(chatId)) return
    const mine = cloudDraftValue(local.text)
    if (mine === text) { await this.host.markSynced(chatId, text); return }
    if (this.host.open(chatId)) {
      // The field decides (compose.tsx); a deletion it does not take leaves text typed here, which goes up again.
      this.host.show(chatId, text, local.synced); await this.host.markSynced(chatId, text)
      if (text === '' && mine !== local.synced) this.changed(chatId, local.text, true)
      return
    }
    const take = mine === '' ? text !== ''
      : local.synced !== null && mine === local.synced ? true
      : text !== '' && updatedAt !== null && (local.editedAt ?? 0) <= updatedAt
    if (take) { await this.host.adopt(chatId, text); return }
    // This device's draft stays: it goes up over the copy (its last match is now the copy it goes over).
    await this.host.markSynced(chatId, text)
    this.changed(chatId, local.text, true)
  }
}
