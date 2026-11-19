import { identifier } from '../../shared/validation'
import { publicMorseId } from '../../shared/contacts'
import type { ReadCredentials } from './firestore-rpc'
import { callMorseFunction, MorseCallableFailure, transientAnswers } from './morse-callable'
import { recordContactStep } from '../platform/contact-diagnostics'
import { tr } from '../../shared/i18n'

export interface PublicContact { uid: string; userId: string; displayName: string; photoURL: string }

// A5 (reports/desktop/2026-11-06-a5-lookup-plan.md, review 11-06 12:00): the look-up only reads, so a failure that
// may be passing — not sent, an answer that never came whole (a connection cut after it was made, a server INTERNAL,
// UNAVAILABLE or DEADLINE_EXCEEDED), or a transient refusal — is asked again within the same 35 s, after 1 s and 2 s,
// before anything is said. tdesktop's resolveUsername shows only a definite answer (400 → «not found») and leaves the
// rest to its connection (window_session_controller.cpp:545-554). A definite refusal, the owner going away, or a wait
// the server asks for that is longer than the time left ends it at once. RESOURCE_EXHAUSTED may be the server's own
// limit on looking people up: it is asked again only when it says how long to wait, and only once. Writes are never
// sent again this way (a second send may do them twice — B40).
export const lookupTime = 35000
export const lookupPauses: readonly number[] = [1000, 2000]

export interface LookupWays {
  call: typeof callMorseFunction
  pause(ms: number, signal: AbortSignal): Promise<void>
  record(step: string, detail: string): void
  now(): number
}
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return }
    const stop = (): void => { clearTimeout(timer); reject(signal.reason) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', stop); resolve() }, ms)
    signal.addEventListener('abort', stop, { once: true })
  })
}
const ways: LookupWays = { call: callMorseFunction, pause, record: recordContactStep, now: () => Date.now() }

// What a failure was, for contact-check.log: the codes only.
export function lookupFailureCode(error: unknown): string {
  return error instanceof MorseCallableFailure ? `${error.delivery}:${error.status}:${error.transport}` : error instanceof Error ? error.name : 'unknown'
}
// How long to wait before asking again, or null to stop. `attempt` is the try that just failed (0 first);
// `exhausted` whether a RESOURCE_EXHAUSTED was already asked again once.
export function lookupRetryWait(error: unknown, attempt: number, remaining: number, exhausted: boolean): number | null {
  if (!(error instanceof MorseCallableFailure) || attempt >= lookupPauses.length) return null
  if (error.delivery === 'answered' && !transientAnswers.has(error.status)) return null
  let wait = lookupPauses[attempt]!
  if (error.status === 'RESOURCE_EXHAUSTED') {
    if (!error.retryAfterSec || exhausted) return null
    wait = Math.max(wait, error.retryAfterSec * 1000)
  }
  return wait < remaining ? wait : null
}

// privateIsMissing (N-49's profile link): a private account is «not found», as iOS openProfileLink says of one.
export async function lookupContact(auth: ReadCredentials, publicId: string, owner: AbortSignal, privateIsMissing = false, how: LookupWays = ways): Promise<PublicContact | null> {
  const userId = publicMorseId(publicId), deadline = how.now() + lookupTime
  let result: Record<string, unknown> | null = null, first: string | null = null, exhausted = false
  for (let attempt = 0; !result; attempt++) {
    try {
      result = await how.call(auth, 'lookupUserByTalkyId', { userId, purpose: 'public' }, owner,
        { timeout: Math.max(1, deadline - how.now()), limit: 64 * 1024, refreshUnauthenticated: true })
      // One look-up, two lines at most: how it first failed (above), and that a later try answered.
      if (first) how.record('lookup-retried', `answered #${attempt + 1}`)
    } catch (error) {
      const code = lookupFailureCode(error)
      if (!first) { first = code; how.record('lookup-failed', code) }
      const wait = owner.aborted ? null : lookupRetryWait(error, attempt, deadline - how.now(), exhausted)
      if (wait === null) {
        if (attempt > 0) how.record('lookup-retried', `failed #${attempt + 1} ${code}`)
        throw new Error(tr('ID 검색을 완료하지 못했습니다. 잠시 후 다시 검색해 주세요.'))
      }
      if (error instanceof MorseCallableFailure && error.status === 'RESOURCE_EXHAUSTED') exhausted = true
      try { await how.pause(wait, owner) } catch { throw new Error(tr('ID 검색을 완료하지 못했습니다. 잠시 후 다시 검색해 주세요.')) }
    }
  }
  if (result.found === false || (privateIsMissing && result.found === true && result.isPrivate === true)) return null
  if (result.found !== true || result.isPrivate === true || publicMorseId(result.userId) !== publicId) throw new Error(tr('검색 응답을 확인하지 못했습니다.'))
  if (typeof result.displayName !== 'string' || !result.displayName.trim() || result.displayName.length > 512 ||
    typeof result.photoURL !== 'string' || result.photoURL.length > 10000) throw new Error(tr('프로필 응답을 확인하지 못했습니다.'))
  return { uid: identifier(result.uid), userId: publicId, displayName: result.displayName.trim(), photoURL: result.photoURL }
}
