import type { GroupRemovalRequest } from '../../shared/group-removal'
import { identifier, object } from '../../shared/validation'
import type { ReadCredentials, ReadAuthorization } from './firestore-rpc'
import { tr } from '../../shared/i18n'
export class GroupRemovalFailure extends Error { constructor(readonly uncertain: boolean) { super(uncertain ? tr('참여자 제거 결과를 확인해야 합니다.') : tr('참여자 제거 요청이 거절되었습니다.')) } }
export async function removeGroupMember(auth: ReadCredentials, uid: string, request: GroupRemovalRequest, signal: AbortSignal, validate: () => void): Promise<void> {
  const bounded = AbortSignal.any([auth.signal, signal, AbortSignal.timeout(65000)])
  let authorization: ReadAuthorization
  try { bounded.throwIfAborted(); validate(); authorization = await auth.authorize(bounded, false); bounded.throwIfAborted(); validate() }
  catch { throw new GroupRemovalFailure(false) }
  try {
    const response = await fetch('https://asia-northeast3-talky-a38c3.cloudfunctions.net/updateMorseGroupMembers', {
      method: 'POST', signal: bounded, redirect: 'error', credentials: 'omit', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authorization.idToken}`, 'X-Firebase-AppCheck': authorization.appCheckToken },
      body: JSON.stringify({ data: { chatId: request.chatId, removeUid: request.removeUid } })
    })
    if (!response.body) throw new GroupRemovalFailure(true)
    const reader = response.body.getReader(), chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const chunk = await reader.read(); bounded.throwIfAborted()
        if (chunk.done) break
        size += chunk.value.byteLength
        if (size > 1024 * 1024) throw new GroupRemovalFailure(true)
        chunks.push(chunk.value)
      }
      const raw = object(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      if (!response.ok || raw.error !== undefined) {
        const status = String(object(raw.error ?? {}).status)
        throw new GroupRemovalFailure(!['INVALID_ARGUMENT', 'PERMISSION_DENIED', 'UNAUTHENTICATED', 'FAILED_PRECONDITION', 'ALREADY_EXISTS'].includes(status))
      }
      const result = object(raw.result ?? raw.data)
      if (result.ok !== true || !Array.isArray(result.participantUids) || result.participantUids.length < 1 || result.participantUids.length > 100) throw new GroupRemovalFailure(true)
      const members = result.participantUids.map(identifier)
      if (new Set(members).size !== members.length || !members.includes(uid) || members.includes(request.removeUid)) throw new GroupRemovalFailure(true)
      object(result.participantInfo)
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); chunks.forEach(chunk => chunk.fill(0)) }
  } catch (error) { throw error instanceof GroupRemovalFailure ? error : new GroupRemovalFailure(true) }
}
