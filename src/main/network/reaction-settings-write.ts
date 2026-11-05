import type { ClientUnaryCall, Metadata, ServiceError } from '@grpc/grpc-js'
import { status } from '@grpc/grpc-js'
import type { ReactionSettingsPatch } from '../../shared/reaction-settings'
import { database, documents, timestamp, type WireObject } from './firestore-values'
import { tr } from '../../shared/i18n'

export class ReactionSettingsWriteFailure extends Error {
  constructor(readonly uncertain: boolean) { super(uncertain ? tr('반응 알림 설정 저장 결과를 확인하지 못했습니다. 잠시 후 다시 확인해 주세요.') : tr('반응 알림 설정을 저장하지 못했습니다.')) }
}
interface CommitClient {
  commit(request: WireObject, metadata: Metadata, options: { deadline: Date }, callback: (error: ServiceError | null, response: WireObject) => void): ClientUnaryCall
}
// B545 §5: only the changed fields of users/{uid}/settings/notify.reactions, as the phones merge them (iOS
// MorseNotifySettingsStore.set(["reactions.messages": …])): one commit with an update mask, the document made when there
// is none, nothing else of it touched — no transaction (this project's database refuses them).
export function reactionSettingsWrite(uid: string, patch: ReactionSettingsPatch): WireObject {
  const fields: Record<string, WireObject> = {}
  for (const [key, value] of Object.entries(patch)) fields[key] = typeof value === 'boolean' ? { booleanValue: value } : { stringValue: value }
  return { update: { name: `${documents}/users/${uid}/settings/notify`, fields: { reactions: { mapValue: { fields } } } },
    updateMask: { fieldPaths: Object.keys(fields).map(key => `reactions.${key}`) } }
}
export async function writeReactionSettings(client: CommitClient, auth: Metadata, uid: string, patch: ReactionSettingsPatch, signal: AbortSignal): Promise<void> {
  if (signal.aborted || !Object.keys(patch).length) throw new ReactionSettingsWriteFailure(false)
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: ReactionSettingsWriteFailure): void => {
      if (settled) return
      settled = true; signal.removeEventListener('abort', cancel)
      if (error) reject(error); else resolve()
    }
    const cancel = (): void => { call.cancel(); finish(new ReactionSettingsWriteFailure(true)) }
    const call = client.commit({ database, writes: [reactionSettingsWrite(uid, patch)] }, auth, { deadline: new Date(Date.now() + 30000) }, (error, response) => {
      if (error) {
        const definite = [status.ABORTED, status.ALREADY_EXISTS, status.FAILED_PRECONDITION, status.INVALID_ARGUMENT, status.NOT_FOUND, status.PERMISSION_DENIED, status.UNAUTHENTICATED].includes(error.code)
        finish(new ReactionSettingsWriteFailure(!definite)); return
      }
      try {
        if (!Array.isArray(response.writeResults) || response.writeResults.length !== 1 || !response.commitTime) throw new Error('Invalid reaction settings commit')
        timestamp(response.commitTime, ''); finish()
      } catch { finish(new ReactionSettingsWriteFailure(true)) }
    })
    signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel()
  })
}
