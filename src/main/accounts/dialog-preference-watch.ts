import { FirestoreReader, type ReadCredentials } from '../network/firestore-rpc'
import { documents, documentVersion, type FirestoreDocument, type WireObject } from '../network/firestore-values'

// The account's «알림 끄기» / «보관» per chat as every device writes them: users/{uid}/settings/dialog_{chatId}
// with kind «dialogPreference» (Android AccountDialogPreferenceSync, iOS MorseDialogMuteSync, which listens to
// this same query). Telegram keeps peer notification settings on the account and each client follows
// updateNotifySettings, so a chat muted on the phone is muted here too.
export interface DialogPreference { chatId: string; muted: boolean; archived: boolean | null; operationId: string | null; version: string }
export const maxDialogPreferences = 5000
// This device's own write that has not come back yet. Another device may overwrite it before it is seen,
// so the wait ends after a while and the account document is followed again.
const pendingLifetime = 60000

export function dialogPreferences(uid: string, rows: Iterable<FirestoreDocument>): Map<string, DialogPreference> {
  const result = new Map<string, DialogPreference>()
  for (const doc of rows) {
    const f = doc.fields, chatId = f.chatId?.stringValue
    if (typeof chatId !== 'string' || !chatId || chatId.length > 256 || f.kind?.stringValue !== 'dialogPreference') continue
    if (doc.name !== `${documents}/users/${uid}/settings/dialog_${chatId}`) continue
    const archived = f.isArchived?.booleanValue
    result.set(chatId, { chatId, muted: f.isMuted?.booleanValue === true, archived: typeof archived === 'boolean' ? archived : null,
      operationId: typeof f.operationId?.stringValue === 'string' ? f.operationId.stringValue : null, version: documentVersion(doc) })
  }
  return result
}

// users/{uid}/settings where kind == dialogPreference, the query iOS MorseDialogMuteSync listens to.
export function dialogPreferenceTarget(uid: string): WireObject {
  return { query: { parent: `${documents}/users/${uid}`, structuredQuery: { from: [{ collectionId: 'settings' }],
    where: { fieldFilter: { field: { fieldPath: 'kind' }, op: 'EQUAL', value: { stringValue: 'dialogPreference' } } } } } }
}

export class DialogPreferenceWatch {
  private reader: FirestoreReader | null = null
  private stop: (() => void) | null = null
  private readonly applied = new Map<string, string>()
  private readonly pending = new Map<string, { operationId: string; at: number }>()
  private locked = false
  private closed = false

  constructor(private readonly uid: string, private readonly auth: ReadCredentials, private readonly allowed: () => void,
    private readonly apply: (chatId: string, patch: { muted: boolean; archived?: boolean }) => void, private readonly now = Date.now) {}

  resume(): void {
    if (this.closed || this.locked || this.stop) return
    try { this.allowed() } catch { return }
    this.reader ??= new FirestoreReader(this.auth)
    this.stop = this.reader.watch(dialogPreferenceTarget(this.uid), this.auth.signal, {
      snapshot: next => { if (!this.closed && this.stop) this.receive(next.values()) },
      // The chats keep what this device holds while the listener reconnects.
      state: () => {}
    }, maxDialogPreferences, 8 * 1024 * 1024)
  }
  pause(): void {
    this.stop?.(); this.stop = null
    this.reader?.close(); this.reader = null
  }
  setLocked(locked: boolean): void {
    if (this.locked === locked) return
    this.locked = locked
    if (locked) this.pause(); else this.resume()
  }
  close(): void { this.closed = true; this.pause(); this.applied.clear(); this.pending.clear() }

  // A change made here is already in the list; until the account document shows it, older snapshots
  // must not take it back.
  wrote(chatId: string, operationId: string): void { this.pending.set(chatId, { operationId, at: this.now() }) }
  writeFailed(chatId: string, operationId: string): void { if (this.pending.get(chatId)?.operationId === operationId) this.pending.delete(chatId) }

  private receive(rows: Iterable<FirestoreDocument>): void {
    for (const preference of dialogPreferences(this.uid, rows).values()) {
      const waiting = this.pending.get(preference.chatId)
      if (waiting && this.now() - waiting.at > pendingLifetime) this.pending.delete(preference.chatId)
      else if (waiting) {
        if (preference.operationId !== waiting.operationId) continue
        this.pending.delete(preference.chatId); this.applied.set(preference.chatId, preference.version); continue
      }
      if (this.applied.get(preference.chatId) === preference.version) continue
      this.applied.set(preference.chatId, preference.version)
      this.apply(preference.chatId, { muted: preference.muted, ...(preference.archived === null ? {} : { archived: preference.archived }) })
    }
  }
}
