import { object } from '../../shared/validation'
import type { ReadAuthorization, ReadCredentials } from './firestore-rpc'
import { tr } from '../../shared/i18n'

const definite = ['INVALID_ARGUMENT', 'PERMISSION_DENIED', 'UNAUTHENTICATED', 'NOT_FOUND', 'FAILED_PRECONDITION', 'ALREADY_EXISTS', 'RESOURCE_EXHAUSTED']
export class MorseCallableFailure extends Error {
  constructor(readonly status: string, readonly uncertain: boolean) { super(uncertain ? tr('요청 결과를 확인하지 못했습니다.') : tr('요청이 거절되었습니다.')) }
}

// Firebase callable protocol over HTTPS with the account's ID token and App Check proof.
export async function callMorseFunction(auth: ReadCredentials, name: string, data: Record<string, unknown>, signal: AbortSignal): Promise<Record<string, unknown>> {
  const bounded = AbortSignal.any([auth.signal, signal, AbortSignal.timeout(65000)])
  let authorization: ReadAuthorization
  try { bounded.throwIfAborted(); authorization = await auth.authorize(bounded, false); bounded.throwIfAborted() }
  catch { throw new MorseCallableFailure('UNAVAILABLE', false) }
  try {
    const response = await fetch(`https://asia-northeast3-talky-a38c3.cloudfunctions.net/${name}`, {
      method: 'POST', signal: bounded, redirect: 'error', credentials: 'omit', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authorization.idToken}`, 'X-Firebase-AppCheck': authorization.appCheckToken },
      body: JSON.stringify({ data })
    })
    if (!response.body) throw new MorseCallableFailure('UNKNOWN', true)
    const reader = response.body.getReader(), chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const chunk = await reader.read(); bounded.throwIfAborted()
        if (chunk.done) break
        size += chunk.value.byteLength
        if (size > 256 * 1024) throw new MorseCallableFailure('UNKNOWN', true)
        chunks.push(chunk.value)
      }
      const raw = object(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      if (!response.ok || raw.error !== undefined) {
        const status = String(object(raw.error ?? {}).status)
        throw new MorseCallableFailure(status, !definite.includes(status))
      }
      const result = raw.result ?? raw.data
      return result && typeof result === 'object' && !Array.isArray(result) ? result as Record<string, unknown> : {}
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); chunks.forEach(chunk => chunk.fill(0)) }
  } catch (error) { throw error instanceof MorseCallableFailure ? error : new MorseCallableFailure('UNKNOWN', true) }
}
