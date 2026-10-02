// The room a person is in, as every Morse client publishes it: chats/{id}/watchers/{uid} with `enteredAt`, written when
// the room is open in front of them (iOS AppState.commitActiveChatPresenceWritesIfNeeded), written again every 55 s
// while they stay (refreshActiveChatPresence, MorseRealtimeTuning.activeChatPresenceRefreshSeconds), and deleted when
// they leave (setActiveChat(nil)). Other clients show a watcher younger than 80 s as «in the room» (AppState
// subscribeAllChatWatchers). The typing signal only updates this document and never creates it (iOS 886b1f49), so a
// «stopped typing» sent after the room was left cannot announce the room again.
export const presenceRefreshMs = 55000

export interface PresenceWriter {
  enter(chatId: string, signal: AbortSignal): Promise<void>
  leave(chatId: string, signal: AbortSignal): Promise<void>
}

export class RoomPresence {
  private current: string | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  constructor(private readonly writer: () => PresenceWriter | null, private readonly signal: AbortSignal, private readonly every = presenceRefreshMs) {}
  get room(): string | null { return this.current }
  // The room this account is in now, or null when it is in none (closed, in the background, locked).
  set(chatId: string | null): void {
    if (chatId === this.current) return
    const previous = this.current, writer = this.writer()
    this.current = chatId
    this.unschedule()
    if (previous && writer) void writer.leave(previous, this.signal).catch(() => {})
    if (!chatId || !writer) return
    void writer.enter(chatId, this.signal).catch(() => {})
    this.timer = setInterval(() => {
      const again = this.writer()
      if (this.current === chatId && again && !this.signal.aborted) void again.enter(chatId, this.signal).catch(() => {})
    }, this.every)
    this.timer.unref?.()
  }
  close(): void { this.set(null) }
  private unschedule(): void { if (this.timer) clearInterval(this.timer); this.timer = null }
}
