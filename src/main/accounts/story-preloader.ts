// Portions of this file follow Telegram Desktop (https://github.com/telegramdesktop/tdesktop, 7.3.1),
// Copyright (c) 2014-2026 The Telegram Desktop Authors. Licensed under GPL-3.0-or-later; see LEGAL.
import { MorseCallableFailure } from '../network/morse-callable'

// B416 B: the story each person of the stories row would open with is fetched before it is pressed, one at a time,
// into this account's media cache — the viewer reads that cache before the network (own-story-photo.ts download), so
// even a first open shows at once. tdesktop does the same while the chat list exists
// (dialogs_inner_widget.cpp:587 incrementPreloadingMainSources): the first kMaxPreloadSources (10) row sources' toOpen()
// story not yet preloaded (data_stories.cpp:2540-2569), one StoryPreload at a time, the next when it ends
// (continuePreloading / preloadFinished :2571-2637); a photo only when automatic download allows it for that peer
// (PhotoPreload::Should, data_story.cpp:935-956). It only fetches: no view and no read mark is written.
export const maxPreloadSources = 10
export interface PreloadCandidate {
  // Where the copy says the picture is: the photo of a photo story, the poster of a video story.
  path: string; ownerId: string; storyId: string; storyPath: string
}
export interface PreloaderDeps {
  // The row's people in the row's order, each with the story the viewer would open first (first unread, else first).
  candidates(): PreloadCandidate[]
  // Whether a fetch may start now: unlocked, connected, the row shown in a visible window, no story viewer open,
  // nothing the person asked for (a send's upload, a pressed download) on the way.
  idle(): 'go' | 'wait' | 'off'
  // The person's automatic download limit for people (0: off).
  limit(): number
  cached(path: string): Promise<boolean>
  fetch(candidate: PreloadCandidate, maxBytes: number, weighFirst: boolean, signal: AbortSignal): Promise<Buffer>
  keep(path: string, bytes: Buffer): void
  record(step: string, detail: string): void
}
export const maxPreloadBytes = 8 * 1024 * 1024
const retryWait = 3000

export class StoryPreloader {
  private closed = false
  private running: AbortController | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  // What was fetched or refused this run: not asked for again (tdesktop _preloaded).
  private readonly done = new Set<string>()
  constructor(private readonly deps: PreloaderDeps, private readonly signal: AbortSignal) {
    signal.addEventListener('abort', () => this.close(), { once: true })
  }

  // Something the choice depends on changed (the row, a read mark, visibility, the connection, the viewer).
  poke(): void {
    if (this.closed || this.running) return
    clearTimeout(this.timer); this.timer = undefined
    void this.next()
  }

  private later(): void {
    if (this.closed || this.timer) return
    this.timer = setTimeout(() => { this.timer = undefined; this.poke() }, retryWait)
  }

  private async next(): Promise<void> {
    const state = this.deps.idle()
    if (state === 'off') return
    const candidate = this.deps.candidates().slice(0, maxPreloadSources).find(item => !this.done.has(item.path))
    if (!candidate) return
    if (state === 'wait') { this.later(); return }
    const limit = Math.min(this.deps.limit(), maxPreloadBytes)
    // Automatic download off for people: nothing is fetched ahead (PhotoPreload::Should).
    if (limit <= 0) return
    const abort = new AbortController(), signal = AbortSignal.any([this.signal, abort.signal])
    this.running = abort
    const started = performance.now()
    let then: 'next' | 'later' | 'stop' = 'next'
    try {
      if (await this.deps.cached(candidate.path)) this.done.add(candidate.path)
      else {
        signal.throwIfAborted()
        // Under the person's own limit the size is weighed before any bytes (B360, data_auto_download.cpp:50-58).
        const bytes = await this.deps.fetch(candidate, limit, limit < maxPreloadBytes, signal)
        try { signal.throwIfAborted(); this.deps.keep(candidate.path, bytes) } finally { bytes.fill(0) }
        this.done.add(candidate.path)
        this.deps.record('story-preloaded', `ms=${Math.round(performance.now() - started)}`)
      }
    } catch (error) {
      if (signal.aborted) then = 'stop'
      else {
        // A refusal or a mismatch is not asked again; a connection that failed is tried at the next choice.
        const network = error instanceof TypeError || (error instanceof MorseCallableFailure && error.delivery !== 'answered')
        if (!network) this.done.add(candidate.path)
        this.deps.record('story-preload-failed', `${network ? 'network' : 'refused'} ms=${Math.round(performance.now() - started)}`)
        if (network) then = 'later'
      }
    } finally { if (this.running === abort) this.running = null }
    if (this.closed || then === 'stop') return
    // The next one, as preloadFinished asks continuePreloading.
    if (then === 'later') this.later(); else queueMicrotask(() => this.poke())
  }

  // The viewer, a lock or a hidden window stops what is on the way; it is chosen again when allowed.
  pause(): void { this.running?.abort(); this.running = null; clearTimeout(this.timer); this.timer = undefined }
  close(): void { this.closed = true; this.pause(); this.done.clear() }
}
