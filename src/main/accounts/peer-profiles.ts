import type { FirestoreReader } from '../network/firestore-rpc'
import { boolField, documents, stringField, type FirestoreDocument } from '../network/firestore-values'
import type { ContactSummary } from '../../shared/contacts'
import { recordAvatarStep } from '../platform/avatar-diagnostics'
import { userpicCacheFor, type UserpicCache } from './userpic-cache'

// Data::Session holds one PeerData for every person, fed by one stream of peer data, and every row, box and profile
// paints from it: no screen opens a read of its own, and scrolling opens nothing. Morse reads the same three things —
// the person's current name, their picture and whether they still have this account as a contact — for every contact
// of this account, ten documents a target as the channel list reads its channels (users/{uid} costs its rule one
// exists() call; the reciprocal document costs none). users/{me}/contacts/{uid}.displayName is only the name copied
// when the contact was added (iOS MorseUser.fromContactCache), which nothing rewrites when the person renames.
export const peerProfileGroup = 5

export interface PeerProfile { name: string; photo: string; mutual: boolean }
export function decodePeerProfile(doc: FirestoreDocument | undefined, mutual: boolean): PeerProfile | null {
  if (!doc || boolField(doc.fields, 'accountDeleted')) return null
  const name = stringField(doc.fields, 'displayName', 512).trim()
  if (!name) return null
  return { name, photo: mutual ? stringField(doc.fields, 'photoURL', 10000) : '', mutual }
}
// The name on this device's alias first, then the person's current name, then the copy in the contact document.
export function contactNames(item: ContactSummary, label: string | undefined, current: string): { displayName: string; originalName: string } {
  const originalName = current || item.displayName
  return { displayName: label || originalName, originalName }
}

interface Group { uids: string[]; failed: boolean; answered: boolean; stop(): void }
export class PeerProfiles {
  private reader: FirestoreReader | null = null
  private groups: Group[] = []
  private profiles = new Map<string, PeerProfile | null>()
  private answered = new Set<string>()
  private closed = false
  private readonly cache: UserpicCache | null
  constructor(private readonly uid: string, auth: object, private readonly signal: AbortSignal, private readonly changed: () => void) {
    this.cache = userpicCacheFor(auth)
  }

  // What this account knows about the person now, or null while nothing has been read.
  profile(uid: string): PeerProfile | null { return this.closed ? null : this.profiles.get(uid) ?? null }
  // Whether the read for this person has answered at all: until it has, a row draws the picture last confirmed.
  hasAnswer(uid: string): boolean { return !this.closed && this.answered.has(uid) }
  name(uid: string): string { return this.profile(uid)?.name ?? '' }
  photo(uid: string): string { return this.profile(uid)?.photo ?? '' }

  // A contact added or removed restarts only its own target; the others keep what they know.
  bind(reader: FirestoreReader | null, uids: Iterable<string>): void {
    if (this.closed) return
    const wanted = new Set(uids)
    if (reader !== this.reader) { this.stopAll(); this.reader = reader }
    if (!reader) return
    this.groups = this.groups.filter(group => {
      if (!group.failed && group.uids.every(uid => wanted.has(uid))) return true
      group.stop()
      for (const uid of group.uids) if (!wanted.has(uid)) { this.profiles.delete(uid); this.answered.delete(uid) }
      return false
    })
    const assigned = new Set(this.groups.flatMap(group => group.uids))
    const free = [...wanted].filter(uid => !assigned.has(uid)).sort()
    for (let offset = 0; offset < free.length; offset += peerProfileGroup) this.watch(reader, free.slice(offset, offset + peerProfileGroup))
  }
  private watch(reader: FirestoreReader, uids: string[]): void {
    const names = new Map<string, { uid: string; reciprocal: string }>()
    for (const uid of uids) names.set(`${documents}/users/${uid}`, { uid, reciprocal: `${documents}/users/${uid}/contacts/${this.uid}` })
    const paths = [...names.keys(), ...[...names.values()].map(entry => entry.reciprocal)]
    const group: Group = { uids, failed: false, answered: false, stop: () => {} }
    this.groups.push(group)
    const current = (): boolean => !this.closed && this.groups.includes(group)
    group.stop = reader.watch({ documents: { documents: paths } }, this.signal, {
      snapshot: rows => {
        if (!current()) return
        if ([...rows.keys()].some(name => !paths.includes(name))) { this.fail(group, 'profile-scope-mismatch'); return }
        group.answered = true
        let changed = false
        for (const [root, entry] of names) {
          const next = decodePeerProfile(rows.get(root), rows.has(entry.reciprocal))
          const previous = this.profiles.get(entry.uid) ?? null
          this.cache?.confirm(`user:${entry.uid}`, next?.photo || null)
          if (!this.answered.has(entry.uid)) { this.answered.add(entry.uid); changed = true }
          if (previous?.name === next?.name && previous?.photo === next?.photo && previous?.mutual === next?.mutual) continue
          this.profiles.set(entry.uid, next); changed = true
          recordAvatarStep('contacts', entry.uid, !next ? 'profile-not-usable' : !next.mutual ? 'not-mutual-contact' : !next.photo ? 'no-photo-address' : 'photo-address-found')
        }
        if (changed) this.changed()
      },
      // A stream renewal or network retry reads the same documents again; what is known stays until then.
      reconnecting: () => {},
      state: (state, error) => { if (current() && state === 'error') this.fail(group, `profile-watch-error:${error?.code ?? ''}`) }
    }, paths.length, 4 * 1024 * 1024)
  }
  // A refused read leaves the people of that target unknown: their rows fall back to the saved name and picture.
  private fail(group: Group, step: string): void {
    group.failed = true; group.stop()
    let changed = false
    for (const uid of group.uids) {
      recordAvatarStep('contacts', uid, step)
      const hadProfile = this.profiles.delete(uid), hadAnswer = this.answered.delete(uid)
      changed = hadProfile || hadAnswer || changed
    }
    if (changed) this.changed()
  }
  private stopAll(): void {
    for (const group of this.groups) group.stop()
    this.groups = []
  }
  clear(): void { this.stopAll(); this.reader = null; this.profiles.clear(); this.answered.clear() }
  close(): void { this.closed = true; this.clear() }
}

// A row reaches its account's peer data through the credentials every loader is given.
const registry = new WeakMap<object, PeerProfiles>()
export function registerPeerProfiles(credentials: object, profiles: PeerProfiles): void { registry.set(credentials, profiles) }
export function peerProfilesFor(credentials: object): PeerProfiles | null { return registry.get(credentials) ?? null }
