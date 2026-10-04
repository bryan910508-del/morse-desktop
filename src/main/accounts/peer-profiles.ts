import type { FirestoreReader } from '../network/firestore-rpc'
import { boolField, documents, stringField, type FirestoreDocument } from '../network/firestore-values'
import type { ContactSummary } from '../../shared/contacts'
import { recordAvatarStep } from '../platform/avatar-diagnostics'
import { userpicCacheFor, type UserpicCache } from './userpic-cache'
import type { OfficialKind } from '../../shared/model'

// Data::Session holds one PeerData for every person, fed by one stream of peer data, and every row, box and profile
// paints from it: no screen opens a read of its own, and scrolling opens nothing. Morse reads the same three things —
// the person's current name, their picture and whether they still have this account as a contact — for every contact
// of this account, ten documents a target as the channel list reads its channels. users/{me}/contacts/{uid}.displayName
// is only the name copied when the contact was added (iOS MorseUser.fromContactCache), which nothing rewrites when the
// person renames.
export const peerProfileGroup = 5
// A7 §3-1: what others may see of a person is the public profile the server makes from their account document
// (syncMorsePublicProfile) — userId, displayName, photoURL, bio, publicKey, personalChannelId, accountDeleted. The
// account document itself is the person's own, and A7 §3-2 closes it to everyone else (Telegram: users.getFullUser
// hands out what the person's privacy settings allow, never the settings or the account). No document yet means the
// server has not made it: the person is unknown, not gone.
export function publicProfilePath(uid: string): string { return `${documents}/publicProfiles/${uid}` }

// A13 §9-2 (Telegram's `support` flag on the support account): `official: 'support'` is written by the server only;
// the badge is drawn from it alone, never from a name that says «Morse».
export type { OfficialKind }
// B111: the field's two values, nothing else (contracts/B111 §5-6).
export const officialKind = (value: string): OfficialKind | null => value === 'support' || value === 'system' ? value : null
export interface PeerProfile { name: string; photo: string; mutual: boolean; official: OfficialKind | null }
export function decodePeerProfile(doc: FirestoreDocument | undefined, mutual: boolean): PeerProfile | null {
  if (!doc || boolField(doc.fields, 'accountDeleted')) return null
  const name = stringField(doc.fields, 'displayName', 512).trim()
  if (!name) return null
  return { name, photo: mutual ? stringField(doc.fields, 'photoURL', 10000) : '', mutual, official: officialKind(stringField(doc.fields, 'official', 32)) }
}
// The name on this device's alias first, then the person's current name, then the copy in the contact document.
export function contactNames(item: ContactSummary, label: string | undefined, current: string): { displayName: string; originalName: string } {
  const originalName = current || item.displayName
  return { displayName: label || originalName, originalName }
}

interface Group { uids: string[]; failed: boolean; answered: boolean; stop(): void }
// Whose profiles are read: this account's contacts (with whether each still has this account as a contact, which the
// picture waits on), or the authors of the comments on screen (A8 §4, Telegram R-41: a comment shows its author as
// they are now, their public name and picture, whoever they are to this account).
export type PeerProfileKind = 'contacts' | 'authors'
export class PeerProfiles {
  private reader: FirestoreReader | null = null
  private groups: Group[] = []
  private profiles = new Map<string, PeerProfile | null>()
  private answered = new Set<string>()
  private gone = new Set<string>()
  private closed = false
  private readonly cache: UserpicCache | null
  constructor(private readonly uid: string, auth: object, private readonly signal: AbortSignal, private readonly changed: () => void,
    // ProfilePhotoHistory.save: the address of a picture this device has just seen of this person.
    private readonly seen?: (uid: string, raw: string) => void, private readonly kind: PeerProfileKind = 'contacts') {
    // A contact's picture as this account may see it is what a row draws first next time; an author's is not that.
    this.cache = kind === 'contacts' ? userpicCacheFor(auth) : null
  }

  // What this account knows about the person now, or null while nothing has been read.
  profile(uid: string): PeerProfile | null { return this.closed ? null : this.profiles.get(uid) ?? null }
  // Whether the read for this person has answered at all: until it has, a row draws the picture last confirmed.
  hasAnswer(uid: string): boolean { return !this.closed && this.answered.has(uid) }
  name(uid: string): string { return this.profile(uid)?.name ?? '' }
  // The person's public profile says the account was deleted.
  withdrawn(uid: string): boolean { return !this.closed && this.gone.has(uid) }
  photo(uid: string): string { return this.profile(uid)?.photo ?? '' }
  official(uid: string): OfficialKind | null { return this.profile(uid)?.official ?? null }

  // A contact added or removed restarts only its own target; the others keep what they know.
  bind(reader: FirestoreReader | null, uids: Iterable<string>): void {
    if (this.closed) return
    const wanted = new Set(uids)
    if (reader !== this.reader) { this.stopAll(); this.reader = reader }
    if (!reader) return
    this.groups = this.groups.filter(group => {
      // A person whose read was refused stays unknown until the reader changes: asking again with every change of the
      // contact list would only be refused again.
      if (group.uids.every(uid => wanted.has(uid))) return true
      group.stop()
      for (const uid of group.uids) if (!wanted.has(uid)) { this.profiles.delete(uid); this.answered.delete(uid); this.gone.delete(uid) }
      return false
    })
    const assigned = new Set(this.groups.flatMap(group => group.uids))
    const free = [...wanted].filter(uid => !assigned.has(uid)).sort()
    for (let offset = 0; offset < free.length; offset += peerProfileGroup) this.watch(reader, free.slice(offset, offset + peerProfileGroup))
  }
  private watch(reader: FirestoreReader, uids: string[]): void {
    const names = new Map<string, { uid: string; reciprocal: string }>()
    for (const uid of uids) names.set(publicProfilePath(uid), { uid, reciprocal: `${documents}/users/${uid}/contacts/${this.uid}` })
    const paths = [...names.keys(), ...(this.kind === 'contacts' ? [...names.values()].map(entry => entry.reciprocal) : [])]
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
          const doc = rows.get(root), next = decodePeerProfile(doc, this.kind === 'authors' || rows.has(entry.reciprocal))
          const previous = this.profiles.get(entry.uid) ?? null, wasGone = this.gone.has(entry.uid)
          if (doc && boolField(doc.fields, 'accountDeleted')) this.gone.add(entry.uid); else this.gone.delete(entry.uid)
          this.cache?.confirm(`user:${entry.uid}`, next?.photo || null)
          if (next?.photo && this.kind === 'contacts') this.seen?.(entry.uid, next.photo)
          if (!this.answered.has(entry.uid)) { this.answered.add(entry.uid); changed = true }
          if (wasGone !== this.gone.has(entry.uid)) changed = true
          if (previous?.name === next?.name && previous?.photo === next?.photo && previous?.mutual === next?.mutual) continue
          this.profiles.set(entry.uid, next); changed = true
          recordAvatarStep(this.kind, entry.uid, !next ? 'profile-not-usable' : !next.mutual ? 'not-mutual-contact' : !next.photo ? 'no-photo-address' : 'photo-address-found')
        }
        if (changed) this.changed()
      },
      // A stream renewal or network retry reads the same documents again; what is known stays until then.
      reconnecting: () => {},
      state: (state, error) => { if (current() && state === 'error') this.fail(group, `profile-watch-error:${error?.code ?? ''}`) }
    }, paths.length, 4 * 1024 * 1024)
  }
  // A refused read leaves the people of that target unknown: their rows fall back to the saved name and picture. A
  // target fails as a whole when one of its documents is refused, so a shared one is split first and each person read
  // on their own: one person's refusal does not leave the others beside them unknown.
  private fail(group: Group, step: string): void {
    group.failed = true; group.stop()
    if (group.uids.length > 1 && this.reader && !this.closed) {
      this.groups = this.groups.filter(item => item !== group)
      for (const uid of group.uids) { recordAvatarStep(this.kind, uid, `${step}:split`); this.watch(this.reader, [uid]) }
      return
    }
    let changed = false
    for (const uid of group.uids) {
      recordAvatarStep(this.kind, uid, step)
      const hadProfile = this.profiles.delete(uid), hadAnswer = this.answered.delete(uid), wasGone = this.gone.delete(uid)
      changed = hadProfile || hadAnswer || wasGone || changed
    }
    if (changed) this.changed()
  }
  private stopAll(): void {
    for (const group of this.groups) group.stop()
    this.groups = []
  }
  clear(): void { this.stopAll(); this.reader = null; this.profiles.clear(); this.answered.clear(); this.gone.clear() }
  close(): void { this.closed = true; this.clear() }
}

// A row reaches its account's peer data through the credentials every loader is given.
const registry = new WeakMap<object, PeerProfiles>()
export function registerPeerProfiles(credentials: object, profiles: PeerProfiles): void { registry.set(credentials, profiles) }
export function peerProfilesFor(credentials: object): PeerProfiles | null { return registry.get(credentials) ?? null }
