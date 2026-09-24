// Telegram keeps the stories around the one being watched ready before they are needed:
// Controller::preloadNext asks for the next three and the one before (kPreloadNextMediaCount 3,
// kPreloadPreviousMediaCount 1) and hands them to Stories::setPreloadingInViewer, so moving on shows
// a story that is already there instead of a spinner. What was fetched ahead of the viewer waits
// here, for this account only, until it is shown or the viewer is closed.
export interface StoryMediaEntry { bytes: Buffer; mime: string; audioBytes: Buffer | null; audioMime: string }
const maxEntries = 4
const maxBytes = 96 * 1024 * 1024
const lifetime = 5 * 60000

export function storyMediaKey(ownerId: string, storyId: string, version: string, kind: string): string {
  return JSON.stringify([ownerId, storyId, version, kind])
}

export class StoryMediaCache {
  private entries = new Map<string, { value: StoryMediaEntry; at: number; size: number }>()
  private closed = false

  private size(value: StoryMediaEntry): number { return value.bytes.length + (value.audioBytes?.length ?? 0) }
  private drop(key: string): void {
    const entry = this.entries.get(key)
    if (!entry) return
    this.entries.delete(key)
    entry.value.bytes.fill(0); entry.value.audioBytes?.fill(0)
  }
  private expire(): void { for (const [key, entry] of [...this.entries]) if (Date.now() - entry.at >= lifetime) this.drop(key) }

  has(key: string): boolean { this.expire(); return this.entries.has(key) }

  // What is taken belongs to the caller: it is no longer here, and is not wiped from under it.
  take(key: string): StoryMediaEntry | null {
    this.expire()
    const entry = this.entries.get(key)
    if (!entry) return null
    this.entries.delete(key)
    return entry.value
  }

  keep(key: string, value: StoryMediaEntry): void {
    if (this.closed) { value.bytes.fill(0); value.audioBytes?.fill(0); return }
    this.expire(); this.drop(key)
    const size = this.size(value)
    if (size > maxBytes) { value.bytes.fill(0); value.audioBytes?.fill(0); return }
    this.entries.set(key, { value, at: Date.now(), size })
    // The oldest goes first, as a cache with a bound must.
    let total = [...this.entries.values()].reduce((sum, entry) => sum + entry.size, 0)
    while (this.entries.size > maxEntries || total > maxBytes) {
      const oldest = [...this.entries].sort((left, right) => left[1].at - right[1].at)[0]
      if (!oldest || oldest[0] === key) break
      total -= oldest[1].size
      this.drop(oldest[0])
    }
  }

  clear(): void { for (const key of [...this.entries.keys()]) this.drop(key) }
  close(): void { this.closed = true; this.clear() }
}
