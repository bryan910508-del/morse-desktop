import { Worker } from 'node:worker_threads'
import { join } from 'node:path'
import type { DeliveryCommand } from './delivery-protocol'
import { recordDeliveryStep } from '../platform/delivery-diagnostics'
import { tr } from '../../shared/i18n'
let localDataKey: (() => string) | null = null
// Set once at start by the main process; an account starts only after the key can be read.
export function setLocalDataKey(value: () => string): void { localDataKey = value }
// The local key is kept in the system keychain (safeStorage), so it is missing exactly when macOS
// refuses the app that asks for it — a case worth telling apart from a storage that is simply broken.
export class LocalDataKeyUnavailable extends Error { constructor() { super(tr('로컬 데이터 키를 준비하지 못했습니다.')) } }
function currentLocalDataKey(): string {
  if (!localDataKey) throw new LocalDataKeyUnavailable()
  const key = localDataKey()
  if (!/^[0-9a-f]{64}$/.test(key)) throw new LocalDataKeyUnavailable()
  return key
}
export class DeliveryCommandFailure extends Error {
  constructor(readonly code: 'capacity' | 'conflict' | 'storage' | 'timeout' | 'restarted') {
    super(code === 'timeout' ? tr('전송 저장소가 이 작업을 끝내지 못했습니다. 잠시 후 다시 시도해 주세요.')
      : code === 'restarted' ? tr('전송 저장소를 다시 열었습니다. 이 작업을 다시 시도해 주세요.')
      : tr('전송 기록을 저장하거나 읽지 못했습니다.'))
  }
}
// The codes that leave the outcome unknown: the command may still have been written.
export const uncertainDeliveryCodes: ReadonlySet<string> = new Set(['storage', 'timeout', 'restarted'])
// A worker that dies takes its commands with it; Telegram answers a cache it cannot open by clearing
// and opening it again (Settings::clearOnWrongKey), so a death is met with a new worker rather than
// with an account that cannot send until the app is restarted. A crash loop is not: after this many
// tries the storage says so once and stops.
const reopenLimit = 3

export class DeliveryRepository {
  private worker: Worker
  private sequence = 0
  private closing = false
  private fatal = false
  private reopens = 0
  private pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()
  constructor(private readonly directory: string, private readonly uid: string, private readonly scope: string,
    // The worker this repository runs its commands in. Only a test gives another one.
    private readonly spawn: (workerData: { directory: string; uid: string; scope: string; key: string }) => Worker =
      workerData => new Worker(join(__dirname, 'delivery-worker.cjs'), { workerData })) {
    this.worker = this.startWorker()
  }
  // Storage::Domain local key: the worker opens (and, once, encrypts) the account's database with it.
  private startWorker(): Worker {
    const worker = this.spawn({ directory: this.directory, uid: this.uid, scope: this.scope, key: currentLocalDataKey() })
    worker.on('message', (message: { id: number; ok: boolean; value?: unknown; code?: 'capacity' | 'conflict' | 'storage' }) => {
      const pending = this.pending.get(message.id)
      if (!pending) return
      clearTimeout(pending.timer); this.pending.delete(message.id)
      if (message.ok) pending.resolve(message.value)
      else { recordDeliveryStep('command-failed', message.code ?? 'storage'); pending.reject(new DeliveryCommandFailure(message.code ?? 'storage')) }
    })
    worker.on('error', error => this.lost('worker-error', error instanceof Error ? error.name : 'unknown'))
    worker.on('exit', code => { if (!this.closing) this.lost('worker-exit', `code-${code}`) })
    return worker
  }
  // The worker is gone. Its commands went with it and cannot be answered, so they are refused as
  // uncertain — a write may have landed — and a new worker takes over, the way Telegram opens its
  // cache again rather than giving up on it.
  private lost(step: string, detail: string): void {
    if (this.closing || this.fatal) return
    recordDeliveryStep(step, detail)
    const waiting = [...this.pending.values()]
    this.pending.clear()
    const give = (error: Error): void => { for (const pending of waiting) { clearTimeout(pending.timer); pending.reject(error) } }
    if (this.reopens >= reopenLimit) {
      this.fatal = true
      recordDeliveryStep('gave-up', `reopens-${this.reopens}`)
      give(new Error(tr('전송 저장소가 중단되었습니다. 앱을 다시 열어 주세요.')))
      return
    }
    this.reopens++
    give(new DeliveryCommandFailure('restarted'))
    try { this.worker = this.startWorker(); recordDeliveryStep('reopened', `try-${this.reopens}`) }
    catch (error) {
      this.fatal = true
      recordDeliveryStep('reopen-failed', error instanceof LocalDataKeyUnavailable ? 'key' : error instanceof Error ? error.name : 'unknown')
    }
  }
  // False once the storage has given up; the caller tells a failed command apart from a store that
  // will not answer again.
  get usable(): boolean { return !this.fatal && !this.closing }
  call<T = void>(command: DeliveryCommand): Promise<T> {
    if (this.fatal || (this.closing && command.kind !== 'close')) return Promise.reject(new Error(tr('전송 저장소를 사용할 수 없습니다.')))
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      const carriesSource = ['voice-draft-storage-match','voice-draft-storage-list','voice-draft-storage-remove','voice-draft-read','voice-draft-known','voice-draft-write','voice-draft-source','voice-queue-source','story-publication-audio-source','story-video-publication-audio-source', 'story-publication-submit','story-publication-outcome', 'story-publication-prepare', 'story-composer-audio-source', 'story-composer-audio-read','story-composer-audio-write', 'story-video-publication-submit', 'story-video-publication-outcome', 'story-video-publication-upload-begin', 'story-video-publication-upload-source', 'story-video-publication-upload-session', 'story-video-publication-upload-ack', 'story-video-publication-upload-block', 'story-video-publication-read', 'story-video-publication-prepare', 'story-video-publication-dismiss', 'story-composer-video-source', 'story-composer-video-read', 'story-composer-video-write', 'discussion-join-read', 'discussion-join-prepare', 'discussion-join-state', 'discussion-leave-dismiss-record', 'channel-join-decision-read', 'channel-join-decision-prepare', 'channel-join-decision-state', 'channel-access-read', 'channel-access-prepare', 'channel-access-state', 'channel-photo-upload-read', 'channel-photo-upload-create', 'channel-photo-upload-state', 'channel-photo-upload-discard', 'group-photo-upload-read', 'group-photo-upload-create', 'group-photo-upload-state', 'group-photo-upload-discard', 'group-leave-read', 'group-leave-prepare', 'group-leave-state', 'group-removal-read', 'group-removal-prepare', 'group-removal-state', 'group-members-read', 'group-members-prepare', 'group-members-state', 'group-create-read', 'group-create-prepare', 'group-create-state', 'background-storage-list', 'background-storage-remove', 'contact-photo-remove', 'contact-photo-list', 'contact-photo-source', 'contact-photo-save', 'profile-upload-finalize', 'profile-history-restore', 'profile-history-forget', 'profile-upload-read', 'profile-upload-create', 'profile-upload-state', 'ready', 'enqueue-attachment', 'enqueue-forward-media', 'upload-source', 'upload-complete', 'upload-ready', 'finish', 'prune', 'close'].includes(command.kind)
      // One command that does not come back fails on its own. Terminating the worker instead ended
      // every other command for the rest of the session, which is what a person met as «전송 저장소를
      // 사용할 수 없습니다»; Telegram's cache fails the one operation and keeps its database. A late
      // answer to this command is ignored, since its id is no longer waiting.
      const timer = setTimeout(() => {
        if (!this.pending.delete(id)) return
        recordDeliveryStep('command-timeout', command.kind)
        reject(new DeliveryCommandFailure('timeout'))
      }, carriesSource ? 60000 : 15000)
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer })
      try { this.worker.postMessage({ id, command }) }
      catch (error) {
        clearTimeout(timer); this.pending.delete(id)
        recordDeliveryStep('post-failed', command.kind)
        reject(new DeliveryCommandFailure('restarted'))
        this.lost('worker-error', error instanceof Error ? error.name : 'unknown')
      }
    })
  }
  async close(purge: boolean): Promise<void> {
    if (this.closing) return
    this.closing = true
    try { await this.call({ kind: 'close', purge }) }
    finally { await this.worker.terminate() }
  }
}
