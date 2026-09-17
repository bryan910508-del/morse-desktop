import type { PostVisibilityRequest, PostVisibilityResult } from '../../shared/channel-post-visibility'
import { FirestoreReader, type ReadCredentials } from '../network/firestore-rpc'
import { ChannelPostVisibilityFailure } from '../network/channel-post-visibility-write'
import type { PostVisibilitySource } from '../network/channel-post-visibility-write'
import { tr } from '../../shared/i18n'

export class ChannelPostVisibilityEditor {
  private closed = false
  private selection: string | null = null
  private active: { request: PostVisibilityRequest; abort: AbortController; task: Promise<PostVisibilityResult> } | null = null
  private attempts = new Map<string, { request: PostVisibilityRequest; task: Promise<PostVisibilityResult> }>()
  constructor(private readonly uid: string, private readonly auth: ReadCredentials, private readonly source: (request: PostVisibilityRequest, exact: boolean) => PostVisibilitySource) {}
  open(requestId: string): void { if (this.selection !== requestId) { this.pause(); this.selection = requestId; this.attempts.clear() } }
  dismiss(requestId: string): void { if (this.selection === requestId) { this.pause(); this.selection = null; this.attempts.clear() } }
  pause(): void { this.active?.abort.abort() }
  prune(): void { if (this.active) { try { this.source(this.active.request, false) } catch { this.pause() } } }
  save(request: PostVisibilityRequest): Promise<PostVisibilityResult> {
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
  private async write(request: PostVisibilityRequest, signal: AbortSignal): Promise<PostVisibilityResult> {
    let reader: FirestoreReader | null = null
    try {
      reader = new FirestoreReader(this.auth)
      await reader.setChannelPostVisibility(this.uid, request, signal, () => this.source(request, true))
      return { outcome: 'saved', message: tr('게시물 공개 범위 저장 응답을 확인했습니다. 본문과 첨부는 유지하며 서버의 미러 후속 갱신 완료까지 확인한 것은 아닙니다.') }
    } catch (error) {
      return { outcome: error instanceof ChannelPostVisibilityFailure && error.uncertain ? 'uncertain' : 'rejected',
        message: error instanceof ChannelPostVisibilityFailure ? error.message : tr('게시물 공개 범위 변경을 시작하지 못했습니다. 현재 게시물과 접근 권한을 확인해 주세요.') }
    } finally { reader?.close() }
  }
  async close(): Promise<void> { this.closed = true; this.pause(); await this.active?.task; this.attempts.clear(); this.selection = null }
}
