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
import { maxStoryPeers, storyPeerFromDocument, storyPeerHideWrite, storyPeerUnhideWrite, type StoryPeer } from '../network/story-peers-document'

interface Tally { count: number; unseen: number; latestAt: number; expiresAt: number }
// One listened list: what it last answered, kept while it listens again (Telegram R-59, data_stories.cpp keeps what it
// has when a load fails) and dropped only when the server refuses it.
interface Listened { stop(): void; docs: ReadonlyMap<string, FirestoreDocument>; answered: boolean; failed: boolean }
type ListName = StoryPrivacy | 'feed' | 'marks' | 'peers'

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
  // B423: stories whose media the server says is gone (tdesktop Stories::_deleted, data_stories.cpp:909), by path. Their
  // copies are left out of everything the feed gives until the server takes the copy away too.
  private readonly deleted = new Set<string>()
  // B482: whose stories this device has just hidden or shown again, until the server's storyPeers says the same.
  private readonly localHidden = new Map<string, boolean>()
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
    private readonly now: () => number = serverNow,
    // B482: one write to this account's storyPeers; a test gives its own.
    private readonly write: (write: WireObject, signal: AbortSignal) => Promise<void> = async (write, signal) => {
      const reader = new FirestoreReader(auth)
      try { await reader.commitStoryWrite(write, signal) } finally { reader.close() }
    }) {
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
    const entries = this.order.filter(owner => owner !== this.uid).flatMap(owner => { const entry = this.peer(owner, at); return entry && !entry.hidden ? [entry] : [] })
      .sort((a, b) => Number(b.unseen > 0) - Number(a.unseen > 0) || b.latestAt - a.latestAt)
    return entries.flatMap(entry => {
      const stories = this.feedStories('user', entry.uid), mark = this.mark('user', entry.uid)
      const story = stories.find(item => !storyRead(item, mark)) ?? stories[0]
      const path = story ? feedStoryPicturePath(story) : null
      return story && path ? [{ path, ownerId: story.ownerId, storyId: story.storyId, storyPath: story.storyPath }] : []
    })
  }

  // B482 (tdesktop FillSourceMenu → Stories::toggleHidden, dialogs/ui/dialogs_stories_content.cpp:261-277,
  // data/data_stories.cpp:1310-1330): a person's stories leave the chat list's row for the archive's, or come back. The
  // row moves at once; the server's storyPeers takes over when it says the same, and a refused write moves it back.
  async setHidden(raw: unknown, hidden: boolean): Promise<void> {
    if (this.closed) throw new Error(tr('계정이 변경되었습니다.'))
    this.allowed()
    const [owner] = storyBarPeers([raw])
    if (!owner || owner === this.uid) throw new Error(tr('스토리를 숨길 사람을 다시 선택해 주세요.'))
    const stored = this.storedPeers()
    if (hidden && !stored.has(owner) && stored.size >= maxStoryPeers) throw new Error(tr('스토리를 숨긴 사람이 너무 많습니다. 먼저 몇 명의 숨김을 풀어 주세요.'))
    const before = this.localHidden.get(owner)
    this.localHidden.set(owner, hidden); this.changed()
    try {
      await this.write(hidden ? storyPeerHideWrite(this.uid, 'user', owner) : storyPeerUnhideWrite(this.uid, 'user', owner, stored.get(owner)), this.auth.signal)
    } catch {
      if (this.localHidden.get(owner) === hidden) { if (before === undefined) this.localHidden.delete(owner); else this.localHidden.set(owner, before) }
      this.changed()
      throw new Error(hidden ? tr('스토리를 숨기지 못했습니다. 잠시 후 다시 시도해 주세요.') : tr('스토리 숨김을 풀지 못했습니다. 잠시 후 다시 시도해 주세요.'))
    }
  }
  private hiddenOwner(owner: string): boolean {
    return this.localHidden.get(owner) ?? this.storedPeers().get(owner)?.hidden ?? false
  }
  private storedPeers(): Map<string, StoryPeer> {
    const peers = new Map<string, StoryPeer>()
    for (const doc of this.lists.get('peers')?.docs.values() ?? []) {
      try { const peer = storyPeerFromDocument(doc, this.uid); if (peer.ownerType === 'user') peers.set(peer.ownerId, peer) } catch { /* A malformed entry hides nothing. */ }
    }
    return peers
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
  // B423, tdesktop applyDeleted (data_stories.cpp:899): the story leaves the row, the chat header's ring, the stories
  // fetched ahead and every list opened from the feed (applyRemovedFromActive :987-1015), and is not asked for again.
  applyDeleted(storyPath: string): void {
    if (this.closed || this.deleted.has(storyPath)) return
    this.deleted.add(storyPath)
    this.changed()
  }
  // Whether a story was found deleted (lookup → NoStory::Deleted, :1164) — also one getMorsePeerStories gave.
  gone(storyPath: string): boolean { return this.deleted.has(storyPath) }
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
    for (const doc of this.lists.get('feed')?.docs.values() ?? []) {
      try { const story = feedStoryFromDocument(doc, this.uid); if (!this.deleted.has(story.storyPath)) out.push(story) } catch { /* A malformed copy is not shown. */ }
    }
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
    const names: ListName[] = ['feed', 'marks', 'peers', 'everyone', 'contacts', 'closeFriends']
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
      snapshot: docs => {
        if (!mine()) return
        list.docs = docs; list.answered = true; list.failed = false
        // B482: a hide or show this device made is the server's once its storyPeers says the same.
        if (name === 'peers' && this.localHidden.size) {
          const stored = this.storedPeers()
          for (const [owner, hidden] of this.localHidden) if ((stored.get(owner)?.hidden ?? false) === hidden) this.localHidden.delete(owner)
        }
        // A deleted story whose copy the server has taken away is forgotten, as a story parsed again is (:597).
        if (name === 'feed' && this.deleted.size) {
          const held = new Set<string>()
          for (const doc of docs.values()) { try { held.add(feedStoryFromDocument(doc, this.uid).storyPath) } catch { /* ignored */ } }
          for (const path of this.deleted) if (!held.has(path)) this.deleted.delete(path)
        }
        this.changed()
      },
      state: (state, error) => {
        if (!mine() || state !== 'error') return
        list.answered = true; list.failed = true
        if (error?.code === 'permission') list.docs = new Map()
        this.changed()
      }
    }, name === 'feed' ? 2000 : name === 'marks' || name === 'peers' ? 1000 : 50)
    previous?.stop()
  }

  private target(name: ListName): WireObject {
    const parent = `${documents}/users/${this.uid}`
    if (name === 'feed' || name === 'marks' || name === 'peers') return { query: { parent, structuredQuery: { from: [{ collectionId: name === 'feed' ? 'storyFeed' : name === 'marks' ? 'storyReadMarks' : 'storyPeers' }] } } }
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
    this.lists.clear(); this.localMarks.clear(); this.localHidden.clear()
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
      latestAt: Math.max(...stories.map(story => story.createdAt)), expiresAt: Math.min(...stories.map(story => story.expiresAt)),
      ...(this.hiddenOwner(owner) ? { hidden: true as const } : {}) }
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
