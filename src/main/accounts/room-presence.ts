// The room a person is in, as every Morse client publishes it: chats/{id}/watchers/{uid} with `enteredAt`, written when
// the room is open in front of them (iOS AppState.commitActiveChatPresenceWritesIfNeeded), written again every 55 s
// while they stay (refreshActiveChatPresence, MorseRealtimeTuning.activeChatPresenceRefreshSeconds), and deleted when
// they leave (setActiveChat(nil)). Other clients show a watcher younger than 80 s as «in the room» (AppState
// subscribeAllChatWatchers). The typing signal only updates this document and never creates it (iOS 886b1f49), so a
// «stopped typing» sent after the room was left cannot announce the room again.
export const presenceRefreshMs = 55000
// B7: a window that only lost focus (a notification banner, Spotlight, a context menu) leaves its room this much later,
// and coming back before then writes nothing — tdesktop counts a window inactive offlineBlurTimeout after the blur
// (Window::Controller::updateIsActiveBlur, window/window_controller.cpp:507-511; mtproto/mtproto_config.h:21, 5000 ms).
// Closing the chat, opening another, locking or signing out still leaves at once.
export const presenceBlurLeaveMs = 5000

export interface PresenceWriter {
  enter(chatId: string, signal: AbortSignal): Promise<void>
  leave(chatId: string, signal: AbortSignal): Promise<void>
}

export class RoomPresence {
  private current: string | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private leaving: ReturnType<typeof setTimeout> | null = null
  constructor(private readonly writer: () => PresenceWriter | null, private readonly signal: AbortSignal, private readonly every = presenceRefreshMs,
    private readonly blurLeave = presenceBlurLeaveMs) {}
  get room(): string | null { return this.current }
  // The room this account is in now, or null when it is in none (closed, in the background, locked). `blurred`: null only
  // because the window lost focus with the chat still open — the leave waits blurLeave and is dropped if the room comes back.
  set(chatId: string | null, blurred = false): void {
    if (chatId === this.current) { this.cancelLeave(); return }
    if (chatId === null && blurred && this.current) {
      if (this.leaving) return
      this.leaving = setTimeout(() => { this.leaving = null; this.set(null) }, this.blurLeave)
      this.leaving.unref?.()
      return
    }
    this.cancelLeave()
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
  private cancelLeave(): void { if (this.leaving) clearTimeout(this.leaving); this.leaving = null }
  private unschedule(): void { if (this.timer) clearInterval(this.timer); this.timer = null }
}
