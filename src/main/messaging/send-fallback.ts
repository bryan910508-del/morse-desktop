// Portions of this file follow Telegram Desktop (https://github.com/telegramdesktop/tdesktop, 7.2.8, 272f6f5c),
// Copyright (c) 2014-2026 The Telegram Desktop Authors. Licensed under GPL-3.0-or-later; see LEGAL.
import { committedReadAck, committedSendAck, NotEmitted, ProtocolFailure, ServerRejection, SocketUnanswered } from '../network/contracts'
import { MorseCallableFailure } from '../network/morse-callable'
import type { MessagePosition, SendAcknowledgement, SendWire } from '../../shared/model'
import type { ReadAcknowledgement } from '../../shared/read-receipts'
import { tr } from '../../shared/i18n'
import { systemNetwork } from '../network/reachability'
import { serverClock } from '../network/server-clock'

// A15 (contracts/A15-send-fallback.md §3.2-3.3, user «권장대로» 10-03 17:5x; inbox B95 — in Russia the message server's
// socket does not carry, while Google's paths do): a message goes over the socket when it can, and otherwise, under
// the same id, through the Firebase callable that runs the same acceptance (`sendMorseMessage`; reads `markMorseRead`).
// The server takes one id once, by either path, so a socket send that went unanswered and the callable after it are
// one message. Telegram does the same with its own fallbacks: when its server cannot be reached it asks Google and
// Firebase for another way in (tdesktop mtproto/special_config_request.cpp:214-219, 303-309).
// A15-3: the socket gets five seconds to be able to send, and its answer fifteen (socket-transport.ts emitWithAck).
export const socketWaitMs = 5000

export interface SocketPath {
  // Resolves true as soon as a message can go over the socket, false when it cannot within the time.
  whenSendable(ms: number, signal: AbortSignal): Promise<boolean>
  // Since when the socket has been unable to send, null while it can. Without it the wait counts from the send.
  notSendableSince?(): number | null
  send(wire: SendWire, signal: AbortSignal): Promise<SendAcknowledgement>
  markRead(chatId: string, target: MessagePosition, signal: AbortSignal): Promise<ReadAcknowledgement>
}
export type CallablePath = (name: 'sendMorseMessage' | 'markMorseRead', data: Record<string, unknown>, signal: AbortSignal) => Promise<Record<string, unknown>>
// Which way a send or a read went when it did not go over the socket, and why — for connection-check.log, which keeps
// each line once per run: so a run says whether the callable carried anything at all (Railway shows only the socket's).
// Never an id or a word of the message.
export type PathNote = (detail: 'send socket-not-ready' | 'send socket-failed' | 'read socket-not-ready' | 'read socket-failed') => void

// The callable answers with the socket's own acknowledgement (§3.3), read by the same committedSendAck/ReadAck: a refusal
// is the socket's refusal (B88's DIRECT_CHAT_EXISTS with its room included). A request that never left goes again as one
// that never left; anything else the callable says — no answer, a timeout, UNAUTHENTICATED — is «sending, try again»
// (§3.3), which the outbox does under the same id after checking the server (uncertain).
// The system's word on the network (reachability.ts SystemNetwork).
export interface NetworkPath {
  readonly online: boolean
  readonly onlineSince: number
  whenOnline(signal: AbortSignal): Promise<void>
}

// Three apps, one rule (review 10-12 21:5x): the five seconds count from the moment the network is there and the socket
// cannot send — the later of the socket losing its way and the network coming back. While there is no network nothing
// counts and nothing goes by the callable; a network that carries everything but the socket gives it five seconds, as
// before. A wait the network leaves in the middle starts again from its return.
async function socketReady(socket: SocketPath, network: NetworkPath, signal: AbortSignal, now: () => number = Date.now): Promise<boolean> {
  const begun = now()
  for (;;) {
    if (!network.online) { await network.whenOnline(signal); if (signal.aborted) return false }
    const since = socket.notSendableSince ? socket.notSendableSince() : begun
    if (since === null) return true
    const start = Math.max(since, network.onlineSince)
    const ready = await socket.whenSendable(Math.max(0, socketWaitMs - (now() - start)), signal)
    if (ready || signal.aborted) return ready
    if (network.online && network.onlineSince <= start) return false
  }
}

// B441 (reports/server/2026-10-16-b441-fallback-reason.md §2, the three apps' one table): why the callable carries it —
// the socket was not registered to send, its answer did not come in time, or it went before the answer came.
export type FallbackReason = 'not-registered' | 'ack-timeout' | 'disconnected' | 'other'
export function fallbackReason(error: unknown): FallbackReason {
  if (error instanceof NotEmitted) return 'not-registered'
  if (error instanceof SocketUnanswered) return error.reason
  return 'other'
}

async function socketFirst<T>(socket: SocketPath, signal: AbortSignal, bySocket: () => Promise<T>, byCallable: (reason: FallbackReason) => Promise<T>,
  what: 'send' | 'read', note?: PathNote, network: NetworkPath = systemNetwork): Promise<T> {
  let reason: FallbackReason = 'not-registered'
  if (await socketReady(socket, network, signal)) {
    try { return await bySocket() }
    catch (error) { if (error instanceof ServerRejection || signal.aborted) throw error; reason = fallbackReason(error) }
    note?.(`${what} socket-failed`)
  } else note?.(`${what} socket-not-ready`)
  signal.throwIfAborted()
  try { return await byCallable(reason) }
  catch (error) {
    if (!(error instanceof MorseCallableFailure)) throw error
    throw error.delivery === 'not-sent' ? new NotEmitted(tr('연결을 기다리고 있습니다.')) : new ProtocolFailure(tr('전송 결과를 확인해야 합니다.'))
  }
}

export function sendWithFallback(wire: SendWire, signal: AbortSignal, socket: SocketPath, callable: CallablePath, note?: PathNote,
  network?: NetworkPath): Promise<SendAcknowledgement> {
  return socketFirst(socket, signal, () => socket.send(wire, signal),
    async reason => {
      const sentAt = Date.now(), ack = committedSendAck(await callable('sendMorseMessage', { ...wire, fallbackReason: reason }, signal), wire)
      // B409-2: the server's date for the message it took, as on the socket (server-clock.ts).
      if (!ack.alreadyExisted) serverClock.answered(sentAt, Date.now(), ack.createdAt)
      return ack
    }, 'send', note, network)
}

export function markReadWithFallback(chatId: string, readerId: string, target: MessagePosition, signal: AbortSignal, socket: SocketPath,
  callable: CallablePath, note?: PathNote, network?: NetworkPath): Promise<ReadAcknowledgement> {
  return socketFirst(socket, signal, () => socket.markRead(chatId, target, signal),
    async reason => committedReadAck(await callable('markMorseRead', { chatId, messageId: target.id, fallbackReason: reason }, signal), chatId, readerId, target), 'read', note, network)
}
