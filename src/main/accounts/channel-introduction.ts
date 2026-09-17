import type { ChannelIntroductionEdit, ChannelIntroductionResult } from '../../shared/channel-introduction'
import { FirestoreReader, type ReadCredentials } from '../network/firestore-rpc'
import { ChannelIntroductionWriteFailure } from '../network/channel-introduction-write'
import type { FirestoreDocument } from '../network/firestore-values'
import { tr } from '../../shared/i18n'

export class ChannelIntroductionEditor {
  private closed = false
  private selection: string | null = null
  private active: { request: ChannelIntroductionEdit; abort: AbortController; task: Promise<ChannelIntroductionResult> } | null = null
  private attempts = new Map<string, { request: ChannelIntroductionEdit; task: Promise<ChannelIntroductionResult> }>()
  constructor(private readonly auth: ReadCredentials, private readonly source: (request: ChannelIntroductionEdit, exact: boolean) => FirestoreDocument) {}
  open(requestId: string): void { if (this.selection !== requestId) { this.pause(); this.selection = requestId; this.attempts.clear() } }
  dismiss(requestId: string): void { if (this.selection === requestId) { this.pause(); this.selection = null; this.attempts.clear() } }
  pause(): void { this.active?.abort.abort() }
  prune(): void { if (this.active) { try { this.source(this.active.request, false) } catch { this.pause() } } }
  save(request: ChannelIntroductionEdit): Promise<ChannelIntroductionResult> {
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
  private async write(request: ChannelIntroductionEdit, signal: AbortSignal): Promise<ChannelIntroductionResult> {
    let reader: FirestoreReader | null = null
    try {
      reader = new FirestoreReader(this.auth)
      await reader.setChannelIntroduction(request, signal, () => this.source(request, true))
      return { outcome: 'saved', message: tr('채널 소개 저장 응답을 확인했습니다. 최신 서버 목록에 반영됩니다.') }
    } catch (error) {
      return { outcome: error instanceof ChannelIntroductionWriteFailure && error.uncertain ? 'uncertain' : 'rejected',
        message: error instanceof ChannelIntroductionWriteFailure ? error.message : tr('채널 소개 저장을 시작하지 못했습니다. 연결과 최신 채널 정보를 확인해 주세요.') }
    } finally { reader?.close() }
  }
  async close(): Promise<void> { this.closed = true; this.pause(); await this.active?.task; this.attempts.clear(); this.selection = null }
}
