import type { PostRemovalTarget, PostRemovalResult } from '../../shared/channel-post-removal'
import { FirestoreReader, type ReadCredentials } from '../network/firestore-rpc'
import { ChannelPostRemovalFailure } from '../network/channel-post-removal-write'
import type { PostRemovalSource } from '../network/channel-post-removal-write'
import { tr } from '../../shared/i18n'

export class ChannelPostRemovalEditor {
  private closed = false
  private selection: string | null = null
  private active: { request: PostRemovalTarget; abort: AbortController; task: Promise<PostRemovalResult> } | null = null
  private attempts = new Map<string, { request: PostRemovalTarget; task: Promise<PostRemovalResult> }>()
  constructor(private readonly uid: string, private readonly auth: ReadCredentials, private readonly source: (request: PostRemovalTarget, exact: boolean) => PostRemovalSource) {}
  open(requestId: string): void { if (this.selection !== requestId) { this.pause(); this.selection = requestId; this.attempts.clear() } }
  dismiss(requestId: string): void { if (this.selection === requestId) { this.pause(); this.selection = null; this.attempts.clear() } }
  pause(): void { this.active?.abort.abort() }
  prune(): void { if (this.active) { try { this.source(this.active.request, false) } catch { this.pause() } } }
  save(request: PostRemovalTarget): Promise<PostRemovalResult> {
    if (this.closed || this.selection !== request.requestId) throw new Error(tr('현재 채널 정보를 다시 열어 주세요.'))
    const previous = this.attempts.get(request.id)
    if (previous) {
      if (JSON.stringify(previous.request) !== JSON.stringify(request)) throw new Error(tr('같은 저장 요청의 내용을 바꿀 수 없습니다.'))
      return previous.task
    }
    if (this.active || this.attempts.size >= 100) throw new Error(tr('진행 중인 저장을 마치고 채널 정보를 다시 열어 주세요.'))
    this.source(request, true)
    const abort = new AbortController()
    const task = this.write(request, abort.signal).finally(() => { if (this.active?.abort === abort) this.active = null })
    this.active = { request, abort, task }; this.attempts.set(request.id, { request, task }); return task
  }
  private async write(request: PostRemovalTarget, signal: AbortSignal): Promise<PostRemovalResult> {
    let reader: FirestoreReader | null = null
    try {
      reader = new FirestoreReader(this.auth)
      await reader.removeChannelPost(this.uid, request, signal, () => this.source(request, true))
      return { outcome: 'saved', message: tr('게시물 문서 삭제와 채널 고정 참조 처리 응답을 확인했습니다. 기기 초안은 유지됩니다. 서버의 미러·첨부 후속 정리 완료까지 확인한 것은 아닙니다.') }
    } catch (error) {
      return { outcome: error instanceof ChannelPostRemovalFailure && error.uncertain ? 'uncertain' : 'rejected',
        message: error instanceof ChannelPostRemovalFailure ? error.message : tr('게시물 삭제를 시작하지 못했습니다. 현재 게시물과 접근 권한을 확인해 주세요.') }
    } finally { reader?.close() }
  }
  async close(): Promise<void> { this.closed = true; this.pause(); await this.active?.task; this.attempts.clear(); this.selection = null }
}
