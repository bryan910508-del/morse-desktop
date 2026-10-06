// Portions of this file follow Telegram Desktop (https://github.com/telegramdesktop/tdesktop, 7.2.8, 272f6f5c),
// Copyright (c) 2014-2026 The Telegram Desktop Authors. Licensed under GPL-3.0-or-later; see LEGAL.
// «The connection is back: try now.» Telegram Desktop restarts every MTP session the moment the system says the
// network is available again (mtproto/mtp_instance.cpp: _networkReachability->availableChanges() → restart()), and a
// restart forgets the wait it was in (session_private.cpp SessionPrivate::restartNow: _retryTimeout = 1, the retry
// timer cancelled). Whatever the session had not delivered then goes on the new connection at once.
//
// Morse has more than one connection — the socket, a gRPC channel per Firestore reader, HTTPS requests — so the
// network counts as back when any of them says so:
// - the system reports it is online again (main/index.ts polls Electron's net.isOnline),
// - a socket registers,
// - a request reaches the server after requests had failed without leaving (reached after lost).
// Then every queue forgets its wait and goes, Firestore channels stuck in their reconnect wait are made anew,
// sockets still reconnecting reconnect now, and saved accounts waiting to restore restore now.
export type Returned = (reason: string) => void

export class Reachability {
  private lostSince = 0
  private readonly listeners = new Set<Returned>()
  // A request that never left this device: the network may be gone.
  lost(): void { if (!this.lostSince) this.lostSince = Date.now() }
  // A request the server answered, or a connection that was made. It says the network is back only when requests
  // had been failing to leave.
  reached(reason: string): void {
    if (!this.lostSince) return
    this.lostSince = 0
    this.emit(reason)
  }
  // The system or a socket says the connection is there: always a reason to try now.
  returned(reason: string): void {
    this.lostSince = 0
    this.emit(reason)
  }
  get down(): boolean { return this.lostSince !== 0 }
  subscribe(listener: Returned): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  private emit(reason: string): void {
    for (const listener of [...this.listeners]) {
      try { listener(reason) } catch { /* one listener's failure does not keep the others from trying */ }
    }
  }
}

// One network for the whole app, as Telegram has one base::NetworkReachability.
export const reachability = new Reachability()

// The system's own word (base::NetworkReachability::availableChanges): Electron gives the main process no event for
// it, so Chromium's state (net.isOnline) is read every two seconds, and offline turning online is a return.
export function watchSystemOnline(isOnline: () => boolean, returned: () => void, every = 2000): () => void {
  let online = isOnline()
  const timer = setInterval(() => {
    const now = isOnline()
    if (now && !online) returned()
    online = now
  }, every)
  timer.unref?.()
  return () => clearInterval(timer)
}
