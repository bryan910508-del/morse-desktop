import type { DialogPinRequest, DialogPinSnapshot } from '../../shared/dialog-pins'
import { FirestoreReader, type ReadCredentials } from '../network/firestore-rpc'
import { DialogPinWriteFailure } from '../network/dialog-pin-write'
import { boolField, documentVersion, documents, numberField, stringField, type FirestoreDocument } from '../network/firestore-values'
import { tr } from '../../shared/i18n'

interface Attempt { request: DialogPinRequest; rank: number; value: DialogPinSnapshot; task: Promise<void> }
function pin(doc: FirestoreDocument) {
  const version = documentVersion(doc), rank = numberField(doc.fields, 'rank'), operation = stringField(doc.fields, 'operationId', 300)
  if (!version || typeof doc.fields.isPinned?.booleanValue !== 'boolean' || !operation || !Number.isFinite(rank) || rank < 0 || rank > 1e12) throw new Error('Invalid pin state')
  return { version, rank, operation, pinned: boolField(doc.fields, 'isPinned') }
}
export class DialogPins {
  private readonly attempts = new Map<string, Attempt>()
  private latest: Attempt | null = null
  private active: { attempt: Attempt; abort: AbortController; task: Promise<void> } | null = null
  private closed = false
  constructor(private readonly uid: string, private readonly auth: ReadCredentials,
    private readonly source: (request: DialogPinRequest, exact: boolean) => FirestoreDocument | undefined,
    private readonly changed: () => void) {}
  get snapshot(): DialogPinSnapshot | null { return this.latest ? { ...this.latest.value } : null }
  canChange(chatId: string): boolean { return !this.closed && !this.active && this.attempts.get(chatId)?.value.state !== 'uncertain' }
  needsCheck(chatId: string): boolean { return !this.closed && !this.active && this.attempts.get(chatId)?.value.state === 'uncertain' }
  private publish(): void { if (!this.closed) this.changed() }
  pause(): void { this.active?.abort.abort() }
  prune(): void {
    if (!this.active) return
    try { this.source(this.active.attempt.request, false) } catch { this.pause() }
  }
  private confirmed(attempt: Attempt, doc?: FirestoreDocument): boolean {
    if (!doc) return false
    const current = pin(doc)
    return current.operation === attempt.request.id && current.pinned === attempt.request.pinned && current.rank === attempt.rank
  }
  observe(rows: Map<string, FirestoreDocument>): void {
    for (const attempt of this.attempts.values()) {
      if (attempt.value.state !== 'uncertain') continue
      try {
        if (this.confirmed(attempt, rows.get(`${documents}/users/${this.uid}/dialogStates/${attempt.request.chatId}`))) {
          attempt.value.state = 'saved'; attempt.value.message = tr('서버 목록에서 이 고정 요청의 저장을 확인했습니다.')
        }
      } catch { /* Invalid remote state never confirms an operation. */ }
    }
  }
  set(request: DialogPinRequest): Promise<void> {
    if (this.closed) throw new Error(tr('계정을 다시 연결해 주세요.'))
    const previous = this.attempts.get(request.chatId)
    if (previous?.request.id === request.id) {
      if (JSON.stringify(previous.request) !== JSON.stringify(request)) throw new Error(tr('같은 요청의 내용을 변경할 수 없습니다.'))
      return previous.task
    }
    if (!this.canChange(request.chatId) || [...this.attempts.values()].some(item => item.request.id === request.id)) throw new Error(tr('진행 중인 저장과 이전 고정 결과를 먼저 확인해 주세요.'))
    this.source(request, true)
    const rank = Date.now() / 1000, abort = new AbortController()
    const attempt: Attempt = { request, rank, task: Promise.resolve(), value: { id: request.id, chatId: request.chatId,
      pinned: request.pinned, state: 'saving', checking: false, message: request.pinned ? tr('대화를 고정하고 있습니다…') : tr('대화 고정을 해제하고 있습니다…') } }
    this.attempts.set(request.chatId, attempt); this.latest = attempt
    const task = this.write(attempt, abort.signal).finally(() => { if (this.active?.abort === abort) this.active = null; this.publish() })
    attempt.task = task; this.active = { attempt, abort, task }; this.publish()
    return task
  }
  private async write(attempt: Attempt, signal: AbortSignal): Promise<void> {
    let reader: FirestoreReader | null = null
    try {
      reader = new FirestoreReader(this.auth)
      await reader.setDialogPin(this.uid, attempt.request, attempt.rank, signal, () => this.source(attempt.request, true))
      attempt.value.state = 'saved'; attempt.value.message = attempt.request.pinned ? tr('고정을 저장했습니다. 서버 목록에 반영됩니다.') : tr('고정 해제를 저장했습니다. 서버 목록에 반영됩니다.')
    } catch (error) {
      attempt.value.state = error instanceof DialogPinWriteFailure && error.uncertain ? 'uncertain' : 'rejected'
      attempt.value.message = error instanceof DialogPinWriteFailure ? error.message : tr('고정 저장을 시작하지 못했습니다. 연결과 최신 목록을 확인해 주세요.')
      try {
        if (attempt.value.state === 'uncertain' && this.confirmed(attempt, this.source(attempt.request, false))) {
          attempt.value.state = 'saved'; attempt.value.message = tr('서버 목록에서 이 고정 요청의 저장을 확인했습니다.')
        }
      } catch { /* The saved record may be unavailable while locking or closing. */ }
    } finally { reader?.close() }
  }
  check(chatId: string): Promise<void> {
    const attempt = this.attempts.get(chatId)
    if (this.closed || this.active || !attempt) throw new Error(tr('고정 요청과 연결 상태를 확인해 주세요.'))
    this.source(attempt.request, false)
    const abort = new AbortController()
    this.latest = attempt; attempt.value.checking = true
    const task = this.read(attempt, abort.signal).finally(() => { attempt.value.checking = false; if (this.active?.abort === abort) this.active = null; this.publish() })
    this.active = { attempt, abort, task }; this.publish()
    return task
  }
  private async read(attempt: Attempt, signal: AbortSignal): Promise<void> {
    let reader: FirestoreReader | null = null
    try {
      reader = new FirestoreReader(this.auth)
      const parent = `${documents}/users/${this.uid}`, path = `${parent}/dialogStates/${attempt.request.chatId}`
      const rows = await reader.query(parent, { from: [{ collectionId: 'dialogStates' }],
        where: { fieldFilter: { field: { fieldPath: '__name__' }, op: 'EQUAL', value: { referenceValue: path } } }, limit: 2 }, signal)
      signal.throwIfAborted(); this.source(attempt.request, false)
      if (rows.length > 1 || (rows[0] && rows[0].name !== path)) throw new Error('Pin lookup scope mismatch')
      const current = rows[0] ? pin(rows[0]) : null
      if (this.confirmed(attempt, rows[0])) {
        attempt.value.state = 'saved'; attempt.value.message = tr('서버에서 이 고정 요청의 저장을 확인했습니다.')
      } else {
        attempt.value.state = 'observed'; attempt.value.message = tr('조회한 현재 상태는 {0}입니다. 이전 요청의 결과와는 구분되며, 최신 목록에서 다시 선택할 수 있습니다.', [current?.pinned ? tr('고정', [], 'state') : tr('고정 해제', [], 'state')])
      }
    } catch { attempt.value.message = tr('고정 상태를 조회하지 못했습니다. 자동으로 다시 저장하지 않습니다. 연결 후 다시 확인해 주세요.') }
    finally { reader?.close() }
  }
  async close(): Promise<void> { this.closed = true; this.pause(); await this.active?.task; this.attempts.clear(); this.latest = null }
}
