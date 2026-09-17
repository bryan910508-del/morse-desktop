import type { ChannelPostExtraPinRequest, ChannelPostExtraPinResult } from '../../shared/channel-post-extra-pin'
import { FirestoreReader, type ReadCredentials } from '../network/firestore-rpc'
import { ChannelPostExtraPinFailure } from '../network/channel-post-extra-pin-write'
import type { ExtraPinWriteSource } from '../network/channel-post-extra-pin-write'
import { tr } from '../../shared/i18n'

export class ChannelPostExtraPinEditor {
  private closed = false
  private selection: string | null = null
  private active: { request: ChannelPostExtraPinRequest; abort: AbortController; task: Promise<ChannelPostExtraPinResult> } | null = null
  private attempts = new Map<string, { request: ChannelPostExtraPinRequest; task: Promise<ChannelPostExtraPinResult> }>()
  constructor(private readonly uid: string, private readonly auth: ReadCredentials, private readonly source: (request: ChannelPostExtraPinRequest, exact: boolean) => ExtraPinWriteSource) {}
  open(requestId: string): void { if (this.selection !== requestId) { this.pause(); this.selection = requestId; this.attempts.clear() } }
  dismiss(requestId: string): void { if (this.selection === requestId) { this.pause(); this.selection = null; this.attempts.clear() } }
  pause(): void { this.active?.abort.abort() }
  prune(): void { if (this.active) { try { this.source(this.active.request, false) } catch { this.pause() } } }
  save(request: ChannelPostExtraPinRequest): Promise<ChannelPostExtraPinResult> {
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
  private async write(request: ChannelPostExtraPinRequest, signal: AbortSignal): Promise<ChannelPostExtraPinResult> {
    let reader: FirestoreReader | null = null
    try {
      reader = new FirestoreReader(this.auth)
      await reader.clearChannelPostExtraPin(this.uid, request, signal, () => this.source(request, true))
      return { outcome: 'saved', message: tr('현재 채널의 고정 대상을 유지하고 이 게시물의 별도 고정 표시를 해제한 응답을 확인했습니다. 다른 표시까지 보정하지 않습니다.') }
    } catch (error) {
      return { outcome: error instanceof ChannelPostExtraPinFailure && error.uncertain ? 'uncertain' : 'rejected',
        message: error instanceof ChannelPostExtraPinFailure ? error.message : tr('별도 고정 표시 해제를 시작하지 못했습니다. 현재 게시물과 접근 권한을 확인해 주세요.') }
    } finally { reader?.close() }
  }
  async close(): Promise<void> { this.closed = true; this.pause(); await this.active?.task; this.attempts.clear(); this.selection = null }
}
