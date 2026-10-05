import { committedReadAck, committedSendAck, NotEmitted, ProtocolFailure, ServerRejection } from '../network/contracts'
import { MorseCallableFailure } from '../network/morse-callable'
import type { MessagePosition, SendAcknowledgement, SendWire } from '../../shared/model'
import type { ReadAcknowledgement } from '../../shared/read-receipts'
import { tr } from '../../shared/i18n'

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
async function socketFirst<T>(socket: SocketPath, signal: AbortSignal, bySocket: () => Promise<T>, byCallable: () => Promise<T>,
  what: 'send' | 'read', note?: PathNote): Promise<T> {
  if (await socket.whenSendable(socketWaitMs, signal)) {
    try { return await bySocket() }
    catch (error) { if (error instanceof ServerRejection || signal.aborted) throw error }
    note?.(`${what} socket-failed`)
  } else note?.(`${what} socket-not-ready`)
  signal.throwIfAborted()
  try { return await byCallable() }
  catch (error) {
    if (!(error instanceof MorseCallableFailure)) throw error
    throw error.delivery === 'not-sent' ? new NotEmitted(tr('연결을 기다리고 있습니다.')) : new ProtocolFailure(tr('전송 결과를 확인해야 합니다.'))
  }
}

export function sendWithFallback(wire: SendWire, signal: AbortSignal, socket: SocketPath, callable: CallablePath, note?: PathNote): Promise<SendAcknowledgement> {
  return socketFirst(socket, signal, () => socket.send(wire, signal),
    async () => committedSendAck(await callable('sendMorseMessage', { ...wire }, signal), wire), 'send', note)
}

export function markReadWithFallback(chatId: string, readerId: string, target: MessagePosition, signal: AbortSignal, socket: SocketPath,
  callable: CallablePath, note?: PathNote): Promise<ReadAcknowledgement> {
  return socketFirst(socket, signal, () => socket.markRead(chatId, target, signal),
    async () => committedReadAck(await callable('markMorseRead', { chatId, messageId: target.id }, signal), chatId, readerId, target), 'read', note)
}
