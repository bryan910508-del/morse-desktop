import { maxStoryBarPeers, storyBarPeers, type StoryBarEntry, type StoryBarResult } from '../../shared/story-bar'
import type { StoryPrivacy } from '../../shared/own-stories'
import { positionAt, positionMilliseconds } from '../../shared/model'
import { FirestoreReader, type ReadCredentials } from '../network/firestore-rpc'
import type { ListenTargets } from '../network/firestore-listen'
import { documents, positionValue, type FirestoreDocument, type WireObject } from '../network/firestore-values'
import { recordStoryStep } from '../platform/story-diagnostics'
import { ownStoryCollections, ownStoryFromDocument } from '../network/own-story-document'
import { storyHiddenFrom } from '../network/story-hidden-audience'
import { tr } from '../../shared/i18n'

interface Tally { count: number; unseen: number; latestAt: number; expiresAt: number }
// One listened list of one person's stories: what it last answered, kept while it listens again (Telegram R-59,
// data_stories.cpp keeps what it has when a load fails) and dropped only when the server refuses it.
interface Listened { stop(): void; docs: ReadonlyMap<string, FirestoreDocument>; answered: boolean; failed: boolean }

// Dialogs::Stories source, following iOS ChatListView.loadUserStories: each owner's active stories as the viewer may
// list them — public stories for every contact, contacts-only stories when the owner lists this viewer, and all three
// of this account's own.
// B277 ②: Telegram's server pushes story changes (updateStory, updatePeerStories) and the client asks again only to
// fill a gap. Morse has no such update, so each of those lists is a Firestore listen target, all over one stream
// (ListenTargets): read once, then only what changes. Whether an owner lists this viewer is the contacts' own answer
// (PeerProfiles watches users/X/contacts/{me}); when it turns false the contacts-only target goes first, before the
// server would refuse it (firestore.rules stories: exists users/{owner}/contacts/{me}). A query keeps the stories that
// expire after it was made, so every target is made again each hour, and the row drops a story as it expires.
export const storyBarRearm = 60 * 60000
export class StoryBarApi {
  private closed = false
  private locked = false
  private reader: Pick<FirestoreReader, 'close'> | null = null
  private listen: Pick<ListenTargets, 'add' | 'close' | 'tally' | 'size'> | null = null
  private readonly owners = new Map<string, Map<StoryPrivacy, Listened>>()
  private order: string[] = []
  private cutoff = 0
  private rearmTimer: ReturnType<typeof setTimeout> | undefined
  private expiryTimer: ReturnType<typeof setTimeout> | undefined
  private notifyTimer: ReturnType<typeof setTimeout> | undefined
  private logTimer: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly uid: string, private readonly auth: ReadCredentials, private readonly allowed: () => void, private readonly isContact: (uid: string) => boolean,
    // Whether a person lists this viewer as a contact — true, false, or null while it is not known yet.
    private readonly keepsMe: (uid: string) => boolean | null = () => null,
    // The row changed (a story came, went, expired or was seen).
    private readonly notify: (result: StoryBarResult) => void = () => {},
    // The reads, over Firestore; a test gives its own.
    private readonly open: () => Pick<FirestoreReader, 'listenTargets' | 'close'> = () => new FirestoreReader(auth),
    private readonly now: () => number = Date.now) {
    auth.signal.addEventListener('abort', () => this.close(), { once: true })
  }

  // The people of the row, in order, and the row as it stands. `force` listens again to lists the server refused.
  list(raw: unknown, force: boolean): Promise<StoryBarResult> {
    if (this.closed) throw new Error(tr('계정이 변경되었습니다.'))
    this.allowed()
    const peers = storyBarPeers(raw).filter(uid => uid !== this.uid && this.isContact(uid)).slice(0, maxStoryBarPeers)
    this.order = [this.uid, ...peers]
    this.bind(force)
    return Promise.resolve(this.result())
  }

  // The contacts changed: who is one and who lists this viewer.
  recheck(): void {
    if (this.closed || this.locked || !this.listen) return
    this.order = this.order.filter(owner => owner === this.uid || this.isContact(owner))
    this.bind(false)
  }

  // A locked app reads nothing and holds no stories; unlocked, the row listens again.
  setLocked(locked: boolean): void {
    if (this.closed || this.locked === locked) return
    this.locked = locked
    if (locked) this.stopAll()
    else if (this.order.length) this.bind(false)
  }

  close(): void { this.closed = true; this.stopAll() }

  private privacies(owner: string): StoryPrivacy[] {
    if (owner === this.uid) return ['everyone', 'contacts', 'closeFriends']
    return this.keepsMe(owner) === true ? ['everyone', 'contacts'] : ['everyone']
  }

  private bind(force: boolean): void {
    if (this.closed || this.locked) return
    const wanted = new Set(this.order)
    for (const [owner, lists] of this.owners) if (!wanted.has(owner)) { for (const list of lists.values()) list.stop(); this.owners.delete(owner) }
    if (!this.listen) {
      const reader = this.open()
      this.reader = reader
      this.listen = reader.listenTargets(this.auth.signal)
      this.cutoff = this.now()
      this.rearmTimer = setTimeout(() => this.rearm(), storyBarRearm)
    }
    for (const owner of this.order) {
      let lists = this.owners.get(owner)
      if (!lists) { lists = new Map(); this.owners.set(owner, lists) }
      const privacies = this.privacies(owner)
      // First what may no longer be listed, so the server never refuses it.
      for (const [privacy, list] of lists) if (!privacies.includes(privacy)) { list.stop(); lists.delete(privacy); this.changed() }
      for (const privacy of privacies) { const list = lists.get(privacy); if (!list || (force && list.failed)) this.start(owner, lists, privacy) }
    }
  }

  // Listens to one list from the present cutoff; the list it replaces stops only after, so the stream stays open.
  private start(owner: string, lists: Map<StoryPrivacy, Listened>, privacy: StoryPrivacy): void {
    if (!this.listen) return
    const previous = lists.get(privacy)
    const list: Listened = { stop: () => {}, docs: previous?.docs ?? new Map(), answered: false, failed: false }
    lists.set(privacy, list)
    const mine = (): boolean => this.owners.get(owner)?.get(privacy) === list
    list.stop = this.listen.add(this.target(owner, privacy), {
      snapshot: docs => { if (!mine()) return; list.docs = docs; list.answered = true; list.failed = false; this.changed() },
      state: (state, error) => {
        if (!mine() || state !== 'error') return
        list.answered = true; list.failed = true
        if (error?.code === 'permission') list.docs = new Map()
        this.changed()
      }
    }, 50)
    previous?.stop()
  }

  private target(owner: string, privacy: StoryPrivacy): WireObject {
    return { query: { parent: `${documents}/users/${owner}`, structuredQuery: {
      from: [{ collectionId: ownStoryCollections[privacy] }],
      where: { fieldFilter: { field: { fieldPath: 'expiresAt' }, op: 'GREATER_THAN', value: positionValue(positionAt(this.cutoff, '')) } },
      orderBy: [{ field: { fieldPath: 'expiresAt' }, direction: 'ASCENDING' }, { field: { fieldPath: 'createdAt' }, direction: 'ASCENDING' }, { field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
      limit: { value: 50 }
    } } }
  }

  // Each hour every list is made again from now, so stories that expired leave the server's answer too.
  private rearm(): void {
    if (this.closed || this.locked || !this.listen) return
    this.cutoff = this.now()
    for (const [owner, lists] of this.owners) for (const privacy of [...lists.keys()]) this.start(owner, lists, privacy)
    this.rearmTimer = setTimeout(() => this.rearm(), storyBarRearm)
    this.log('rearm')
  }

  private stopAll(): void {
    clearTimeout(this.rearmTimer); clearTimeout(this.expiryTimer); clearTimeout(this.notifyTimer); clearTimeout(this.logTimer)
    this.notifyTimer = undefined; this.logTimer = undefined
    this.listen?.close(); this.reader?.close()
    this.listen = null; this.reader = null
    this.owners.clear()
  }

  private changed(): void {
    if (this.notifyTimer || this.closed || this.locked) return
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = undefined
      if (this.closed || this.locked) return
      const result = this.result()
      this.notify(result)
      // The next story to expire takes itself off the row.
      clearTimeout(this.expiryTimer)
      const next = Math.min(...result.entries.map(entry => entry.expiresAt))
      if (Number.isFinite(next)) this.expiryTimer = setTimeout(() => this.changed(), Math.min(Math.max(0, next - this.now()) + 50, 2 ** 31 - 1))
      if (!this.logTimer) this.logTimer = setTimeout(() => { this.logTimer = undefined; this.log('listen') }, 5000)
    }, 50)
  }

  // What the stream has asked the server so far (story-check.log `bar-listen`).
  private log(reason: string): void {
    if (!this.listen) return
    const { fresh, resumed, documents: read, refused } = this.listen.tally
    recordStoryStep('bar-listen', `${reason} people=${this.order.length} targets=${this.listen.size} fresh=${fresh} resumed=${resumed} documents=${read} refused=${refused}`)
  }

  private result(): StoryBarResult {
    const at = this.now()
    const entries = this.order.flatMap(owner => { const entry = this.entry(owner, at); return entry ? [entry] : [] })
    const partial = this.order.some(owner => { const lists = this.owners.get(owner); return !lists || [...lists.values()].some(list => !list.answered) })
    return { entries, observedAt: at, partial }
  }

  private entry(owner: string, at: number): StoryBarEntry | null {
    const tally: Tally = { count: 0, unseen: 0, latestAt: 0, expiresAt: 0 }
    for (const [privacy, list] of this.owners.get(owner) ?? []) this.tally(tally, list.docs.values(), owner, privacy, at)
    return tally.count ? { uid: owner, ...tally } : null
  }

  private viewed(doc: FirestoreDocument): boolean {
    const values = (doc.fields.viewerIds as { arrayValue?: { values?: unknown } } | undefined)?.arrayValue?.values
    return Array.isArray(values) && values.some(value => typeof value === 'object' && value !== null && (value as { stringValue?: unknown }).stringValue === this.uid)
  }

  private tally(target: Tally, docs: Iterable<FirestoreDocument>, owner: string, privacy: StoryPrivacy, at: number): void {
    for (const doc of docs) {
      try {
        const story = ownStoryFromDocument(doc, owner, privacy), expiresAt = positionMilliseconds(story.expires)
        if (expiresAt <= at || (owner !== this.uid && storyHiddenFrom(doc).hiddenFrom.includes(this.uid))) continue
        target.count++
        target.latestAt = Math.max(target.latestAt, positionMilliseconds(story.created))
        target.expiresAt = target.expiresAt ? Math.min(target.expiresAt, expiresAt) : expiresAt
        if (owner !== this.uid && !this.viewed(doc)) target.unseen++
      } catch { /* A malformed story is not shown in the row. */ }
    }
  }
}
