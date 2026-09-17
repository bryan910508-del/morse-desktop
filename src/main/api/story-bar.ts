import { maxStoryBarPeers, storyBarPeers, type StoryBarEntry, type StoryBarResult } from '../../shared/story-bar'
import type { StoryPrivacy } from '../../shared/own-stories'
import { positionAt, positionMilliseconds } from '../../shared/model'
import { FirestoreReader, type ReadCredentials } from '../network/firestore-rpc'
import { documents, positionValue, type FirestoreDocument } from '../network/firestore-values'
import { ownStoryCollections, ownStoryFromDocument } from '../network/own-story-document'
import { storyHiddenFrom } from '../network/story-hidden-audience'
import { tr } from '../../shared/i18n'

interface Tally { count: number; unseen: number; latestAt: number; expiresAt: number }

// Dialogs::Stories source, following iOS ChatListView.loadUserStories: each owner's
// active stories are read with the viewer's list permission (public stories for
// every contact, contacts-only stories when the owner lists this viewer), four
// owners at a time, and reused for 60 seconds.
export class StoryBarApi {
  private closed = false
  private cache: { key: string; at: number; result: StoryBarResult } | null = null
  private running: { key: string; task: Promise<StoryBarResult> } | null = null

  constructor(private readonly uid: string, private readonly auth: ReadCredentials, private readonly allowed: () => void, private readonly isContact: (uid: string) => boolean) {}

  list(raw: unknown, force: boolean): Promise<StoryBarResult> {
    if (this.closed) throw new Error(tr('계정이 변경되었습니다.'))
    this.allowed()
    const peers = storyBarPeers(raw).filter(uid => uid !== this.uid && this.isContact(uid)).slice(0, maxStoryBarPeers)
    const key = JSON.stringify([...peers].sort())
    if (!force && this.cache?.key === key && Date.now() - this.cache.at < 60000) return Promise.resolve(this.cache.result)
    if (this.running?.key === key) return this.running.task
    const task: Promise<StoryBarResult> = this.load(peers)
      .then(result => { if (!this.closed) this.cache = { key, at: Date.now(), result }; return result })
      .finally(() => { if (this.running?.task === task) this.running = null })
    this.running = { key, task }
    return task
  }

  close(): void { this.closed = true; this.cache = null; this.running = null }

  private query(reader: FirestoreReader, owner: string, privacy: StoryPrivacy, cutoff: number, signal: AbortSignal): Promise<FirestoreDocument[]> {
    return reader.query(`${documents}/users/${owner}`, {
      from: [{ collectionId: ownStoryCollections[privacy] }],
      where: { fieldFilter: { field: { fieldPath: 'expiresAt' }, op: 'GREATER_THAN', value: positionValue(positionAt(cutoff, '')) } },
      orderBy: [{ field: { fieldPath: 'expiresAt' }, direction: 'ASCENDING' }, { field: { fieldPath: 'createdAt' }, direction: 'ASCENDING' }, { field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
      limit: { value: 50 }
    }, signal)
  }

  private viewed(doc: FirestoreDocument): boolean {
    const values = (doc.fields.viewerIds as { arrayValue?: { values?: unknown } } | undefined)?.arrayValue?.values
    return Array.isArray(values) && values.some(value => typeof value === 'object' && value !== null && (value as { stringValue?: unknown }).stringValue === this.uid)
  }

  private tally(target: Tally, docs: FirestoreDocument[], owner: string, privacy: StoryPrivacy, cutoff: number): void {
    for (const doc of docs) {
      try {
        const story = ownStoryFromDocument(doc, owner, privacy), expiresAt = positionMilliseconds(story.expires)
        if (expiresAt <= cutoff || (owner !== this.uid && storyHiddenFrom(doc).hiddenFrom.includes(this.uid))) continue
        target.count++
        target.latestAt = Math.max(target.latestAt, positionMilliseconds(story.created))
        target.expiresAt = target.expiresAt ? Math.min(target.expiresAt, expiresAt) : expiresAt
        if (owner !== this.uid && !this.viewed(doc)) target.unseen++
      } catch { /* A malformed story is not shown in the row. */ }
    }
  }

  private async owner(reader: FirestoreReader, owner: string, cutoff: number, signal: AbortSignal): Promise<Tally | null> {
    const tally: Tally = { count: 0, unseen: 0, latestAt: 0, expiresAt: 0 }
    const privacies: StoryPrivacy[] = owner === this.uid ? ['everyone', 'contacts', 'closeFriends'] : ['everyone']
    if (owner !== this.uid) {
      // Contacts-only stories are listable only when the owner lists this viewer.
      try { if (await reader.getDocument(`${documents}/users/${owner}/contacts/${this.uid}`, signal)) privacies.push('contacts') }
      catch { /* Unknown relation: public stories only. */ }
    }
    let failed = false
    for (const privacy of privacies) {
      try { this.tally(tally, await this.query(reader, owner, privacy, cutoff, signal), owner, privacy, cutoff) }
      catch { signal.throwIfAborted(); failed = true }
    }
    return failed && !tally.count ? null : tally
  }

  private async load(peers: string[]): Promise<StoryBarResult> {
    const signal = AbortSignal.any([this.auth.signal, AbortSignal.timeout(45000)]), cutoff = Date.now()
    const owners = [this.uid, ...peers], entries: StoryBarEntry[] = []
    let partial = false, next = 0
    const worker = async (): Promise<void> => {
      const reader = new FirestoreReader(this.auth)
      try {
        while (next < owners.length && !this.closed) {
          const owner = owners[next++]!
          signal.throwIfAborted()
          const tally = await this.owner(reader, owner, cutoff, signal)
          if (!tally) partial = true
          else if (tally.count) entries.push({ uid: owner, ...tally })
        }
      } finally { reader.close() }
    }
    await Promise.all(Array.from({ length: Math.min(4, owners.length) }, () => worker()))
    if (this.closed) throw new Error(tr('계정이 변경되었습니다.'))
    return { entries, observedAt: cutoff, partial }
  }
}
