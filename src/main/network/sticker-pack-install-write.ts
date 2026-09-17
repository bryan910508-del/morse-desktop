import type { ClientUnaryCall, Metadata, ServiceError } from '@grpc/grpc-js'
import { status } from '@grpc/grpc-js'
import type { StickerPack } from '../../shared/sticker-packs'
import { identifier } from '../../shared/validation'
import { database, documents, type WireObject } from './firestore-values'
import { tr } from '../../shared/i18n'

// users/{uid}/stickerSets/{setId}: the account's installed sticker sets, as iOS MorseStickerSetStore.install /
// uninstall write them (Telegram addStickerPackInteractively / removeStickerPackInteractively).
export class StickerPackInstallFailure extends Error {
  constructor(readonly uncertain: boolean) { super(uncertain ? tr('스티커팩 변경 결과를 확인하지 못했습니다.') : tr('스티커팩을 변경하지 못했습니다.')) }
}
interface CommitClient {
  commit(request: WireObject, metadata: Metadata, options: { deadline: Date }, callback: (error: ServiceError | null, response: WireObject) => void): ClientUnaryCall
}
const definite = new Set([status.PERMISSION_DENIED, status.UNAUTHENTICATED, status.FAILED_PRECONDITION, status.INVALID_ARGUMENT, status.NOT_FOUND])

function commit(client: CommitClient, auth: Metadata, writes: WireObject[], signal: AbortSignal, validate: () => void): Promise<void> {
  signal.throwIfAborted(); validate()
  return new Promise((done, reject) => {
    let settled = false
    const finish = (error: unknown): void => {
      if (settled) return
      settled = true; signal.removeEventListener('abort', cancel)
      if (!error) { done(); return }
      const code = error && typeof error === 'object' ? (error as { code?: number }).code : undefined
      reject(error instanceof StickerPackInstallFailure ? error : new StickerPackInstallFailure(!(typeof code === 'number' && definite.has(code))))
    }
    const cancel = (): void => { call.cancel(); finish(new StickerPackInstallFailure(true)) }
    const call = client.commit({ database, writes }, auth, { deadline: new Date(Date.now() + 30000) }, error => finish(error))
    signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel()
  })
}

export function writeStickerPackInstall(client: CommitClient, auth: Metadata, uid: string, pack: StickerPack, signal: AbortSignal, validate: () => void): Promise<void> {
  const name = `${documents}/users/${identifier(uid)}/stickerSets/${identifier(pack.id)}`
  const fields: Record<string, WireObject> = {
    title: { stringValue: pack.title.slice(0, 64) }, ownerUid: { stringValue: pack.ownerUid }, count: { integerValue: String(pack.items.length) }
  }
  return commit(client, auth, [{ update: { name, fields }, updateTransforms: [{ fieldPath: 'installedAt', setToServerValue: 'REQUEST_TIME' }] }], signal, validate)
}

export function writeStickerPackUninstall(client: CommitClient, auth: Metadata, uid: string, setId: string, signal: AbortSignal, validate: () => void): Promise<void> {
  return commit(client, auth, [{ delete: `${documents}/users/${identifier(uid)}/stickerSets/${identifier(setId)}` }], signal, validate)
}
