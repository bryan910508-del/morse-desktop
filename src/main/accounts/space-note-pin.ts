import type { NotePinRequest, NotePinResult } from '../../shared/space-note-pin'
import { FirestoreReader, type ReadCredentials } from '../network/firestore-rpc'
import { NotePinFailure } from '../network/space-note-pin-write'
import type { FirestoreDocument } from '../network/firestore-values'
import { tr } from '../../shared/i18n'

export class NotePinEditor {
  private closed = false
  private selection: string | null = null
  private active: { request: NotePinRequest; abort: AbortController; task: Promise<NotePinResult> } | null = null
  private attempts = new Map<string, { request: NotePinRequest; task: Promise<NotePinResult> }>()
  constructor(private readonly uid: string, private readonly auth: ReadCredentials, private readonly source: (request: NotePinRequest, exact: boolean) => FirestoreDocument) {}
  open(requestId: string): void { if (this.selection !== requestId) { this.pause(); this.selection = requestId; this.attempts.clear() } }
  dismiss(requestId: string): void { if (this.selection === requestId) { this.pause(); this.selection = null; this.attempts.clear() } }
  pause(): void { this.active?.abort.abort() }
  prune(): void { if (this.active) { try { this.source(this.active.request, false) } catch { this.pause() } } }
  save(request: NotePinRequest): Promise<NotePinResult> {
    if (this.closed || this.selection !== request.requestId) throw new Error(tr('현재 노트 목록을 다시 열어 주세요.'))
    const previous = this.attempts.get(request.id)
    if (previous) {
      if (JSON.stringify(previous.request) !== JSON.stringify(request)) throw new Error(tr('같은 저장 요청의 내용을 바꿀 수 없습니다.'))
      return previous.task
    }
    if (this.active || this.attempts.size >= 100) throw new Error(tr('진행 중인 저장을 마치고 노트 목록을 다시 열어 주세요.'))
    this.source(request, true)
    const abort = new AbortController()
    const task = this.write(request, abort.signal).finally(() => { if (this.active?.abort === abort) this.active = null })
    this.active = { request, abort, task }; this.attempts.set(request.id, { request, task }); return task
  }
  private async write(request: NotePinRequest, signal: AbortSignal): Promise<NotePinResult> {
    let reader: FirestoreReader | null = null
    try {
      reader = new FirestoreReader(this.auth)
      await reader.setSpaceNotePin(this.uid, request, signal, () => this.source(request, true))
      return { outcome: 'saved', message: tr('노트 고정 변경 응답을 확인했습니다. 현재 목록은 이후 다른 변경을 포함할 수 있습니다.') }
    } catch (error) {
      return { outcome: error instanceof NotePinFailure && error.uncertain ? 'uncertain' : 'rejected',
        message: error instanceof NotePinFailure ? error.message : tr('노트 고정 변경을 시작하지 못했습니다. 현재 노트와 접근 권한을 확인해 주세요.') }
    } finally { reader?.close() }
  }
  async close(): Promise<void> { this.closed = true; this.pause(); await this.active?.task; this.attempts.clear(); this.selection = null }
}
