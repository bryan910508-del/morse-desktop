import { maxFolders, type ChatFolder } from '../../shared/chat-folders'
import { decodeChatFolder } from '../api/account-tools'
import { FirestoreReader, type ReadCredentials } from '../network/firestore-rpc'
import { documents, type FirestoreDocument } from '../network/firestore-values'

// The account's chat folders as they are now: a folder made, renamed, reordered or emptied on another
// device shows here at once, the way Telegram's dialog filters follow updateDialogFilter. iOS keeps
// them in users/{uid}/folders and listens the same way.
export function chatFolderList(uid: string, rows: Iterable<FirestoreDocument>): ChatFolder[] {
  return [...rows].flatMap(doc => { try { return [decodeChatFolder(doc, uid)] } catch { return [] } })
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)).slice(0, maxFolders)
}

export class ChatFolderWatch {
  private reader: FirestoreReader | null = null
  private stop: (() => void) | null = null
  private rows: Map<string, FirestoreDocument> | null = null
  private locked = false
  private closed = false

  constructor(private readonly uid: string, private readonly auth: ReadCredentials,
    private readonly allowed: () => void, private readonly changed: () => void) {}

  resume(): void {
    if (this.closed || this.locked || this.stop) return
    try { this.allowed() } catch { return }
    this.reader ??= new FirestoreReader(this.auth)
    this.stop = this.reader.watch({ query: { parent: `${documents}/users/${this.uid}`, structuredQuery: { from: [{ collectionId: 'folders' }] } } }, this.auth.signal, {
      snapshot: next => {
        if (this.closed || !this.stop) return
        this.rows = new Map(next)
        this.changed()
      },
      // A dropped listener keeps the folders on screen; the next snapshot replaces them.
      state: () => {}
    }, maxFolders * 2, 4 * 1024 * 1024)
  }
  pause(): void {
    this.stop?.(); this.stop = null
    this.reader?.close(); this.reader = null
  }
  setLocked(locked: boolean): void {
    if (this.locked === locked) return
    this.locked = locked
    if (locked) { this.pause(); this.rows = null } else this.resume()
    this.changed()
  }
  close(): void { this.closed = true; this.pause(); this.rows = null }

  // Reading only. Until the first snapshot there is nothing to say, and the list keeps what it read.
  snapshot(): ChatFolder[] | null {
    if (this.closed || this.locked || !this.rows) return null
    try { return chatFolderList(this.uid, this.rows.values()) } catch { return null }
  }
}
