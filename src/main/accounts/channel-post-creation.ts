import { createHash, randomUUID } from 'node:crypto'
import { observePostCreation } from './channel-post-observation'
import { callMorseFunction, MorseCallableFailure } from '../network/morse-callable'
import { uploadChannelPostPhoto } from '../network/channel-post-photo-upload-api'
import { UploadRefused } from '../network/upload-refused'
import { documents, ReadFailure, stringField, type FirestoreDocument } from '../network/firestore-values'
import type { PostCreationObservation } from '../../shared/channel-post-creation'
import { postCreationRequest, type PostCreationPrepare, type PostCreationRequest, type PostCreationSnapshot, type PendingPostCreation, type PostCreationAction } from '../../shared/channel-post-creation'
import type { PostCreationCommand, PostPhotoRecord } from '../storage/channel-post-creation-table'
import { FirestoreReader, type ReadCredentials } from '../network/firestore-rpc'
import { ChannelPostCreationFailure, postCreationContext, validatePostCreationSource, type PostCreationSource } from '../network/channel-post-creation-write'
import { tr } from '../../shared/i18n'
import { recordConnectionStep, recordRetry } from '../platform/connection-diagnostics'

// What one attempt came to: the post is on the server, it will not be, it goes again after a wait, or it must be
// looked for first because the attempt may have reached the server.
type Attempt = 'confirmed' | 'rejected' | 'retry' | 'check' | 'retired'
// A post on its way goes again by itself, as a message does in Telegram (random_id) and a post does on Android
// (e8b6b3e, F-ST-001): what never left goes when the connection is back, and one whose outcome is unknown is looked
// for on the server and sent again under the same id if it is not there — the write only creates the post while that
// id is free (currentDocument exists:false), so it cannot publish twice. The wait grows to a minute while the
// connection is up (user decision 2026-09-29) and starts again when it comes back.
export function postRetryDelay(attempt: number): number { return Math.min(60000, 1000 * 2 ** Math.max(0, attempt - 1)) }
const request = (pending: PendingPostCreation): PostCreationRequest => { const { state: _state, ...value } = pending; return value }

export class ChannelPostCreation {
  private closed = false
  private job: Promise<void> | null = null
  private abort: AbortController | null = null
  private observation: { scope: string; value: PostCreationObservation } | null = null
  private observationTimer: ReturnType<typeof setTimeout> | null = null
  private attempt = 0
  // The step that failed last and why, for connection-check.log.
  private failed: { stage: string; error: unknown } = { stage: '', error: null }
  private wake: ReturnType<typeof setTimeout> | null = null
  private value: PostCreationSnapshot = { observation: null, canCheck: false, status: 'loading', busy: false, canSend: false, pending: null, message: '' }
  constructor(private readonly uid: string, private readonly auth: ReadCredentials, private readonly allowed: (network: boolean) => void,
    private readonly channel: (channelId: string) => PostCreationSource,
    private readonly readScope: (channelId: string, doc?: FirestoreDocument | null) => string,
    private readonly store: <T>(command: PostCreationCommand, validate: () => void) => Promise<T>, private readonly changed: () => void,
    // The reads and the write, over Firestore; a test gives its own.
    private readonly open: () => Pick<FirestoreReader, 'getDocument' | 'createChannelPost' | 'close'> = () => new FirestoreReader(auth)) {}
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
  private unschedule(): void { if (this.wake) clearTimeout(this.wake); this.wake = null }
  // The connection went: what is in flight stops, and the post waits as it is for resume().
  pause(): void { this.abort?.abort(); this.clearObservation(); this.unschedule() }
  // The connection is back: a post still on its way goes at once.
  resume(): void { this.attempt = 0; this.unschedule(); this.kick() }
  private publish(): void { if (!this.closed) this.changed() }
  private run(operation: (signal: AbortSignal) => Promise<void>): Promise<void> {
    this.validate()
    if (this.job) throw new Error(tr('진행 중인 글 게시 기록을 확인해 주세요.'))
    this.clearObservation(); this.unschedule()
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
    }).then(() => { this.kick() })
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
        recordConnectionStep('post-closed', `from ${pending.state}`)
        this.value.message = tr('이 기기의 게시 기록을 닫았습니다. 서버 게시물이나 미러를 삭제하거나 이미 시작된 작업을 취소하지 않습니다.'); return
      }
      this.attempt = 0
      await this.carry(signal, validate)
    }).then(() => { this.kick() })
  }
  // The post on its way, taken one step further by itself: sent when prepared, looked for when its outcome is unknown.
  private kick(): void {
    const pending = this.value.pending
    if (this.closed || this.job || this.wake || this.value.status !== 'ready' || !pending || !['prepared', 'submitted'].includes(pending.state)) return
    try { this.validate(true) } catch { return } // resume() brings it back with the connection.
    void this.run(async signal => { await this.carry(signal, () => { signal.throwIfAborted(); this.validate() }) }).then(() => { this.kick() }, () => {})
  }
  private later(): void {
    this.attempt += 1
    recordRetry('post', this.failed.stage, this.failed.error, postRetryDelay(this.attempt))
    this.unschedule()
    this.wake = setTimeout(() => { this.wake = null; this.kick() }, postRetryDelay(this.attempt))
  }
  private async carry(signal: AbortSignal, validate: () => void): Promise<void> {
    let pending = this.value.pending
    if (!pending) return
    if (pending.state === 'submitted') {
      const seen = await this.look(pending, signal)
      if (seen === 'retry') { if (!signal.aborted) this.later(); return }
      if (seen === 'retired') { await this.settle(pending, 'retired', 'look', validate); return }
      if (seen !== 'absent') { await this.settle(pending, seen, 'look', validate); return }
      // The server's own copy has no such post: the attempt being checked wrote nothing, so it goes again.
      pending = this.value.pending = await this.store<PendingPostCreation>({ kind: 'post-creation-state', id: pending.id, expected: 'submitted', state: 'prepared' }, validate)
    }
    const outcome = await this.send(pending, signal, validate)
    if (outcome === 'confirmed' || outcome === 'rejected') { await this.settle(this.value.pending!, outcome, 'send', validate); return }
    // Posted once and deleted since (A1): the job is over, with nothing to report as an error, and its words stay gone.
    if (outcome === 'retired') { await this.settle(this.value.pending!, 'retired', 'send', validate); return }
    if (!signal.aborted) this.later()
    this.value.message = outcome === 'check' ? tr('글 게시 응답을 확인하지 못했습니다. 서버에 없으면 같은 글로 다시 보냅니다.') : tr('글을 보내지 못했습니다. 연결되면 이어서 게시합니다.')
  }
  // How it ended is written to connection-check.log: a record that closes with no line before it was closed by a person.
  private async settle(pending: PendingPostCreation, ended: 'confirmed' | 'rejected' | 'retired', after: 'look' | 'send', validate: () => void): Promise<void> {
    const outcome = ended === 'rejected' ? 'rejected' : 'confirmed'
    this.value.pending = await this.store<PendingPostCreation>({ kind: 'post-creation-state', id: pending.id, expected: pending.state, state: outcome }, validate)
    recordConnectionStep('post-ended', `${ended} after ${after}`)
    this.attempt = 0
    this.value.message = ended === 'retired' ? tr('이미 삭제된 글이라 다시 올리지 않았습니다.') : (outcome === 'confirmed' ? tr('게시물 생성 응답을 확인하고 해당 기기 초안을 비웠습니다. 서버 집계·미러·알림의 완료를 확인한 것은 아닙니다.') : tr('게시를 시작하지 못했거나 서버가 거절했습니다. 초안은 유지됩니다. 최신 채널에서 다시 준비해 주세요.'))
  }
  // Whether the server has the post whose attempt went unanswered.
  private async look(pending: PendingPostCreation, signal: AbortSignal): Promise<'confirmed' | 'rejected' | 'absent' | 'retired' | 'retry'> {
    const reader = this.open()
    try {
      this.validate(true)
      const gate = (): void => { signal.throwIfAborted(); this.validate(true) }
      const doc = await reader.getDocument(`${documents}/channels/${pending.channelId}/posts/${pending.id}`, signal, gate)
      // Not there: deleted since, or never written — the server's deletion record tells them apart (A1 §3-4).
      if (!doc) return await this.deleted(reader, pending, signal, gate) ? 'retired' : 'absent'
      // The id is this device's own; a post under it by this account is the one sent, even if edited since.
      return stringField(doc.fields, 'authorId', 160) === this.uid && stringField(doc.fields, 'channelId', 160) === pending.channelId ? 'confirmed' : 'rejected'
    } catch (error) { this.failed = { stage: 'look', error }; return error instanceof ReadFailure && error.code === 'permission' ? 'rejected' : 'retry' }
    finally { reader.close() }
  }
  // A1 §3-4: the post's deletion record, read from the server (never a cache). A read that fails throws: the post is
  // then neither sent again nor ended, and is looked at again later.
  private async deleted(reader: Pick<FirestoreReader, 'getDocument'>, pending: PendingPostCreation, signal: AbortSignal, gate: () => void): Promise<boolean> {
    return Boolean(await reader.getDocument(`${documents}/channels/${pending.channelId}/deletedPosts/${pending.id}`, signal, gate))
  }
  // The channel as it is now: the open channel's own copy, or read from the server for a post that goes on while the
  // channel is not on screen (after a restart, or from another channel).
  private async currentSource(channelId: string, signal: AbortSignal): Promise<PostCreationSource> {
    try { return this.channel(channelId) } catch { /* not the channel on screen */ }
    const reader = this.open(), root = `${documents}/channels/${channelId}`, gate = (): void => { signal.throwIfAborted(); this.validate(true) }
    try {
      const channel = await reader.getDocument(root, signal, gate)
      if (!channel) throw new ChannelPostCreationFailure('refused')
      const admin = stringField(channel.fields, 'ownerId', 160) === this.uid ? undefined : await reader.getDocument(`${root}/admins/${this.uid}`, signal, gate) ?? undefined
      return { channel, admin }
    } catch (error) {
      if (error instanceof ReadFailure && error.code === 'permission') throw new ChannelPostCreationFailure('refused')
      throw error
    } finally { reader.close() }
  }
  private async send(pending: PendingPostCreation, signal: AbortSignal, validate: () => void): Promise<Attempt> {
    let source: PostCreationSource
    try {
      this.validate(true)
      source = await this.currentSource(pending.channelId, signal); validate()
      // Only the channel conditions it is checked against may have moved; what the post says is its own.
      const current = postCreationRequest({ ...request(pending), ...postCreationContext(this.uid, pending.channelId, source) })
      if (JSON.stringify(current) !== JSON.stringify(request(pending))) pending = this.value.pending = await this.store<PendingPostCreation>({ kind: 'post-creation-rebase', id: pending.id, expected: 'prepared', request: current }, validate)
    } catch (error) { this.failed = { stage: 'source', error }; return error instanceof ChannelPostCreationFailure && error.delivery === 'refused' ? 'rejected' : 'retry' }
    if (pending.photos.length) {
      try { await this.uploadPhotos(pending, signal, validate) }
      catch (error) { this.failed = { stage: 'upload', error }; return error instanceof UploadRefused || (error instanceof MorseCallableFailure && error.delivery === 'answered') ? 'rejected' : 'retry' }
    }
    this.value.pending = await this.store<PendingPostCreation>({ kind: 'post-creation-state', id: pending.id, expected: 'prepared', state: 'submitted' }, validate)
    const reader = this.open()
    try {
      await reader.createChannelPost(this.uid, request(pending), signal, () => { validate(); this.validate(true); return source })
      return 'confirmed'
    } catch (error) {
      this.failed = { stage: 'commit', error }
      const delivery = error instanceof ChannelPostCreationFailure ? error.delivery : 'unknown'
      // A refusal of a post deleted elsewhere: over, not failed. The record unread: looked at later.
      if (delivery === 'refused') {
        try { return await this.deleted(reader, pending, signal, () => { signal.throwIfAborted(); this.validate(true) }) ? 'retired' : 'rejected' }
        catch { return 'check' }
      }
      if (delivery === 'unknown') return 'check'
      // It never left: it waits as prepared, not as a result someone has to look for.
      this.value.pending = await this.store<PendingPostCreation>({ kind: 'post-creation-state', id: pending.id, expected: 'submitted', state: 'prepared' }, () => { if (this.closed) throw new Error(tr('계정이 변경되었습니다.')) })
      return 'retry'
    } finally { reader.close() }
  }
  // ChannelService.createPost: the upload grant, then every photo. The post is written only after all are stored.
  private async uploadPhotos(pending: PendingPostCreation, signal: AbortSignal, validate: () => void): Promise<void> {
    this.validate(true)
    await callMorseFunction(this.auth, 'prepareMorseChannelMediaUpload', { channelId: pending.channelId, postId: pending.id }, signal)
    const photos = await this.store<PostPhotoRecord[]>({ kind: 'post-photo-read', id: pending.id }, validate)
    for (const [index, photo] of photos.entries()) {
      const info = pending.photos[index]
      if (!info || info.id !== photo.id) throw new UploadRefused(tr('게시할 사진 기록을 확인하지 못했습니다.'))
      if (photo.uploaded) continue
      this.value.message = tr('사진 올리는 중 ({0}/{1})', [index + 1, photos.length]); this.publish()
      await uploadChannelPostPhoto(this.auth, this.uid, { channelId: pending.channelId, postId: pending.id, sha256: info.sha256, md5: info.md5 }, photo, signal,
        async session => { await this.store({ kind: 'post-photo-state', id: pending.id, photoId: photo.id, session }, validate) }, () => { validate(); this.validate(true) })
      await this.store({ kind: 'post-photo-state', id: pending.id, photoId: photo.id, uploaded: true }, validate)
    }
  }
  async close(): Promise<void> { this.closed = true; this.pause(); await this.job?.catch(() => {}); this.value.pending = null }
}
