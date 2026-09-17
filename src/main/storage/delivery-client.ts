import { Worker } from 'node:worker_threads'
import { join } from 'node:path'
import type { DeliveryCommand } from './delivery-protocol'
import { tr } from '../../shared/i18n'
let localDataKey: (() => string) | null = null
// Set once at start by the main process; an account starts only after the key can be read.
export function setLocalDataKey(value: () => string): void { localDataKey = value }
function currentLocalDataKey(): string {
  if (!localDataKey) throw new Error(tr('로컬 데이터 키를 준비하지 못했습니다.'))
  const key = localDataKey()
  if (!/^[0-9a-f]{64}$/.test(key)) throw new Error(tr('로컬 데이터 키를 준비하지 못했습니다.'))
  return key
}
export class DeliveryCommandFailure extends Error {
  constructor(readonly code: 'capacity' | 'conflict' | 'storage') { super(tr('전송 기록을 저장하거나 읽지 못했습니다.')) }
}

export class DeliveryRepository {
  private readonly worker: Worker
  private sequence = 0
  private closing = false
  private fatal = false
  private pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()
  constructor(directory: string, uid: string, scope: string) {
    // Storage::Domain local key: the worker opens (and, once, encrypts) the account's database with it.
    this.worker = new Worker(join(__dirname, 'delivery-worker.cjs'), { workerData: { directory, uid, scope, key: currentLocalDataKey() } })
    this.worker.on('message', (message: { id: number; ok: boolean; value?: unknown; code?: 'capacity' | 'conflict' | 'storage' }) => {
      const pending = this.pending.get(message.id)
      if (!pending) return
      clearTimeout(pending.timer); this.pending.delete(message.id)
      if (message.ok) pending.resolve(message.value)
      else pending.reject(new DeliveryCommandFailure(message.code ?? 'storage'))
    })
    this.worker.on('error', () => this.fail())
    this.worker.on('exit', () => { if (!this.closing || this.pending.size) this.fail() })
  }
  private fail(): void {
    this.fatal = true
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error(tr('전송 저장소가 중단되었습니다. 앱을 다시 열어 주세요.'))) }
    this.pending.clear()
  }
  call<T = void>(command: DeliveryCommand): Promise<T> {
    if (this.fatal || (this.closing && command.kind !== 'close')) return Promise.reject(new Error(tr('전송 저장소를 사용할 수 없습니다.')))
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      const carriesSource = ['voice-draft-storage-match','voice-draft-storage-list','voice-draft-storage-remove','voice-draft-read','voice-draft-known','voice-draft-write','voice-draft-source','voice-queue-source','story-publication-audio-source','story-video-publication-audio-source', 'story-publication-submit','story-publication-outcome', 'story-publication-prepare', 'story-composer-audio-source', 'story-composer-audio-read','story-composer-audio-write', 'story-video-publication-submit', 'story-video-publication-outcome', 'story-video-publication-upload-begin', 'story-video-publication-upload-source', 'story-video-publication-upload-session', 'story-video-publication-upload-ack', 'story-video-publication-upload-block', 'story-video-publication-read', 'story-video-publication-prepare', 'story-video-publication-dismiss', 'story-composer-video-source', 'story-composer-video-read', 'story-composer-video-write', 'discussion-join-read', 'discussion-join-prepare', 'discussion-join-state', 'discussion-leave-dismiss-record', 'channel-join-decision-read', 'channel-join-decision-prepare', 'channel-join-decision-state', 'channel-access-read', 'channel-access-prepare', 'channel-access-state', 'channel-photo-upload-read', 'channel-photo-upload-create', 'channel-photo-upload-state', 'channel-photo-upload-discard', 'group-photo-upload-read', 'group-photo-upload-create', 'group-photo-upload-state', 'group-photo-upload-discard', 'group-leave-read', 'group-leave-prepare', 'group-leave-state', 'group-removal-read', 'group-removal-prepare', 'group-removal-state', 'group-members-read', 'group-members-prepare', 'group-members-state', 'group-create-read', 'group-create-prepare', 'group-create-state', 'background-storage-list', 'background-storage-remove', 'contact-photo-remove', 'contact-photo-list', 'contact-photo-source', 'contact-photo-save', 'profile-upload-finalize', 'profile-history-restore', 'profile-history-forget', 'profile-upload-read', 'profile-upload-create', 'profile-upload-state', 'ready', 'enqueue-attachment', 'enqueue-forward-media', 'upload-source', 'upload-complete', 'upload-ready', 'finish', 'prune', 'close'].includes(command.kind)
      const timer = setTimeout(() => { this.fail(); void this.worker.terminate() }, carriesSource ? 60000 : 15000)
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer })
      try { this.worker.postMessage({ id, command }) } catch { this.fail() }
    })
  }
  async close(purge: boolean): Promise<void> {
    if (this.closing) return
    this.closing = true
    try { await this.call({ kind: 'close', purge }) }
    finally { await this.worker.terminate() }
  }
}
