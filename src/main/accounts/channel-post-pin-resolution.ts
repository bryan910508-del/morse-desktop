import type { ChannelPostPinResolution, ChannelPostPinResolutionResult } from '../../shared/channel-post-pin-resolution'
import { FirestoreReader, type ReadCredentials } from '../network/firestore-rpc'
import { ChannelPostPinResolutionFailure } from '../network/channel-post-pin-resolution-write'
import type { PinResolutionWriteSource } from '../network/channel-post-pin-resolution-write'
import { tr } from '../../shared/i18n'

export class ChannelPostPinResolutionEditor {
  private closed = false
  private selection: string | null = null
  private active: { request: ChannelPostPinResolution; abort: AbortController; task: Promise<ChannelPostPinResolutionResult> } | null = null
  private attempts = new Map<string, { request: ChannelPostPinResolution; task: Promise<ChannelPostPinResolutionResult> }>()
  constructor(private readonly uid: string, private readonly auth: ReadCredentials, private readonly source: (request: ChannelPostPinResolution, exact: boolean) => PinResolutionWriteSource) {}
  open(requestId: string): void { if (this.selection !== requestId) { this.pause(); this.selection = requestId; this.attempts.clear() } }
  dismiss(requestId: string): void { if (this.selection === requestId) { this.pause(); this.selection = null; this.attempts.clear() } }
  pause(): void { this.active?.abort.abort() }
  prune(): void { if (this.active) { try { this.source(this.active.request, false) } catch { this.pause() } } }
  save(request: ChannelPostPinResolution): Promise<ChannelPostPinResolutionResult> {
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
  private async write(request: ChannelPostPinResolution, signal: AbortSignal): Promise<ChannelPostPinResolutionResult> {
    let reader: FirestoreReader | null = null
    try {
      reader = new FirestoreReader(this.auth)
      await reader.resolveChannelPostPin(this.uid, request, signal, () => this.source(request, true))
      return { outcome: 'saved', message: tr('선택한 채널 대상과 게시물 표시 변경의 응답을 확인했습니다. 다른 게시물의 표시까지 보정하지 않습니다.') }
    } catch (error) {
      return { outcome: error instanceof ChannelPostPinResolutionFailure && error.uncertain ? 'uncertain' : 'rejected',
        message: error instanceof ChannelPostPinResolutionFailure ? error.message : tr('지정 게시물 고정 변경을 시작하지 못했습니다. 현재 게시물과 접근 권한을 확인해 주세요.') }
    } finally { reader?.close() }
  }
  async close(): Promise<void> { this.closed = true; this.pause(); await this.active?.task; this.attempts.clear(); this.selection = null }
}
