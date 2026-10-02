import { status } from '@grpc/grpc-js'

// What became of one Firestore write sent over gRPC, drawn as morse-callable.ts draws it for a callable:
// - 'not-sent': @grpc/grpc-js never gave the call a transport stream. It fails such a call in one of two ways: the
//   picker had no ready connection (UNAVAILABLE «No connection established. Last error: …», picker.js
//   UnavailablePicker and load-balancer-pick-first.js; «Name resolution failed for target …», resolver-dns.js), or the
//   deadline passed while the call still waited for one («Waiting for LB pick», «waiting for name resolution»,
//   load-balancing-call.js and resolving-call.js getDeadlineInfo, which name the stage only while no stream exists).
//   No byte of the write left, so it may go again. (@grpc/grpc-js 1.14.4; test/unit/grpc-delivery.test.ts holds
//   these messages to the library as installed.)
// - 'refused': the server answered with one of the codes the caller names as final.
// - 'unknown': anything else — the write may have been applied.
export type WriteDelivery = 'not-sent' | 'unknown' | 'refused'
export function grpcDelivery(error: { code?: number; details?: string }, refusals: readonly number[]): WriteDelivery {
  const details = typeof error.details === 'string' ? error.details : ''
  if (error.code === status.UNAVAILABLE && (details.includes('No connection established') || details.startsWith('Name resolution failed'))) return 'not-sent'
  if (error.code === status.DEADLINE_EXCEEDED && (details.includes('Waiting for LB pick') || details.includes('waiting for name resolution'))) return 'not-sent'
  return typeof error.code === 'number' && refusals.includes(error.code) ? 'refused' : 'unknown'
}
// The same failure as a short code for connection-check.log: the status name, and for a call that never reached the
// server, which of the ways above kept it here. The details text itself is not kept: it can name an address.
export function grpcCode(error: { code?: number; details?: string }): string {
  const name = typeof error.code === 'number' ? status[error.code] ?? String(error.code) : 'NO_STATUS'
  const details = typeof error.details === 'string' ? error.details : ''
  const stage = details.includes('No connection established') ? 'no-connection' : details.startsWith('Name resolution failed') ? 'no-address'
    : details.includes('Waiting for LB pick') || details.includes('waiting for name resolution') ? 'no-pick' : ''
  return stage ? `${name}/${stage}` : name
}
// Statuses only the server gives: a call that ends with one of them reached it. The others may be the transport's own.
const answers = new Set<number>([status.INVALID_ARGUMENT, status.NOT_FOUND, status.ALREADY_EXISTS, status.PERMISSION_DENIED, status.FAILED_PRECONDITION,
  status.UNAUTHENTICATED, status.RESOURCE_EXHAUSTED, status.ABORTED, status.OUT_OF_RANGE, status.UNIMPLEMENTED])
export function serverAnswered(code: number | undefined): boolean { return typeof code === 'number' && answers.has(code) }
