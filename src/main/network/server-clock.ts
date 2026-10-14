// Portions of this file follow Telegram Desktop (https://github.com/telegramdesktop/tdesktop, 7.3.1),
// Copyright (c) 2014-2026 The Telegram Desktop Authors. Licensed under GPL-3.0-or-later; see LEGAL.

// B409-2 (review 10-15): the server's time as this computer can tell it. tdesktop keeps base::unixtime::now() as the
// server's time — corrected from each answer's server time (mtproto/session_private.cpp:2172 base::unixtime::update,
// :2179 correctUnixtimeWithBadLocal) — and dates a message it sends with it (history_item_helpers.cpp:599-605
// NewMessageDate). Here the difference comes from:
// - each acknowledged send — the server's createdAt against the middle of the request (socket or callable), to the
//   millisecond, the latest few taken by their middle value;
// - the issue time (iat, whole seconds) of each ID token and App Check proof — the first word there is at sign-in, before
//   anything has been sent; it counts only while no send has answered.
// A difference that jumps by more than two seconds (the computer's clock was set, the machine woke) starts again from
// that one answer; an issue time five seconds off the sends' difference drops them too. Every comparison with a time the server gave — a token's or a proof's end, an upload's lease, a
// story's end — and the date of a message on its way use serverNow().
const keep = 7, maxRoundTrip = 10000, jump = 2000, coarseAgreement = 5000
export class ServerClock {
  private fine: number[] = []
  private coarse: number | null = null
  private readonly listeners = new Set<(offset: number) => void>()
  constructor(private readonly local: () => number = () => Date.now()) {}
  // A request sent at `sentAt` and answered at `answeredAt` (this computer's ms) that the server dated `serverAt` (ms).
  answered(sentAt: number, answeredAt: number, serverAt: number): void {
    if (![sentAt, answeredAt, serverAt].every(Number.isFinite) || serverAt <= 0 || answeredAt < sentAt || answeredAt - sentAt > maxRoundTrip) return
    const sample = serverAt - (sentAt + answeredAt) / 2, before = this.offset()
    if (this.fine.length && Math.abs(sample - median(this.fine)) > jump) this.fine = []
    this.fine = [...this.fine, sample].slice(-keep)
    this.changed(before)
  }
  // A token the server issued at `issuedAtSeconds` (its iat), received at `receivedAt`.
  issued(issuedAtSeconds: unknown, receivedAt: number): void {
    if (typeof issuedAtSeconds !== 'number' || !Number.isSafeInteger(issuedAtSeconds) || issuedAtSeconds <= 0 || !Number.isFinite(receivedAt)) return
    const before = this.offset()
    // The middle of the second it names; the answer's way back is within it.
    this.coarse = issuedAtSeconds * 1000 + 500 - receivedAt
    // Sends' answers that disagree with it by more than a second's width and a slow answer are from before the computer's
    // clock moved: they are dropped until the next send answers.
    if (this.fine.length && Math.abs(this.coarse - median(this.fine)) > coarseAgreement) this.fine = []
    this.changed(before)
  }
  offset(): number { return this.fine.length ? Math.round(median(this.fine)) : this.coarse === null ? 0 : Math.round(this.coarse) }
  now(): number { return this.local() + this.offset() }
  subscribe(listener: (offset: number) => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private changed(before: number): void {
    const after = this.offset()
    if (after !== before) for (const listener of this.listeners) listener(after)
  }
}
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}
// The one clock of the app (one server).
export const serverClock = new ServerClock()
export const serverNow = (): number => serverClock.now()
// The issue time a JWT names, for ServerClock.issued.
export function tokenIssuedAt(token: string): number | null {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const iat = (JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { iat?: unknown }).iat
    return typeof iat === 'number' && Number.isSafeInteger(iat) && iat > 0 ? iat : null
  } catch { return null }
}
