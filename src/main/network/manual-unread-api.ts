import { identifier, object } from '../../shared/validation'
import type { ReadAuthorization, ReadCredentials } from './firestore-rpc'
import { tr } from '../../shared/i18n'

export class ManualUnreadFailure extends Error {
  constructor(readonly uncertain: boolean, message?: string) { super(message ?? (uncertain
    ? tr('읽음 표시의 저장 결과를 확인하지 못했습니다. 자동으로 다시 요청하지 않습니다. 현재 상태를 확인해 주세요.')
    : tr('읽음 표시를 변경하지 못했습니다. 연결·권한과 최신 대화를 확인해 주세요.'))) }
}
export async function setManualUnread(auth: ReadCredentials, chatId: string, markedUnread: boolean, signal: AbortSignal, validate: () => void): Promise<void> {
  identifier(chatId)
  const bounded = AbortSignal.any([auth.signal, signal, AbortSignal.timeout(65000)])
  let authorization: ReadAuthorization
  try { bounded.throwIfAborted(); validate(); authorization = await auth.authorize(bounded, false); bounded.throwIfAborted(); validate() }
  catch { throw new ManualUnreadFailure(false) }
  try {
    const response = await fetch('https://asia-northeast3-talky-a38c3.cloudfunctions.net/setMorseChatUnread', {
      method: 'POST', signal: bounded, redirect: 'error', credentials: 'omit', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authorization.idToken}`, 'X-Firebase-AppCheck': authorization.appCheckToken },
      // The existing command has no operation ID, version or target cursor.
      body: JSON.stringify({ data: { chatId, markedUnread } })
    })
    if (!response.body) throw new ManualUnreadFailure(true)
    const reader = response.body.getReader(), chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const chunk = await reader.read(); bounded.throwIfAborted()
        if (chunk.done) break
        size += chunk.value.byteLength
        if (size > 64 * 1024) throw new ManualUnreadFailure(true)
        chunks.push(chunk.value)
      }
      const raw = object(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      if (!response.ok || raw.error !== undefined) {
        const status = String(object(raw.error ?? {}).status)
        throw new ManualUnreadFailure(!['INVALID_ARGUMENT', 'PERMISSION_DENIED', 'UNAUTHENTICATED', 'FAILED_PRECONDITION', 'NOT_FOUND'].includes(status))
      }
      if (object(raw.result ?? raw.data).ok !== true) throw new ManualUnreadFailure(true)
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  } catch (error) { throw error instanceof ManualUnreadFailure ? error : new ManualUnreadFailure(true) }
}
