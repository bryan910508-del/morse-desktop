import { AuthenticationFailure } from '../auth/contracts'
import { ChannelCommentCreationFailure } from '../network/channel-comment-creation-write'
import { ChannelPostCreationFailure } from '../network/channel-post-creation-write'
import { MessageMutationFailure, NotEmitted } from '../network/contracts'
import { ReadFailure } from '../network/firestore-values'
import { grpcCode, grpcDelivery, serverAnswered } from '../network/grpc-delivery'
import { MorseCallableFailure } from '../network/morse-callable'
import { causeCode } from '../network/resend'
import { UploadRefused } from '../network/upload-refused'

// What one failed attempt was, drawn as the rule for sending again draws it (user decision 2026-09-29): the request
// never left («안 보냄», 'not-sent'), it may have been carried out («모름», 'unknown'), or the server answered it
// («서버 답», 'answered'); and a short code for which: a status name, an errno, a failure class. Never a message, a
// value, an address or a token, since those can hold an account's data.
export type FailureDelivery = 'not-sent' | 'unknown' | 'answered'
export interface FailureKind { delivery: FailureDelivery; code: string }

const join = (...parts: string[]): string => parts.filter(Boolean).join('/')
const statusName = (value: string): string => /^[A-Z_]{1,32}$/.test(value) ? value : 'OTHER'

export function failureKind(error: unknown): FailureKind {
  if (error instanceof NotEmitted) return { delivery: 'not-sent', code: 'not-emitted' }
  if (error instanceof MorseCallableFailure) return { delivery: error.delivery, code: join('callable', statusName(error.status), error.transport) }
  if (error instanceof ReadFailure) {
    // A read that never reached the server says so in its gRPC reason (grpc-delivery.ts grpcCode).
    const delivery = error.code === 'network' || error.code === 'cancelled' ? (/\/no-(connection|address|pick)$/.test(error.reason) ? 'not-sent' : 'unknown') : 'answered'
    return { delivery, code: join('read', error.code, error.reason) }
  }
  if (error instanceof ChannelPostCreationFailure || error instanceof ChannelCommentCreationFailure) {
    return { delivery: error.delivery === 'refused' ? 'answered' : error.delivery, code: join('commit', error.code) }
  }
  if (error instanceof UploadRefused) return { delivery: 'answered', code: 'upload-refused' }
  // The account's token or proof could not be had, so the request itself was never made.
  if (error instanceof AuthenticationFailure) return { delivery: 'not-sent', code: join('auth', error.code) }
  if (error instanceof MessageMutationFailure) return { delivery: error.definitive ? 'answered' : 'unknown', code: 'mutation' }
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined
  if (typeof code === 'number') {
    const grpc = error as { code: number; details?: string }
    return { delivery: grpcDelivery(grpc, []) === 'not-sent' ? 'not-sent' : serverAnswered(code) ? 'answered' : 'unknown', code: grpcCode(grpc) }
  }
  return { delivery: 'unknown', code: causeCode(error) }
}
