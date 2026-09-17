import type { StoryPublicationNavigation } from '../../shared/story-publication-navigation'
import { observeStoryPublication } from './story-publication-observation'
import { documents } from '../network/firestore-values'
import { ownStoryCollections } from '../network/own-story-document'
import type { StoryPublicationObservation } from '../../shared/story-publication'
import { FirestoreReader } from '../network/firestore-rpc'
import { StoryPublicationFailure } from '../network/story-publication-write'
import { uploadStoryPhoto, StoryPhotoUploadBlocked } from '../network/story-photo-upload-api'
import type { StoryPhotoUploadSource } from '../media/story-photo-upload-record'
import type { ReadCredentials } from '../network/firestore-rpc'
import type { BackgroundPhotoOwner } from '../platform/background-photos'
import type { StoryPublicationCommand } from '../storage/story-publication-table'
import { storyPublicationPrepare, type StoryPublicationPrepare, type PendingStoryPublication, type StoryPublicationSnapshot, type StoryPublicationAction } from '../../shared/story-publication'
import { tr } from '../../shared/i18n'
export class StoryPublication {
  private closed = false
  private job: Promise<void> | null = null
  private abort: AbortController | null = null
  private observation: StoryPublicationObservation | null = null
  private observationTimer: ReturnType<typeof setTimeout> | null = null
  private value: StoryPublicationSnapshot = { observation: null, canCheck: false, status: 'loading', busy: false, pending: null, message: '', progress: 0 }
  constructor(private readonly uid: string, private readonly auth: ReadCredentials, private readonly allowed: () => void, private readonly uploadAllowed: () => void,
    private readonly store: <T>(command: StoryPublicationCommand, validate: () => void) => Promise<T>, private readonly changed: () => void) {}
  private validate(): void { if (this.closed) throw new Error(tr('계정이 변경되었습니다.')); this.auth.signal.throwIfAborted(); this.allowed() }
  get snapshot(): StoryPublicationSnapshot {
    const pending = this.value.pending
    let canCheck = false
    if (pending && this.value.status === 'ready' && !this.value.busy && ['submitted', 'confirmed', 'rejected'].includes(pending.state)) { try { this.validate(); this.uploadAllowed(); canCheck = true } catch { /* Local records remain available offline. */ } }
    const now = Date.now(), current = this.observation
    const observation = canCheck && current && now - current.observedAt < 30000 && (current.outcome === 'expired' || current.expiresAt === null || current.expiresAt > now) ? { ...current } : null
    return { ...this.value, canCheck, observation, pending: pending ? { ...pending, hiddenFrom: [...pending.hiddenFrom], time: pending.time ? { ...pending.time } : null, uploads: pending.uploads ? { ...pending.uploads } : null } : null }
  }
  private clearObservation(): void { this.observation = null; if (this.observationTimer) clearTimeout(this.observationTimer); this.observationTimer = null }
  pause(): void { this.abort?.abort(); this.clearObservation() }
  private publish(): void { if (!this.closed) this.changed() }
  private run(operation: (signal: AbortSignal) => Promise<void>): Promise<void> {
    this.validate()
    if (this.job) throw new Error(tr('진행 중인 게시 준비를 확인해 주세요.'))
    this.clearObservation()
    const abort = new AbortController(); this.abort = abort; this.value.busy = true; this.value.message = ''; this.value.progress = 0
    const task = Promise.resolve().then(() => operation(abort.signal)).catch(error => { this.value.status = 'error'; this.value.message = tr('기기 게시 준비 기록을 다시 읽어 주세요. 준비 결과가 불확실한 동안 새 기록을 만들지 않습니다.'); throw error }).finally(() => { if (this.job === task) this.job = null; if (this.abort === abort) this.abort = null; this.value.busy = false; this.publish() })
    this.job = task; this.publish(); return task
  }
  refresh(): Promise<void> { return this.run(async signal => {
    const validate = (): void => { signal.throwIfAborted(); this.validate() }
    const pending = await this.store<PendingStoryPublication | null>({ kind: 'story-publication-read' }, validate)
    validate(); this.value.pending = pending; this.value.status = 'ready'
  }) }
  prepare(input: StoryPublicationPrepare): Promise<void> {
    const request = storyPublicationPrepare(input)
    if (this.value.status !== 'ready' || this.value.pending) throw new Error(tr('이전 게시 준비 기록을 먼저 확인해 주세요.'))
    return this.run(async signal => {
      const validate = (): void => { signal.throwIfAborted(); this.validate() }
      this.value.pending = await this.store<PendingStoryPublication>({ kind: 'story-publication-prepare', request }, validate)
      this.value.status = 'ready'; this.value.message = tr('설명·공개 범위·숨김 대상과 선택한 미디어를 기기 게시 준비 기록에 보관했습니다. 아직 서버에 업로드하거나 게시하지 않았습니다.')
    })
  }
  action(action: StoryPublicationAction): Promise<void> {
    if (this.value.status !== 'ready' || this.value.pending?.id !== action.id || this.value.pending.state !== action.state) throw new Error(tr('최신 게시 준비 기록을 확인해 주세요.'))
    return this.run(async signal => {
      if (action.action === 'check') { await this.check(signal); return }
      if (action.action === 'publish') { await this.commit(signal); return }
      if (action.action === 'upload') { await this.upload(signal); return }
      this.value.pending = await this.store<null>({ kind: 'story-publication-dismiss', id: action.id }, () => { signal.throwIfAborted(); this.validate() })
      this.value.message = tr('이 기기의 게시 기록을 닫았습니다. 서버 스토리·파일·업로드 세션을 삭제하거나 취소하지 않습니다. 성공 응답으로 이미 비운 초안은 복원하지 않습니다.')
    })
  }
  navigationSource(request: StoryPublicationNavigation): { storyId: string; privacy: PendingStoryPublication['privacy'] } {
    this.validate(); this.uploadAllowed()
    const pending = this.value.pending
    if (this.value.status !== 'ready' || this.value.busy || !pending || !pending.time || pending.id !== request.id || pending.state !== request.state || !['submitted', 'confirmed', 'rejected'].includes(pending.state)) throw new Error(tr('현재 게시 기록을 확인해 주세요.'))
    return { storyId: pending.id, privacy: pending.privacy }
  }
  private async check(outer: AbortSignal): Promise<void> {
    const pending = this.value.pending
    if (!pending || !pending.time || !['submitted', 'confirmed', 'rejected'].includes(pending.state)) throw new Error(tr('게시 요청 기록을 확인해 주세요.'))
    const signal = AbortSignal.any([outer, this.auth.signal, AbortSignal.timeout(35000)])
    const access = (): void => { signal.throwIfAborted(); this.validate(); this.uploadAllowed(); if (this.value.pending?.id !== pending.id || this.value.pending.state !== pending.state) throw new Error(tr('게시 기록이 변경되었습니다.')) }
    access()
    let reader: FirestoreReader | null = null
    try {
      reader = new FirestoreReader(this.auth)
      const doc = await reader.getDocument(`${documents}/users/${this.uid}/${ownStoryCollections[pending.privacy]}/${pending.id}`, signal, access)
      access(); this.observation = observeStoryPublication(pending, doc)
    } catch {
      try { this.validate(); this.uploadAllowed(); outer.throwIfAborted(); if (this.value.pending?.id !== pending.id || this.value.pending.state !== pending.state) throw new Error('Changed publication'); this.observation = { outcome: 'unavailable', observedAt: Date.now(), expiresAt: null, message: tr('현재 스토리 문서를 확인하지 못했습니다. 연결·권한·응답 형식 문제를 문서 부재나 게시 거절로 판단하지 않습니다. 기기 기록과 초안을 유지합니다.') } }
      catch { this.value.message = tr('계정 또는 조회 조건이 변경되어 관측 결과를 표시하지 않습니다.') }
    } finally { reader?.close() }
    if (this.observation) {
      const current = this.observation, remaining = current.expiresAt !== null && current.outcome !== 'expired' ? Math.max(1, current.expiresAt - Date.now()) : 30000
      this.observationTimer = setTimeout(() => { this.clearObservation(); this.publish() }, Math.min(30000, remaining))
    }
  }
  private async commit(signal: AbortSignal): Promise<void> {
    const validate = (): void => { signal.throwIfAborted(); this.validate() }
    const access = (): void => { validate(); this.uploadAllowed() }
    access()
    const original = this.value.pending
    if (!original || original.state !== 'uploaded') throw new Error(tr('준비한 모든 파일의 완료 응답을 먼저 확인해 주세요.'))
    const submitted = await this.store<PendingStoryPublication>({ kind: 'story-publication-submit', id: original.id }, access)
    this.value.pending = submitted; this.publish()
    let reader: FirestoreReader | null = null, outcome: 'confirmed' | 'rejected' | null = null
    try {
      if (!submitted.time) throw new Error(tr('게시 시각 기록을 확인하지 못했습니다.'))
      const { state: _state, uploads: _uploads, time, ...intent } = submitted
      reader = new FirestoreReader(this.auth)
      await reader.publishStory(this.uid, { intent, time }, signal, access)
      outcome = 'confirmed'
    } catch (error) {
      if (error instanceof StoryPublicationFailure && !error.uncertain) outcome = 'rejected'
      else this.value.message = tr('게시 요청 결과를 확인하지 못했습니다. 준비 기록과 원래 초안을 유지하며 자동으로 다시 게시하지 않습니다.')
    } finally { reader?.close() }
    if (outcome) {
      this.value.pending = await this.store<PendingStoryPublication>({ kind: 'story-publication-outcome', id: original.id, outcome }, validate)
      this.value.message = outcome === 'confirmed' ? tr('스토리 문서 생성 응답을 확인하고 원래 기기 초안과 사진·선택 오디오를 함께 비웠습니다. 현재 스토리 목록은 별도로 조회해 주세요.') : tr('게시를 시작하지 못했거나 서버가 거절했습니다. 원래 기기 초안과 사진·선택 오디오는 유지합니다. 이 기록을 자동 재전송하지 않습니다.')
    }
  }
  private async upload(outer: AbortSignal): Promise<void> {
    const signal = AbortSignal.any([outer, this.auth.signal, AbortSignal.timeout(300000)])
    const validate = (): void => { signal.throwIfAborted(); this.validate(); this.uploadAllowed() }
    validate()
    let pending = this.value.pending
    if (!pending || !['prepared', 'uploading'].includes(pending.state) || (pending.uploads && Object.values(pending.uploads).some(state => state === 'unknown' || state === 'expired'))) throw new Error(tr('업로드 기록을 확인해 주세요. 완료 응답이 없는 사진은 다시 전송하지 않습니다.'))
    const update = async (command: StoryPublicationCommand): Promise<void> => { this.value.pending = await this.store<PendingStoryPublication>(command, validate); this.publish() }
    if (pending.state === 'prepared') { await update({ kind: 'story-publication-upload-begin', id: pending.id }); pending = this.value.pending! }
    const id = pending.id, total = pending.fullBytes + pending.thumbnailBytes+(pending.audio?.bytes??0)
    let completedBytes=0
    for (const part of (pending.audio?['full','thumbnail','audio']:['full','thumbnail']) as import('../../shared/story-publication').StoryPhotoPart[]) {
      validate()
      const photo = await this.store<StoryPhotoUploadSource>({ kind: 'story-publication-upload-source', id, part }, validate)
      try {
        if (photo.transfer.state === 'acknowledged') { completedBytes+=photo.bytes.byteLength;this.value.progress=completedBytes/total;continue }
        let session = photo.transfer.session
        try {
          const receipt = await uploadStoryPhoto(this.auth, photo, signal, async value => { await update({ kind: 'story-publication-upload-session', id, part, session: value }); session = value }, bytes => { this.value.progress = (completedBytes + bytes) / total; this.publish() }, validate)
          if (!session) throw new Error(tr('업로드 세션 저장을 확인해 주세요.'))
          await update({ kind: 'story-publication-upload-ack', id, part, session, receipt });completedBytes+=photo.bytes.byteLength
        } catch (error) {
          if (error instanceof StoryPhotoUploadBlocked) await update({ kind: 'story-publication-upload-block', id, part, reason: error.reason })
          throw error
        }
      } finally { photo.bytes.fill(0) }
    }
    this.value.message = tr('준비한 사진·썸네일·선택 오디오의 업로드 완료 응답을 보관했습니다. 스토리 문서는 아직 게시하지 않았습니다.')
  }
  photoOwner(id: string): BackgroundPhotoOwner {
    const validate = (): void => { this.validate(); if (this.value.status !== 'ready' || this.value.pending?.id !== id) throw new Error(tr('게시 준비 사진이 변경되었습니다.')) }
    validate()
    return { key: JSON.stringify([this.uid, 'story-publication', id]), validate, load: async photoId => {
      validate(); if (photoId !== id) throw new Error(tr('다른 게시 준비 사진입니다.'))
      const value = await this.store<{ bytes: Uint8Array }>({ kind: 'story-publication-source', id }, validate)
      validate(); return value.bytes
    } }
  }
  async close(): Promise<void> { this.closed = true; this.pause(); await this.job?.catch(() => {}); this.value.pending = null }
}
