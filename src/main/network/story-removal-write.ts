import { ownStoryCollections } from './own-story-document'
import type { ClientUnaryCall, Metadata, ServiceError } from '@grpc/grpc-js'
import { status } from '@grpc/grpc-js'
import { storyRemovalRequest, type StoryRemovalRequest } from '../../shared/story-removal'
import { database, documents, timestamp, type WireObject } from './firestore-values'
import { object } from '../../shared/validation'
import { tr } from '../../shared/i18n'
export class StoryRemovalFailure extends Error {
  constructor(readonly uncertain: boolean) { super(uncertain ? tr('스토리 삭제 결과를 확인하지 못했습니다. 같은 요청을 반복하지 말고 현재 스토리를 확인해 주세요.') : tr('스토리가 변경되었거나 쓰기 권한을 확인하지 못했습니다. 최신 스토리에서 다시 선택해 주세요.')) }
}
interface CommitClient { commit(request: WireObject, metadata: Metadata, options: { deadline: Date }, callback: (error: ServiceError | null, response: WireObject) => void): ClientUnaryCall }
export async function writeStoryRemoval(client: CommitClient, auth: Metadata, uid: string, input: StoryRemovalRequest, signal: AbortSignal): Promise<void> {
  const request = storyRemovalRequest(input), path = `${documents}/users/${uid}/${ownStoryCollections[request.privacy]}/${request.storyId}`
  const [seconds, nanos] = request.version.split(':')
  const updateTime = { seconds, nanos: Number(nanos) }
  try {
    const at = timestamp(updateTime, '')
    if (signal.aborted || request.ownerId !== uid || `${at.seconds}:${at.nanoseconds}` !== request.version || at.nanoseconds % 1000 !== 0) throw new Error('Unsupported base timestamp')
  } catch { throw new StoryRemovalFailure(false) }
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: StoryRemovalFailure): void => { if (settled) return; settled = true; signal.removeEventListener('abort', cancel); if (error) reject(error); else resolve() }
    const cancel = (): void => { call.cancel(); finish(new StoryRemovalFailure(true)) }
    const call = client.commit({ database, writes: [{ delete: path, currentDocument: { updateTime } }] }, auth, { deadline: new Date(Date.now() + 30000) }, (error, response) => {
      if (error) { finish(new StoryRemovalFailure(![status.ABORTED, status.ALREADY_EXISTS, status.FAILED_PRECONDITION, status.INVALID_ARGUMENT, status.NOT_FOUND, status.PERMISSION_DENIED, status.UNAUTHENTICATED].includes(error.code))); return }
      try {
        if (!Array.isArray(response.writeResults) || response.writeResults.length !== 1 || !response.commitTime) throw new Error('Incomplete note removal commit')
        timestamp(response.commitTime, ''); object(response.writeResults[0]); finish()
      } catch { finish(new StoryRemovalFailure(true)) }
    })
    signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel()
  })
}
