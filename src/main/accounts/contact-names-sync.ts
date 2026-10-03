import type { FirestoreReader } from '../network/firestore-rpc'
import { childId, documentVersion, documents, type FirestoreDocument } from '../network/firestore-values'
import type { ContactDetailsCommand, PendingContactName, ServerContactName } from '../storage/contact-details-table'
import { contactNameLimit, contactNoteLimit } from '../../shared/contact-details'
import { recordContactStep } from '../platform/contact-diagnostics'

// Contract A11: the name and note this account saved for a person live on the server, users/{me}/contactNames/{peer}
// (only the account itself reads it), so every device of the account shows the same name (Telegram R-61:
// contacts.addContact carries the edited name to the server). The collection is listened to: what it says becomes
// this device's copy, unless a save of this device is still on its way. A save goes to the device first and then to
// the server, again after a failure the server did not refuse (B63), under the same operation id. Nothing is sent before the server's list has been
// read once, so a name saved on this device alone before A11 goes up only where the server has none (A11 §4).
export function contactNameRetryDelay(attempt: number): number { return Math.min(60000, 2000 * 2 ** Math.max(0, attempt - 1)) }
export function decodeContactNames(rows: Iterable<FirestoreDocument>, uid: string): ServerContactName[] {
  const parent = `${documents}/users/${uid}/contactNames`, names: ServerContactName[] = []
  for (const doc of rows) {
    try {
      const peer = childId(doc.name, parent), name = doc.fields.name?.stringValue, note = doc.fields.note?.stringValue ?? ''
      if (typeof name !== 'string' || typeof note !== 'string' || name.length > contactNameLimit || note.length > contactNoteLimit) continue
      names.push({ uid: peer, name: name.trim(), note: note.trim(), version: documentVersion(doc) })
    } catch { /* Not a saved name this device can read. */ }
  }
  return names
}

// B63 (Telegram EditContactBox, edit_contact_box.cpp:105-123: the name changes only once contacts.addContact is done):
// a save the server refused for good — not allowed (a banned account) or not acceptable — is not sent again, and the
// server's name comes back. A save whose fate is unknown (no answer, the network) goes again, and so does one whose
// sign-in lapsed (UNAUTHENTICATED, 16): the session renews it, the save is still good.
export function contactNameRefused(error: unknown): boolean {
  const failure = error as { uncertain?: unknown; code?: unknown } | null
  return failure?.uncertain === false && typeof failure.code === 'number' && failure.code !== 16
}

type NamesReader = Pick<FirestoreReader, 'watch' | 'setContactName'>
export class ContactNamesSync {
  private reader: NamesReader | null = null
  private signal: AbortSignal = new AbortController().signal
  private stop: (() => void) | null = null
  private read = false
  // The server's list as last read: what a refused save goes back to.
  private server: ServerContactName[] = []
  private running = false
  private rerun = false
  private attempt = 0
  private wake: ReturnType<typeof setTimeout> | null = null
  private generation = 0
  private closed = false

  constructor(private readonly uid: string, private readonly store: <T>(command: ContactDetailsCommand) => Promise<T>,
    // The device's copy now has the server's names: labels and an open profile read it again.
    private readonly merged: () => void) {}

  bind(reader: NamesReader | null, signal: AbortSignal): void {
    this.stop?.(); this.stop = null; this.generation++; this.read = false; this.server = []; this.unschedule()
    this.reader = this.closed ? null : reader; this.signal = signal
    if (!this.reader) return
    const generation = this.generation
    this.stop = this.reader.watch({ query: { parent: `${documents}/users/${this.uid}`, structuredQuery: { from: [{ collectionId: 'contactNames' }] } } }, signal, {
      snapshot: rows => {
        if (generation !== this.generation) return
        const entries = decodeContactNames(rows.values(), this.uid)
        this.server = entries
        void this.store({ kind: 'contact-name-server', entries }).then(() => {
          if (generation !== this.generation) return
          this.read = true; this.merged(); this.kick()
        }).catch(() => recordContactStep('contact-names', 'merge-failed'))
      },
      // The same list is read again; what the device has stays.
      reconnecting: () => {},
      state: (state, error) => { if (generation === this.generation && state === 'error') recordContactStep('contact-names', `watch-${error?.code ?? 'error'}`) }
    }, 10000, 4 * 1024 * 1024)
  }
  // A save on this device, or the list read: send what waits.
  kick(): void {
    if (this.closed || !this.reader || !this.read || this.wake) return
    if (this.running) { this.rerun = true; return }
    this.running = true
    const generation = this.generation, reader = this.reader, signal = this.signal
    void (async () => {
      try {
        const pending = await this.store<PendingContactName[]>({ kind: 'contact-name-pending' })
        let refused = false
        for (const row of pending) {
          if (generation !== this.generation) return
          try {
            await reader.setContactName(this.uid, row.uid, { name: row.nickname, note: row.note, operationId: row.operationId }, signal)
          } catch (error) {
            if (!contactNameRefused(error)) throw error
            // Refused for good: back to the server's name, and the saves after it still go.
            recordContactStep('contact-names', `refused-${(error as { code?: unknown }).code}`)
            await this.store({ kind: 'contact-name-refused', uid: row.uid, operationId: row.operationId, entries: this.server })
            refused = true
            continue
          }
          await this.store({ kind: 'contact-name-uploaded', uid: row.uid, operationId: row.operationId })
        }
        this.attempt = 0
        if (refused && generation === this.generation) this.merged()
      } catch (error) {
        // Not sent or not known: it stays pending and goes again, the same save under the same id.
        this.attempt++
        recordContactStep('contact-names', `upload-${(error as { code?: unknown })?.code ?? 'failed'}`)
        if (generation === this.generation && !this.closed) this.wake = setTimeout(() => { this.wake = null; this.kick() }, contactNameRetryDelay(this.attempt))
      } finally {
        this.running = false
        if (this.rerun) { this.rerun = false; this.kick() }
      }
    })()
  }
  private unschedule(): void { if (this.wake) { clearTimeout(this.wake); this.wake = null } }
  close(): void { this.closed = true; this.bind(null, new AbortController().signal) }
}
