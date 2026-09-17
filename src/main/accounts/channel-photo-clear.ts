import type { ChannelPhotoClear, ChannelPhotoClearResult } from '../../shared/channel-photo-clear'
import { FirestoreReader, type ReadCredentials } from '../network/firestore-rpc'
import { ChannelMetadataWriteFailure } from '../network/channel-metadata-write'
import type { FirestoreDocument } from '../network/firestore-values'
import { tr } from '../../shared/i18n'

export class ChannelPhotoClearEditor {
  private closed = false
  private selection: string | null = null
  private active: { request: ChannelPhotoClear; abort: AbortController; task: Promise<ChannelPhotoClearResult> } | null = null
  private attempts = new Map<string, { request: ChannelPhotoClear; task: Promise<ChannelPhotoClearResult> }>()
  constructor(private readonly uid: string, private readonly auth: ReadCredentials, private readonly source: (request: ChannelPhotoClear, exact: boolean) => FirestoreDocument) {}
  open(requestId: string): void { if (this.selection !== requestId) { this.pause(); this.selection = requestId; this.attempts.clear() } }
  dismiss(requestId: string): void { if (this.selection === requestId) { this.pause(); this.selection = null; this.attempts.clear() } }
  pause(): void { this.active?.abort.abort() }
  prune(): void { if (this.active) { try { this.source(this.active.request, false) } catch { this.pause() } } }
  save(request: ChannelPhotoClear): Promise<ChannelPhotoClearResult> {
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
  private async write(request: ChannelPhotoClear, signal: AbortSignal): Promise<ChannelPhotoClearResult> {
    let reader: FirestoreReader | null = null
    try {
      reader = new FirestoreReader(this.auth)
      const related = await reader.clearChannelPhoto(this.uid, request, signal, () => this.source(request, true))
      return { outcome: 'saved', message: tr('{0} 해제{1}의 저장 응답을 확인했습니다. 원본 파일은 삭제하지 않습니다.', [request.kind === 'cover' ? tr('커버') : tr('대표 사진'), related ? tr('와 관련 문서 {0}개 갱신', [related]) : '']) }
    } catch (error) {
      return { outcome: error instanceof ChannelMetadataWriteFailure && error.uncertain ? 'uncertain' : 'rejected',
        message: error instanceof ChannelMetadataWriteFailure ? error.message : tr('채널 사진 저장을 시작하지 못했습니다. 연결과 최신 채널 정보를 확인해 주세요.') }
    } finally { reader?.close() }
  }
  async close(): Promise<void> { this.closed = true; this.pause(); await this.active?.task; this.attempts.clear(); this.selection = null }
}
