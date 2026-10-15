import { maxStoryBarPeers, storyBarPeers, type StoryBarEntry, type StoryBarResult } from '../../shared/story-bar'
import type { StoryPrivacy } from '../../shared/own-stories'
import { positionAt, positionMilliseconds } from '../../shared/model'
import { FirestoreReader, type ReadCredentials } from '../network/firestore-rpc'
import type { ListenTargets } from '../network/firestore-listen'
import { documents, positionValue, type FirestoreDocument, type WireObject } from '../network/firestore-values'
import { recordStoryStep } from '../platform/story-diagnostics'
import { ownStoryCollections, ownStoryFromDocument } from '../network/own-story-document'
import { feedStoryFromDocument, laterMark, readMarkId, storyRead, storyReadMarkFromDocument, type FeedStory, type StoryReadMark } from '../network/story-feed-document'
import { serverNow } from '../network/server-clock'
import { feedStoryPicturePath } from '../accounts/story-media-paths'
import type { PreloadCandidate } from '../accounts/story-preloader'
import { tr } from '../../shared/i18n'

interface Tally { count: number; unseen: number; latestAt: number; expiresAt: number }
// One listened list: what it last answered, kept while it listens again (Telegram R-59, data_stories.cpp keeps what it
// has when a load fails) and dropped only when the server refuses it.
interface Listened { stop(): void; docs: ReadonlyMap<string, FirestoreDocument>; answered: boolean; failed: boolean }
type ListName = StoryPrivacy | 'feed' | 'marks'

// Dialogs::Stories source. B408 S2 (contracts/B408-stories-access.md §14): the stories of others are the server's
// choice — this account's `storyFeed` (story-feed-document.ts), one listen for everyone, as tdesktop reads the peers
// stories.getAllStories and updateStory give it (data_stories.cpp:720-728, :240) — and what has been read of them is
// the three apps' `storyReadMarks` (:289 updateReadStories). Only this account's own three lists are read where they
// live (its own documents). Who stands in the row is the window's: contacts and 1:1 partners (review 10-15), in its
// order; nobody's stories are asked for by person any more, so nothing is refused on the way.
// A query of this account's own stories keeps the ones that expire after it was made, so those three are made again each
// hour; the feed is read whole and a copy past its end is left out of the row as it expires.
export const storyBarRearm = 60 * 60000
export class StoryBarApi {
  private closed = false
  private locked = false
  private reader: Pick<FirestoreReader, 'close'> | null = null
  private listen: Pick<ListenTargets, 'add' | 'close' | 'tally' | 'size'> | null = null
  private readonly lists = new Map<ListName, Listened>()
  // Marks this device moved forward before the server's copy says so (iOS MorseStoryFeed.noteRead).
  private readonly localMarks = new Map<string, StoryReadMark>()
  private order: string[] = []
  private cutoff = 0
  private rearmTimer: ReturnType<typeof setTimeout> | undefined
  private expiryTimer: ReturnType<typeof setTimeout> | undefined
  private notifyTimer: ReturnType<typeof setTimeout> | undefined
  private logTimer: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly uid: string, private readonly auth: ReadCredentials, private readonly allowed: () => void,
    // The row changed (a story came, went, expired or was read).
    private readonly notify: (result: StoryBarResult) => void = () => {},
    // The reads, over Firestore; a test gives its own.
    private readonly open: () => Pick<FirestoreReader, 'listenTargets' | 'close'> = () => new FirestoreReader(auth),
    private readonly now: () => number = serverNow) {
    auth.signal.addEventListener('abort', () => this.close(), { once: true })
  }

  // The people of the row, in order, and the row as it stands. `force` listens again to lists the server refused.
  list(raw: unknown, force: boolean): Promise<StoryBarResult> {
    if (this.closed) throw new Error(tr('계정이 변경되었습니다.'))
    this.allowed()
    const peers = storyBarPeers(raw).filter(uid => uid !== this.uid).slice(0, maxStoryBarPeers)
    this.order = [this.uid, ...peers]
    this.bind(force)
    return Promise.resolve(this.result())
  }

  // B408 S2: one person's active stories as the row counts them, for a ring outside the row — the chat header's picture
  // (tdesktop TopBarWidget userpic with PeerData::hasActiveStories / hasUnreadStories, both from the same peer state).
  // Asking listens to the feed if nothing has yet; the answer changes as `notify` says the row did.
  peerEntry(raw: unknown): StoryBarEntry | null {
    if (this.closed) throw new Error(tr('계정이 변경되었습니다.'))
    this.allowed()
    const [owner] = storyBarPeers([raw])
    if (!owner || owner === this.uid) return null
    this.bind(false)
    return this.peer(owner, this.now())
  }

  // B416 B: the row's people as the row orders them (unseen first, then the latest), each with the story the viewer
  // opens first (the first unread, else the first — tdesktop toOpen()), and the picture it shows first.
  preloadCandidates(): PreloadCandidate[] {
    if (this.closed || this.locked) return []
    const at = this.now()
    const entries = this.order.filter(owner => owner !== this.uid).flatMap(owner => { const entry = this.peer(owner, at); return entry ? [entry] : [] })
      .sort((a, b) => Number(b.unseen > 0) - Number(a.unseen > 0) || b.latestAt - a.latestAt)
    return entries.flatMap(entry => {
      const stories = this.feedStories('user', entry.uid), mark = this.mark('user', entry.uid)
      const story = stories.find(item => !storyRead(item, mark)) ?? stories[0]
      const path = story ? feedStoryPicturePath(story) : null
      return story && path ? [{ path, ownerId: story.ownerId, storyId: story.storyId, storyPath: story.storyPath }] : []
    })
  }

  // A locked app reads nothing and holds no stories; unlocked, the row listens again.
  setLocked(locked: boolean): void {
    if (this.closed || this.locked === locked) return
    this.locked = locked
    if (locked) this.stopAll()
    else if (this.order.length) this.bind(false)
  }

  close(): void { this.closed = true; this.stopAll() }

  // B408 S2: one owner's stories in this account's feed, not yet ended, oldest first (iOS MorseStoryFeed.stories).
  feedStories(ownerType: 'user' | 'channel', ownerId: string): FeedStory[] {
    const at = this.now()
    return this.feed().filter(story => story.ownerType === ownerType && story.ownerId === ownerId && story.expiresAt > at)
      .sort((a, b) => a.createdAt - b.createdAt || (a.storyId < b.storyId ? -1 : a.storyId > b.storyId ? 1 : 0))
  }
  // Whether the feed holds this story — the server lets a view be written only then (firestore.rules storyViewWriteOk).
  inFeed(storyPath: string): boolean { return this.feed().some(story => story.storyPath === storyPath) }
  // Whether the feed has answered at all since it was opened.
  get feedAnswered(): boolean { return this.lists.get('feed')?.answered === true }
  mark(ownerType: 'user' | 'channel', ownerId: string): StoryReadMark | undefined {
    const key = readMarkId(ownerType, ownerId), local = this.localMarks.get(key), stored = this.storedMarks().get(key)
    if (!local) return stored
    if (!stored) return local
    return storyRead({ createdAt: local.maxReadCreatedAt, storyId: local.maxReadStoryId }, stored) ? stored : local
  }
  // A story was shown: the read mark moves to it if it is later (the caller writes the mark); true when it moved.
  noteRead(story: Pick<FeedStory, 'ownerType' | 'ownerId' | 'createdAt' | 'storyId'>): boolean {
    if (!laterMark(this.mark(story.ownerType, story.ownerId), story)) return false
    this.localMarks.set(readMarkId(story.ownerType, story.ownerId), { ownerType: story.ownerType, ownerId: story.ownerId, maxReadCreatedAt: story.createdAt, maxReadStoryId: story.storyId })
    this.changed()
    return true
  }

  private feed(): FeedStory[] {
    const out: FeedStory[] = []
    for (const doc of this.lists.get('feed')?.docs.values() ?? []) { try { out.push(feedStoryFromDocument(doc, this.uid)) } catch { /* A malformed copy is not shown. */ } }
    return out
  }
  private storedMarks(): Map<string, StoryReadMark> {
    const marks = new Map<string, StoryReadMark>()
    for (const doc of this.lists.get('marks')?.docs.values() ?? []) { try { const mark = storyReadMarkFromDocument(doc, this.uid); marks.set(readMarkId(mark.ownerType, mark.ownerId), mark) } catch { /* ignored */ } }
    return marks
  }

  private bind(force: boolean): void {
    if (this.closed || this.locked) return
    if (!this.listen) {
      const reader = this.open()
      this.reader = reader
      this.listen = reader.listenTargets(this.auth.signal)
      this.cutoff = this.now()
      this.rearmTimer = setTimeout(() => this.rearm(), storyBarRearm)
    }
    const names: ListName[] = ['feed', 'marks', 'everyone', 'contacts', 'closeFriends']
    for (const name of names) { const list = this.lists.get(name); if (!list || (force && list.failed)) this.start(name) }
  }

  // Listens to one list; the list it replaces stops only after, so the stream stays open.
  private start(name: ListName): void {
    if (!this.listen) return
    const previous = this.lists.get(name)
    const list: Listened = { stop: () => {}, docs: previous?.docs ?? new Map(), answered: false, failed: false }
    this.lists.set(name, list)
    const mine = (): boolean => this.lists.get(name) === list
    list.stop = this.listen.add(this.target(name), {
      snapshot: docs => { if (!mine()) return; list.docs = docs; list.answered = true; list.failed = false; this.changed() },
      state: (state, error) => {
        if (!mine() || state !== 'error') return
        list.answered = true; list.failed = true
        if (error?.code === 'permission') list.docs = new Map()
        this.changed()
      }
    }, name === 'feed' ? 2000 : name === 'marks' ? 1000 : 50)
    previous?.stop()
  }

  private target(name: ListName): WireObject {
    const parent = `${documents}/users/${this.uid}`
    if (name === 'feed' || name === 'marks') return { query: { parent, structuredQuery: { from: [{ collectionId: name === 'feed' ? 'storyFeed' : 'storyReadMarks' }] } } }
    return { query: { parent, structuredQuery: {
      from: [{ collectionId: ownStoryCollections[name] }],
      where: { fieldFilter: { field: { fieldPath: 'expiresAt' }, op: 'GREATER_THAN', value: positionValue(positionAt(this.cutoff, '')) } },
      orderBy: [{ field: { fieldPath: 'expiresAt' }, direction: 'ASCENDING' }, { field: { fieldPath: 'createdAt' }, direction: 'ASCENDING' }, { field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
      limit: { value: 50 }
    } } }
  }

  // Each hour this account's own lists are made again from now, so its stories that expired leave the server's answer.
  private rearm(): void {
    if (this.closed || this.locked || !this.listen) return
    this.cutoff = this.now()
    for (const name of ['everyone', 'contacts', 'closeFriends'] as const) this.start(name)
    this.rearmTimer = setTimeout(() => this.rearm(), storyBarRearm)
    this.log('rearm')
  }

  private stopAll(): void {
    clearTimeout(this.rearmTimer); clearTimeout(this.expiryTimer); clearTimeout(this.notifyTimer); clearTimeout(this.logTimer)
    this.notifyTimer = undefined; this.logTimer = undefined
    this.listen?.close(); this.reader?.close()
    this.listen = null; this.reader = null
    this.lists.clear(); this.localMarks.clear()
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
    const entries = this.order.flatMap(owner => { const entry = owner === this.uid ? this.own(at) : this.peer(owner, at); return entry ? [entry] : [] })
    const partial = [...this.lists.values()].some(list => !list.answered) || this.lists.size === 0
    return { entries, observedAt: at, partial }
  }

  private peer(owner: string, at: number): StoryBarEntry | null {
    const stories = this.feed().filter(story => story.ownerType === 'user' && story.ownerId === owner && story.expiresAt > at)
    if (!stories.length) return null
    const mark = this.mark('user', owner)
    return { uid: owner, count: stories.length, unseen: stories.filter(story => !storyRead(story, mark)).length,
      latestAt: Math.max(...stories.map(story => story.createdAt)), expiresAt: Math.min(...stories.map(story => story.expiresAt)) }
  }

  private own(at: number): StoryBarEntry | null {
    const tally: Tally = { count: 0, unseen: 0, latestAt: 0, expiresAt: 0 }
    for (const privacy of ['everyone', 'contacts', 'closeFriends'] as const) {
      for (const doc of this.lists.get(privacy)?.docs.values() ?? []) {
        try {
          const story = ownStoryFromDocument(doc, this.uid, privacy), expiresAt = positionMilliseconds(story.expires)
          if (expiresAt <= at) continue
          tally.count++
          tally.latestAt = Math.max(tally.latestAt, positionMilliseconds(story.created))
          tally.expiresAt = tally.expiresAt ? Math.min(tally.expiresAt, expiresAt) : expiresAt
        } catch { /* A malformed story is not shown in the row. */ }
      }
    }
    return tally.count ? { uid: this.uid, ...tally } : null
  }
}
