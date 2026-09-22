import type { FirestoreDocument } from '../network/firestore-values'
import { MessageMutationFailure } from '../network/contracts'
import { tr } from '../../shared/i18n'

// Telegram deletes a forum topic with messages.deleteTopicHistory (Window::PeerMenuDeleteTopic): every message of the
// topic goes, for everyone, asked again while the server says some are left, and then the topic leaves the list
// (Data::Forum::applyTopicDeleted). Morse's server has no such command,
// so the owner's device takes the topic's messages away itself, a page at a time, as a group member may
// (firestore.rules: any participant of a group deletes any of its messages), each with its revokedForAll record.
// What no retry can change: a message the rules keep, or a group this account no longer owns.
export class TopicDeletionStop extends Error {}

export interface TopicMessages {
  page(limit: number): Promise<FirestoreDocument[]>
  remove(docs: FirestoreDocument[], tombstone: boolean): Promise<void>
}

// One commit reads each deleted message once more in the rules (exists), and a batch may read twenty documents.
export const topicDeletionPage = 8
const maxPages = 5000

export async function deleteTopicMessages(messages: TopicMessages, alive: () => void): Promise<number> {
  let removed = 0
  for (let pages = 0; pages < maxPages; pages++) {
    alive()
    const docs = await messages.page(topicDeletionPage)
    alive()
    if (!docs.length) return removed
    const before = removed
    try { await messages.remove(docs, true); removed += docs.length }
    catch (error) {
      if (!(error instanceof MessageMutationFailure) || !error.definitive) throw error
      // One message changed or was already revoked: the rest go one by one, and one already revoked goes alone.
      for (const doc of docs) {
        alive()
        try { await messages.remove([doc], true); removed++ }
        catch (single) {
          if (!(single instanceof MessageMutationFailure) || !single.definitive) throw single
          alive()
          try { await messages.remove([doc], false); removed++ }
          catch (last) {
            // Changed since the page was read: the next page reads it again.
            if (!(last instanceof MessageMutationFailure) || !last.definitive) throw last
          }
        }
      }
      // A page of which nothing could go would only be read again.
      if (removed === before) throw new TopicDeletionStop(tr('일부 메시지를 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.'))
    }
  }
  throw new TopicDeletionStop(tr('일부 메시지를 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.'))
}

export interface TopicDeletionState { id: string; failed: boolean }
type Job = { chatId: string; categoryId: string; failed: boolean; abort: AbortController }

// The deletions under way. Like Telegram's request, one outlives the box that asked for it and a lost connection:
// it waits for the account to be connected again and goes on until nothing of the topic is left. Only a
// TopicDeletionStop, or failing again and again, leaves it failed, for the owner to try again.
export class TopicDeletions {
  private readonly jobs = new Map<string, Job>()
  // Deleted here but maybe not yet gone from the room document this device last read.
  private readonly removed = new Map<string, Set<string>>()
  private waiting: (() => void)[] = []
  private closed = false
  constructor(private readonly run: (chatId: string, categoryId: string, signal: AbortSignal) => Promise<void>,
    private readonly ready: () => boolean, private readonly changed: () => void,
    private readonly wait: (ms: number, signal: AbortSignal) => Promise<void> = (ms, signal) => new Promise(resolve => {
      const timer = setTimeout(resolve, ms); signal.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
    })) {}

  start(chatId: string, categoryId: string): void {
    if (this.closed) return
    const key = `${chatId}\n${categoryId}`, current = this.jobs.get(key)
    if (current && !current.failed) return
    const job: Job = { chatId, categoryId, failed: false, abort: new AbortController() }
    this.jobs.set(key, job); this.changed()
    void this.loop(key, job)
  }
  private async loop(key: string, job: Job): Promise<void> {
    for (let failures = 0; !this.closed && !job.abort.signal.aborted;) {
      if (!this.ready()) { await new Promise<void>(resolve => this.waiting.push(resolve)); continue }
      try {
        await this.run(job.chatId, job.categoryId, job.abort.signal)
        if (this.jobs.get(key) !== job) return
        this.jobs.delete(key)
        const ids = this.removed.get(job.chatId) ?? new Set<string>(); ids.add(job.categoryId); this.removed.set(job.chatId, ids)
        this.changed(); return
      } catch (error) {
        if (this.closed || job.abort.signal.aborted || this.jobs.get(key) !== job) return
        if (error instanceof TopicDeletionStop || ++failures >= 12) { job.failed = true; this.changed(); return }
        // A connection that went down wakes the loop when it is back; anything else waits a little longer each time.
        if (this.ready()) await this.wait(Math.min(30000, 1000 * 2 ** Math.min(failures, 5)), job.abort.signal)
      }
    }
  }
  connectionChanged(): void {
    if (!this.ready()) return
    const waiting = this.waiting; this.waiting = []
    for (const resolve of waiting) resolve()
  }
  // The room's topics as this device shows them: a deleted one leaves at once (applyTopicDeleted), and one being
  // deleted says so.
  apply(summary: { id: string; forum?: { categories: { id: string }[] }; forumDeleting?: TopicDeletionState[] }): void {
    const removed = this.removed.get(summary.id)
    if (removed && summary.forum) {
      for (const id of removed) if (!summary.forum.categories.some(category => category.id === id)) removed.delete(id)
      if (!removed.size) this.removed.delete(summary.id)
      else summary.forum = { ...summary.forum, categories: summary.forum.categories.filter(category => !removed.has(category.id)) }
    } else if (removed) this.removed.delete(summary.id)
    const deleting = [...this.jobs.values()].filter(job => job.chatId === summary.id).map(job => ({ id: job.categoryId, failed: job.failed }))
    if (deleting.length) summary.forumDeleting = deleting
  }
  close(): void {
    this.closed = true
    for (const job of this.jobs.values()) job.abort.abort()
    this.jobs.clear(); this.removed.clear()
    const waiting = this.waiting; this.waiting = []
    for (const resolve of waiting) resolve()
  }
}
