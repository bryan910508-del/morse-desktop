import { observeStoryVideoPublication } from './story-video-observation'
import { documents } from '../network/firestore-values'
import { ownStoryCollections } from '../network/own-story-document'
import { storyVideoObservationRequest, type StoryVideoObservationRequest, type StoryVideoObservation } from '../../shared/story-video-observation'
import { FirestoreReader } from '../network/firestore-rpc'
import { StoryVideoPublicationFailure } from '../network/story-video-publication-write'
import { storyVideoPublishRequest, type StoryVideoPublishRequest } from '../../shared/story-video-publication-commit'
import type { ReadCredentials } from '../network/firestore-rpc'
import { uploadStoryVideo, StoryVideoUploadBlocked } from '../network/story-video-upload-api'
import type { StoryVideoUploadSource } from '../media/story-video-upload-record'
import type { StoryVideoPublicationCommand } from '../storage/story-video-publication-table'
import { storyVideoUploadRequest, type StoryVideoUploadRequest, type PendingStoryVideoPublication } from '../../shared/story-video-publication'
import { tr } from '../../shared/i18n'
export class StoryVideoUpload {
  private job: Promise<PendingStoryVideoPublication> | null = null
  private observationJob: Promise<StoryVideoObservation> | null = null
  private abort: AbortController | null = null
  private closed = false
  constructor(private readonly uid: string, private readonly auth: ReadCredentials, private readonly allowed: () => void, private readonly store: <T>(command: StoryVideoPublicationCommand, validate: () => void) => Promise<T>) {}
  get busy(): boolean { return this.job !== null || this.observationJob !== null }
  pause(): void { this.abort?.abort() }
  upload(raw: StoryVideoUploadRequest, active: () => void): Promise<PendingStoryVideoPublication> {
    const request = storyVideoUploadRequest(raw)
    if (this.closed || this.busy) throw new Error(tr('진행 중인 영상 업로드를 확인해 주세요.'))
    const abort = new AbortController(), signal = AbortSignal.any([abort.signal,this.auth.signal,AbortSignal.timeout(300000)])
    const validate = (): void => { signal.throwIfAborted(); if (this.closed) throw new Error(tr('계정이 변경되었습니다.')); active(); this.allowed() }
    validate(); this.abort = abort
    const task = (async () => {
      let current = await this.store<PendingStoryVideoPublication | null>({ kind: 'story-video-publication-read' },validate); validate()
      if (!current || current.ownerId !== this.uid || current.id !== request.id || current.state !== request.state || (current.uploads && Object.values(current.uploads).some(s => s === 'unknown' || s === 'expired'))) throw new Error(tr('현재 영상 업로드 기록을 다시 읽어 주세요. 완료 응답이 없는 파일을 새로 전송하지 않습니다.'))
      const update = async (command: StoryVideoPublicationCommand): Promise<PendingStoryVideoPublication> => { const value = await this.store<PendingStoryVideoPublication>(command,validate); validate(); if (value.id !== request.id) throw new Error(tr('영상 게시 준비 ID가 변경되었습니다.')); return value }
      if (current.state === 'prepared') current = await update({ kind: 'story-video-publication-upload-begin',id:request.id })
      for (const part of (current.audio?['video','poster','audio']:['video','poster']) as import('../../shared/story-video-publication').StoryVideoPart[]) {
        validate()
        if (current.uploads?.[part] === 'acknowledged') continue
        const source = await this.store<StoryVideoUploadSource>({ kind: 'story-video-publication-upload-source',id:request.id,part },validate)
        try {
          validate(); if (source.intent.id !== request.id || source.intent.ownerId !== this.uid || source.part !== part) throw new Error(tr('영상 업로드 원본이 변경되었습니다.'))
          let session = source.transfer.session
          try {
            const receipt = await uploadStoryVideo(this.auth,source,signal,async value => { current = await update({ kind: 'story-video-publication-upload-session',id:request.id,part,session:value }); session = value },() => {},validate)
            if (!session) throw new Error(tr('업로드 세션 저장을 확인해 주세요.'))
            current = await update({ kind: 'story-video-publication-upload-ack',id:request.id,part,session,receipt })
          } catch (error) { if (error instanceof StoryVideoUploadBlocked) await update({ kind: 'story-video-publication-upload-block',id:request.id,part,reason:error.reason }); throw error }
        } finally { source.bytes.fill(0) }
      }
      if (current.state !== 'uploaded' || !current.uploads || Object.values(current.uploads).some(state=>state!=='acknowledged')) throw new Error(tr('준비한 모든 파일의 완료 응답을 확인해 주세요.'))
      return current
    })().finally(() => { if (this.job === task) this.job = null; if (this.abort === abort) this.abort = null })
    this.job = task; return task
  }
  commit(raw: StoryVideoPublishRequest, active: () => void): Promise<PendingStoryVideoPublication> {
    const request = storyVideoPublishRequest(raw)
    if (this.closed || this.busy) throw new Error(tr('진행 중인 영상 게시 작업을 확인해 주세요.'))
    const abort = new AbortController(), signal = AbortSignal.any([abort.signal,this.auth.signal,AbortSignal.timeout(65000)])
    const validate = (): void => { signal.throwIfAborted(); if (this.closed) throw new Error(tr('계정이 변경되었습니다.')); active(); this.allowed() }
    validate(); this.abort = abort
    const task = (async () => {
      const current = await this.store<PendingStoryVideoPublication | null>({ kind:'story-video-publication-read' },validate); validate()
      if (!current || current.id !== request.id || current.ownerId !== this.uid || current.state !== 'uploaded') throw new Error(tr('모든 준비 파일의 완료 응답이 있는 현재 기록을 선택해 주세요.'))
      const submitted = await this.store<PendingStoryVideoPublication>({ kind:'story-video-publication-submit',id:request.id },validate)
      let reader: FirestoreReader | null = null, outcome: 'confirmed' | 'rejected' | null = null
      try {
        validate(); if (!submitted.time || submitted.id !== request.id || submitted.state !== 'submitted') throw new Error(tr('영상 게시 시각 기록을 확인하지 못했습니다.'))
        const { state:_state,uploads:_uploads,time,...intent } = submitted
        reader = new FirestoreReader(this.auth)
        await reader.publishVideoStory(this.uid,{ intent,time },signal,validate); outcome = 'confirmed'
      } catch (error) { if (error instanceof StoryVideoPublicationFailure && !error.uncertain) outcome = 'rejected' }
      finally { reader?.close() }
      if (!outcome) throw new Error(tr('영상 게시 응답을 확인하지 못했습니다. 자동 재게시하지 않습니다. 기기 기록을 다시 읽어 주세요.'))
      const value = await this.store<PendingStoryVideoPublication>({ kind:'story-video-publication-outcome',id:request.id,outcome },validate); validate(); return value
    })().finally(() => { if (this.job === task) this.job = null; if (this.abort === abort) this.abort = null })
    this.job = task; return task
  }
  check(raw: StoryVideoObservationRequest, active: () => void): Promise<StoryVideoObservation> {
    const request = storyVideoObservationRequest(raw)
    if (this.closed || this.busy) throw new Error(tr('진행 중인 영상 게시 작업을 확인해 주세요.'))
    const abort = new AbortController(), signal = AbortSignal.any([abort.signal,this.auth.signal,AbortSignal.timeout(35000)])
    const validate = (): void => { abort.signal.throwIfAborted(); this.auth.signal.throwIfAborted(); if (this.closed) throw new Error(tr('계정이 변경되었습니다.')); active(); this.allowed() }
    validate(); this.abort = abort
    const task = (async (): Promise<StoryVideoObservation> => {
      const current = await this.store<PendingStoryVideoPublication | null>({ kind:'story-video-publication-read' },validate); validate()
      if (!current || current.id !== request.id || current.state !== request.state || current.ownerId !== this.uid || !current.time) throw new Error(tr('영상 게시 기록이 변경되었습니다.'))
      let reader: FirestoreReader | null = null, result: import('../../shared/story-publication').StoryPublicationObservation
      try {
        reader = new FirestoreReader(this.auth)
        const doc = await reader.getDocument(`${documents}/users/${this.uid}/${ownStoryCollections[current.privacy]}/${current.id}`,signal,validate)
        validate(); result = observeStoryVideoPublication(current,doc)
      } catch { validate(); result = { outcome:'unavailable',observedAt:Date.now(),expiresAt:null,message:tr('현재 영상 스토리 문서를 확인하지 못했습니다. 연결·권한·응답 문제를 문서 부재나 게시 거절로 판단하지 않습니다. 기기 기록과 초안을 유지합니다.') } }
      finally { reader?.close() }
      const after = await this.store<PendingStoryVideoPublication | null>({ kind:'story-video-publication-read' },validate); validate()
      if (JSON.stringify(after) !== JSON.stringify(current)) throw new Error(tr('조회 도중 영상 게시 기록이 변경되었습니다.'))
      return { ...result,...request }
    })().finally(() => { if (this.observationJob === task) this.observationJob = null; if (this.abort === abort) this.abort = null })
    this.observationJob = task; return task
  }
  async close(): Promise<void> { this.closed = true; this.pause(); await this.job?.catch(() => {}); await this.observationJob?.catch(() => {}) }
}
