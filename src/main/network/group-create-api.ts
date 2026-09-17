import type { GroupCreateRequest } from '../../shared/group-create'
import { identifier, object } from '../../shared/validation'
import type { ReadCredentials, ReadAuthorization } from './firestore-rpc'
import { tr } from '../../shared/i18n'
export class GroupCreateFailure extends Error { constructor(readonly uncertain: boolean) { super(uncertain ? tr('그룹 생성 결과를 확인해야 합니다.') : tr('그룹 생성 요청이 거절되었습니다.')) } }
export async function createGroup(auth: ReadCredentials, uid: string, request: GroupCreateRequest, signal: AbortSignal, validate: () => void,
  autoDelete: { seconds: number; myOnly: boolean } = { seconds: 0, myOnly: false }): Promise<void> {
  const bounded = AbortSignal.any([auth.signal, signal, AbortSignal.timeout(65000)])
  let authorization: ReadAuthorization
  try { bounded.throwIfAborted(); validate(); authorization = await auth.authorize(bounded, false); bounded.throwIfAborted(); validate() }
  catch { throw new GroupCreateFailure(false) }
  try {
    const response = await fetch('https://asia-northeast3-talky-a38c3.cloudfunctions.net/createMorseGroup', {
      method: 'POST', signal: bounded, redirect: 'error', credentials: 'omit', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authorization.idToken}`, 'X-Firebase-AppCheck': authorization.appCheckToken },
      body: JSON.stringify({ data: { chatId: request.chatId, name: request.name, participantUids: [uid, ...request.participantUids],
        ...(autoDelete.seconds > 0 ? { autoDeleteSeconds: autoDelete.seconds, autoDeleteMyOnly: autoDelete.myOnly } : {}) } })
    })
    if (!response.body) throw new GroupCreateFailure(true)
    const reader = response.body.getReader(), chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const chunk = await reader.read(); bounded.throwIfAborted()
        if (chunk.done) break
        size += chunk.value.byteLength
        if (size > 1024 * 1024) throw new GroupCreateFailure(true)
        chunks.push(chunk.value)
      }
      const raw = object(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      if (!response.ok || raw.error !== undefined) {
        const status = String(object(raw.error ?? {}).status)
        throw new GroupCreateFailure(!['INVALID_ARGUMENT', 'PERMISSION_DENIED', 'UNAUTHENTICATED', 'FAILED_PRECONDITION', 'ALREADY_EXISTS'].includes(status))
      }
      const result = object(raw.result ?? raw.data), expected = [uid, ...request.participantUids].sort()
      if (result.chatId !== request.chatId || !Array.isArray(result.participantUids) || result.participantUids.length !== expected.length) throw new GroupCreateFailure(true)
      const members = result.participantUids.map(identifier).sort()
      if (members.some((id, index) => id !== expected[index])) throw new GroupCreateFailure(true)
      const info = object(result.participantInfo)
      for (const id of members) object(info[id])
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); chunks.forEach(chunk => chunk.fill(0)) }
  } catch (error) { throw error instanceof GroupCreateFailure ? error : new GroupCreateFailure(true) }
}
