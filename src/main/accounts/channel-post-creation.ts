import { createHash, randomUUID } from 'node:crypto'
import { observePostCreation } from './channel-post-observation'
import { callMorseFunction } from '../network/morse-callable'
import { uploadChannelPostPhoto } from '../network/channel-post-photo-upload-api'
import { documents, type FirestoreDocument } from '../network/firestore-values'
import type { PostCreationObservation } from '../../shared/channel-post-creation'
import { postCreationRequest, type PostCreationPrepare, type PostCreationRequest, type PostCreationSnapshot, type PendingPostCreation, type PostCreationAction } from '../../shared/channel-post-creation'
import type { PostCreationCommand, PostPhotoRecord } from '../storage/channel-post-creation-table'
import { FirestoreReader, type ReadCredentials } from '../network/firestore-rpc'
import { ChannelPostCreationFailure, postCreationContext, validatePostCreationSource, type PostCreationSource } from '../network/channel-post-creation-write'
import { tr } from '../../shared/i18n'
export class ChannelPostCreation {
  private closed = false
  private job: Promise<void> | null = null
  private abort: AbortController | null = null
  private observation: { scope: string; value: PostCreationObservation } | null = null
  private observationTimer: ReturnType<typeof setTimeout> | null = null
  private value: PostCreationSnapshot = { observation: null, canCheck: false, status: 'loading', busy: false, canSend: false, pending: null, message: '' }
  constructor(private readonly uid: string, private readonly auth: ReadCredentials, private readonly allowed: (network: boolean) => void,
    private readonly channel: (channelId: string) => PostCreationSource,
    private readonly readScope: (channelId: string, doc?: FirestoreDocument | null) => string,
    private readonly store: <T>(command: PostCreationCommand, validate: () => void) => Promise<T>, private readonly changed: () => void) {}
  private validate(network = false): void { if (this.closed) throw new Error(tr('계정이 변경되었습니다.')); this.auth.signal.throwIfAborted(); this.allowed(network) }
  private source(request: PostCreationRequest): PostCreationSource {
    this.validate(true)
    const source = this.channel(request.channelId); validatePostCreationSource(this.uid, request, source); return source
  }
  get snapshot(): PostCreationSnapshot {
    let canSend = false
    if (this.value.status === 'ready' && !this.value.busy && this.value.pending?.state === 'prepared') { try { this.source(this.value.pending); canSend = true } catch { /* Draft recovery does not require current remote access. */ } }
    let scope: string | null = null
    if (this.value.status === 'ready' && this.value.pending && ['submitted', 'confirmed'].includes(this.value.pending.state)) {
      try { this.validate(true); scope = this.readScope(this.value.pending.channelId) } catch { /* Current read authority is independent of old posting authority. */ }
    }
    const observation = scope && this.observation?.scope === scope && Date.now() - this.observation.value.observedAt < 30000 ? { ...this.observation.value } : null
    return { ...this.value, observation, canCheck: Boolean(scope) && !this.value.busy, canSend, pending: this.value.pending ? { ...this.value.pending } : null }
  }
  private clearObservation(): void { this.observation = null; if (this.observationTimer) clearTimeout(this.observationTimer); this.observationTimer = null }
  pause(): void { this.abort?.abort(); this.clearObservation() }
  private publish(): void { if (!this.closed) this.changed() }
  private run(operation: (signal: AbortSignal) => Promise<void>): Promise<void> {
    this.validate()
    if (this.job) throw new Error(tr('진행 중인 글 게시 기록을 확인해 주세요.'))
    this.clearObservation()
    const abort = new AbortController(); this.abort = abort; this.value.busy = true; this.value.message = ''
    const task = Promise.resolve().then(() => operation(abort.signal)).catch(error => {
      this.value.status = 'error'; this.value.message = tr('글 게시 기록을 다시 읽어 주세요. 저장 응답이 불확실한 동안 새 게시를 준비하지 않습니다.'); throw error
    }).finally(() => { if (this.job === task) this.job = null; if (this.abort === abort) this.abort = null; this.value.busy = false; this.publish() })
    this.job = task; this.publish(); return task
  }
  refresh(): Promise<void> {
    return this.run(async signal => {
      const validate = (): void => { signal.throwIfAborted(); this.validate() }
      const pending = await this.store<PendingPostCreation | null>({ kind: 'post-creation-read' }, validate)
      validate(); this.value.pending = pending; this.value.status = 'ready'
    })
  }
  prepare(input: PostCreationPrepare, photos: Uint8Array[] = []): Promise<void> {
    if (this.value.status !== 'ready' || this.value.pending) throw new Error(tr('이전 글 게시 기록을 먼저 확인해 주세요.'))
    this.validate(true)
    const photoInfo = photos.map(bytes => ({ id: randomUUID(), sha256: createHash('sha256').update(bytes).digest('hex'), md5: createHash('md5').update(bytes).digest('base64'), size: bytes.byteLength }))
    const request = postCreationRequest({ ...input, photos: photoInfo, ...postCreationContext(this.uid, input.channelId, this.channel(input.channelId)) })
    return this.run(async signal => {
      const validate = (): void => { signal.throwIfAborted(); this.source(request) }
      this.value.pending = await this.store<PendingPostCreation>({ kind: 'post-creation-prepare', request, photos }, validate)
      this.value.status = 'ready'; this.value.message = tr('저장한 초안과 현재 채널 조건을 고정했습니다. 내용과 공개 범위를 확인한 뒤 게시해 주세요.')
    })
  }
  action(action: PostCreationAction): Promise<void> {
    const pending = this.value.pending
    if (this.value.status !== 'ready' || !pending || pending.id !== action.id || pending.state !== action.state || (action.action === 'send' && pending.state !== 'prepared') || (action.action === 'check' && !['submitted', 'confirmed'].includes(pending.state))) throw new Error(tr('최신 글 게시 기록을 확인해 주세요.'))
    return this.run(async signal => {
      const validate = (): void => { signal.throwIfAborted(); this.validate() }
      if (action.action === 'check') {
        this.validate(true)
        const scope = this.readScope(pending.channelId), reader = new FirestoreReader(this.auth)
        const access = (doc?: FirestoreDocument | null): void => { validate(); this.validate(true); if (this.readScope(pending.channelId, doc) !== scope) throw new Error(tr('게시물 조회 범위가 변경되었습니다.')) }
        try {
          const doc = await reader.getDocument(`${documents}/channels/${pending.channelId}/posts/${pending.id}`, signal, access)
          access(doc); this.observation = { scope, value: observePostCreation(pending, doc) }
        } catch {
          try { access(); this.observation = { scope, value: { outcome: 'unavailable', observedAt: Date.now(), message: tr('현재 게시물 문서를 확인하지 못했습니다. 부재·삭제·거절로 판단하지 않습니다. 제출 기록과 초안을 유지합니다.') } } } catch { this.value.message = tr('현재 채널 접근 범위가 변경되어 조회 결과를 표시하지 않습니다. 제출 기록은 유지합니다.') }
        } finally { reader.close() }
        if (this.observation) this.observationTimer = setTimeout(() => { this.clearObservation(); this.publish() }, 30000)
        return
      }
      if (action.action === 'dismiss') {
        this.value.pending = await this.store<null>({ kind: 'post-creation-state', id: pending.id, expected: pending.state, state: 'dismissed' }, validate)
        this.value.message = tr('이 기기의 게시 기록을 닫았습니다. 서버 게시물이나 미러를 삭제하거나 이미 시작된 작업을 취소하지 않습니다.'); return
      }
      this.source(pending)
      if (pending.photos.length) await this.uploadPhotos(pending, signal, validate)
      this.value.pending = await this.store<PendingPostCreation>({ kind: 'post-creation-state', id: pending.id, expected: 'prepared', state: 'submitted' }, validate)
      let outcome: 'confirmed' | 'rejected' | null = null, reader: FirestoreReader | null = null
      try {
        reader = new FirestoreReader(this.auth)
        // The strict network request excludes the local journal state.
        const { state: _state, ...request } = pending
        await reader.createChannelPost(this.uid, request, signal, () => { validate(); return this.source(request) })
        outcome = 'confirmed'
      } catch (error) {
        if (error instanceof ChannelPostCreationFailure && !error.uncertain) outcome = 'rejected'
        else this.value.message = tr('게시 결과 미확인 상태입니다. 초안과 요청 ID를 보존하며 자동 재전송하지 않습니다. 현재 목록만으로 이전 요청의 성공을 판정하지 않습니다.')
      } finally { reader?.close() }
      if (outcome) {
        this.value.pending = await this.store<PendingPostCreation>({ kind: 'post-creation-state', id: pending.id, expected: 'submitted', state: outcome }, validate)
        this.value.message = outcome === 'confirmed' ? tr('게시물 생성 응답을 확인하고 해당 기기 초안을 비웠습니다. 서버 집계·미러·알림의 완료를 확인한 것은 아닙니다.') : tr('게시를 시작하지 못했거나 서버가 거절했습니다. 초안은 유지됩니다. 최신 채널에서 다시 준비해 주세요.')
      }
    })
  }
  // ChannelService.createPost: the upload grant, then every photo. The post is written only after all are stored.
  private async uploadPhotos(pending: PendingPostCreation, signal: AbortSignal, validate: () => void): Promise<void> {
    this.validate(true)
    try { await callMorseFunction(this.auth, 'prepareMorseChannelMediaUpload', { channelId: pending.channelId, postId: pending.id }, signal) }
    catch { throw new Error(tr('사진을 올릴 권한을 받지 못했습니다. 채널 권한과 연결을 확인해 주세요.')) }
    const photos = await this.store<PostPhotoRecord[]>({ kind: 'post-photo-read', id: pending.id }, validate)
    for (const [index, photo] of photos.entries()) {
      const info = pending.photos[index]
      if (!info || info.id !== photo.id) throw new Error(tr('게시할 사진 기록을 확인하지 못했습니다.'))
      if (photo.uploaded) continue
      this.value.message = tr('사진 올리는 중 ({0}/{1})', [index + 1, photos.length]); this.publish()
      await uploadChannelPostPhoto(this.auth, this.uid, { channelId: pending.channelId, postId: pending.id, sha256: info.sha256, md5: info.md5 }, photo, signal,
        async session => { await this.store({ kind: 'post-photo-state', id: pending.id, photoId: photo.id, session }, validate) }, () => { validate(); this.validate(true) })
      await this.store({ kind: 'post-photo-state', id: pending.id, photoId: photo.id, uploaded: true }, validate)
    }
  }
  async close(): Promise<void> { this.closed = true; this.pause(); await this.job?.catch(() => {}); this.value.pending = null }
}
