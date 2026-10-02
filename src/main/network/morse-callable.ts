import { object } from '../../shared/validation'
import type { ReadAuthorization, ReadCredentials } from './firestore-rpc'
import { causeCode, unsentReason } from './resend'
import { reachability } from './reachability'
import { tr } from '../../shared/i18n'

// What became of one callable request, which is what decides whether it may go again:
// - 'not-sent': it never left this device — the account's proof could not be had, or the connection was never
//   made (resend.ts unsentReason: no name, refused, unreachable, connect timeout). Sending it again is always safe.
// - 'unknown': it may have reached the function — the connection broke or timed out after it was made, the answer
//   was not the function's own (a gateway page), or the function said INTERNAL, UNAVAILABLE or DEADLINE_EXCEEDED,
//   which it may say after doing part of its work. A request with an id the server keeps goes again under that id;
//   any other is checked on the server first.
// - 'answered': the function refused it with any other status. That answer stands.
// Telegram draws the same line: MTProto resends what the connection never carried (SessionPrivate::resend) and
// gives the caller the server's RPC error as it came. The Firebase SDK cannot draw it — it turns every network
// failure into `internal` and drops the cause (@firebase/functions postJSON, codeForHTTPStatus(0)) — so the
// callable protocol is spoken here, over one fetch whose cause survives.
export type CallableDelivery = 'not-sent' | 'unknown' | 'answered'
export class MorseCallableFailure extends Error {
  // transport: why no answer came (an errno, 'auth', 'body', 'non-json'), for connection-check.log only.
  constructor(readonly delivery: CallableDelivery, readonly status: string, readonly reason = '', readonly transport = '') {
    super(delivery === 'answered' ? tr('요청이 거절되었습니다.') : delivery === 'not-sent' ? tr('요청을 보내지 못했습니다. 연결을 확인해 주세요.') : tr('요청 결과를 확인하지 못했습니다.'))
  }
  // Whether the request may have been carried out: only 'unknown' leaves that open.
  get uncertain(): boolean { return this.delivery === 'unknown' }
}

// The canonical codes a callable answers with (functions/v2 https FunctionsErrorCode, in the wire's upper case).
const statuses = new Set(['CANCELLED', 'UNKNOWN', 'INVALID_ARGUMENT', 'DEADLINE_EXCEEDED', 'NOT_FOUND', 'ALREADY_EXISTS', 'PERMISSION_DENIED',
  'RESOURCE_EXHAUSTED', 'FAILED_PRECONDITION', 'ABORTED', 'OUT_OF_RANGE', 'UNIMPLEMENTED', 'INTERNAL', 'UNAVAILABLE', 'DATA_LOSS', 'UNAUTHENTICATED'])
// A function that fails part of the way through says one of these (user decision 2026-09-29: «모름»).
const partial = new Set(['INTERNAL', 'UNAVAILABLE', 'DEADLINE_EXCEEDED'])

// What the function's answer says, from the status line and the body as they came.
export function callableAnswer(ok: boolean, body: string): Record<string, unknown> {
  let raw: Record<string, unknown>
  // Not JSON: a page from the load balancer in front of the function, not the function's answer.
  try { raw = object(JSON.parse(body)) } catch { throw new MorseCallableFailure('unknown', 'UNKNOWN', '', 'non-json') }
  if (!ok || raw.error !== undefined) {
    const error = raw.error && typeof raw.error === 'object' && !Array.isArray(raw.error) ? raw.error as Record<string, unknown> : {}
    const details = error.details && typeof error.details === 'object' && !Array.isArray(error.details) ? error.details as Record<string, unknown> : {}
    const status = typeof error.status === 'string' ? error.status : '', reason = typeof details.reason === 'string' ? details.reason.slice(0, 160) : ''
    if (!statuses.has(status)) throw new MorseCallableFailure('unknown', status.slice(0, 64) || 'UNKNOWN', reason)
    throw new MorseCallableFailure(partial.has(status) ? 'unknown' : 'answered', status, reason)
  }
  const result = raw.result ?? raw.data
  return result && typeof result === 'object' && !Array.isArray(result) ? result as Record<string, unknown> : {}
}

export interface CallOptions {
  // Checked before the request leaves and again once the account's proof is in hand; a throw means nothing was sent.
  validate?: () => void
  timeout?: number
  // The most of an answer that is read.
  limit?: number
  // A 401 answered to a proof that had just expired is asked once more with a fresh one (the chat upload's rule).
  refreshUnauthenticated?: boolean
}
const endpoint = 'https://asia-northeast3-talky-a38c3.cloudfunctions.net'
// resend.ts: a connection that was never made is tried again after one, two and four seconds.
const resendDelays: readonly number[] = [1000, 2000, 4000]

function pause(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((done, fail) => {
    const stop = (): void => { clearTimeout(timer); fail(new Error('Resend cancelled')) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', stop); done() }, milliseconds)
    signal.addEventListener('abort', stop, { once: true }); if (signal.aborted) stop()
  })
}
async function readText(response: Response, limit: number, signal: AbortSignal): Promise<string> {
  if (!response.body) throw new Error('No body')
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const chunk = await reader.read(); signal.throwIfAborted()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > limit) throw new Error('Answer too large')
      chunks.push(chunk.value)
    }
    const whole = Buffer.concat(chunks), text = whole.toString('utf8')
    whole.fill(0)
    return text
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); chunks.forEach(chunk => chunk.fill(0)) }
}

// Firebase callable protocol over HTTPS with the account's ID token and App Check proof.
export function callMorseFunction(auth: ReadCredentials, name: string, data: Record<string, unknown>, signal: AbortSignal, options: CallOptions = {}): Promise<Record<string, unknown>> {
  return callFunctionAt(`${endpoint}/${name}`, auth, data, signal, options)
}
export async function callFunctionAt(url: string, auth: ReadCredentials, data: Record<string, unknown>, signal: AbortSignal, options: CallOptions = {},
  delays: readonly number[] = resendDelays): Promise<Record<string, unknown>> {
  const bounded = AbortSignal.any([auth.signal, signal, AbortSignal.timeout(options.timeout ?? 65000)])
  const notSent = (transport: string): MorseCallableFailure => new MorseCallableFailure('not-sent', 'UNAVAILABLE', '', transport)
  for (let proof = 0; ; proof++) {
    let authorization: ReadAuthorization
    try { bounded.throwIfAborted(); options.validate?.(); authorization = await auth.authorize(bounded, proof > 0); bounded.throwIfAborted(); options.validate?.() }
    catch (error) { throw notSent(`auth:${causeCode(error)}`) }
    let response: Response | null = null
    for (let attempt = 0; !response; attempt++) {
      try {
        response = await fetch(url, {
          method: 'POST', signal: bounded, redirect: 'error', credentials: 'omit', cache: 'no-store',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authorization.idToken}`, 'X-Firebase-AppCheck': authorization.appCheckToken },
          body: JSON.stringify({ data })
        })
      } catch (error) {
        // Only a connection that was never made proves the request stayed here; anything else may have reached it.
        if (!unsentReason(error)) throw new MorseCallableFailure('unknown', 'UNKNOWN', '', causeCode(error))
        reachability.lost()
        if (attempt >= delays.length) throw notSent(unsentReason(error))
        try { await pause(delays[attempt]!, bounded); options.validate?.() } catch { throw notSent(unsentReason(error)) }
      }
    }
    reachability.reached('https')
    if (response.status === 401 && options.refreshUnauthenticated && proof === 0) { await response.body?.cancel().catch(() => {}); continue }
    let body: string
    try { body = await readText(response, options.limit ?? 256 * 1024, bounded) } catch { throw new MorseCallableFailure('unknown', 'UNKNOWN', '', 'body') }
    return callableAnswer(response.ok, body)
  }
}
