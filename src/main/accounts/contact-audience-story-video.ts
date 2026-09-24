import { contactAudienceStoryVideoRequest, type ContactAudienceStoryVideoRequest, type ContactAudienceStoryVideoSnapshot } from '../../shared/contact-audience-story-video'
import type { OwnStoryDetail } from '../../shared/own-stories'
import type { OwnStoryVideoRequest } from '../../shared/own-story-video'
import type { ReadCredentials } from '../network/firestore-rpc'
import { storyHiddenFrom } from '../network/story-hidden-audience'
import { OwnStoryVideo } from './own-story-video'
import { storyMediaKey, type StoryMediaCache } from './story-media-cache'
import { tr } from '../../shared/i18n'
export class ContactAudienceStoryVideo {
  private closed = false
  private job: Promise<void> | null = null
  private selected: { request: ContactAudienceStoryVideoRequest; ownerId: string; viewer: OwnStoryVideo } | null = null
  constructor(private readonly uid: string, private readonly auth: ReadCredentials,
    private readonly prepare: (request: ContactAudienceStoryVideoRequest) => { ownerId: string; story: OwnStoryDetail; path: string | null; audioPath: string | null },
    private readonly contact: (request: ContactAudienceStoryVideoRequest) => string, private readonly cache: StoryMediaCache, private readonly changed: () => void) {}
  private validate(request: ContactAudienceStoryVideoRequest, ownerId: string): void {
    this.auth.signal.throwIfAborted()
    if (this.closed || this.selected?.request.selectionId !== request.selectionId || this.selected.ownerId !== ownerId || this.contact(request) !== ownerId) throw new Error(tr('선택한 연락처의 영상 읽기가 변경되었습니다.'))
  }
  get snapshot(): ContactAudienceStoryVideoSnapshot | null {
    const selected = this.selected
    if (!selected) return null
    try { this.validate(selected.request, selected.ownerId); return { ...selected.request, ownerId: selected.ownerId, media: selected.viewer.snapshot } }
    catch { return null }
  }
  pause(): void { const selected = this.selected; this.selected = null; selected?.viewer.clear() }
  prune(): void { const selected = this.selected; if (!selected) return; try { this.validate(selected.request, selected.ownerId); selected.viewer.prune() } catch { this.pause() } }
  dismiss(selectionId: string): void { if (this.selected?.request.selectionId === selectionId) { this.pause(); if (!this.closed) this.changed() } }
  open(input: ContactAudienceStoryVideoRequest): Promise<void> {
    const request = contactAudienceStoryVideoRequest(input)
    if (this.closed || this.job) throw new Error(tr('진행 중인 청중 영상 읽기를 마친 뒤 다시 선택해 주세요.'))
    const prepared = this.prepare(request)
    if (prepared.ownerId === this.uid || prepared.story.mediaType !== 'video' || prepared.story.audio !== (request.mode === 'with-audio' ? 'attached' : 'none') || prepared.story.privacy !== request.privacy) throw new Error(tr('현재 연락처의 청중 영상 스토리를 확인해 주세요.'))
    this.pause()
    const raw: OwnStoryVideoRequest = { mode: request.mode, selectionId: request.selectionId, requestId: request.requestId, storyId: request.storyId, version: request.version }
    const viewer = new OwnStoryVideo(prepared.ownerId, this.auth, current => {
      this.validate(request, prepared.ownerId)
      if (current.selectionId !== raw.selectionId || current.requestId !== raw.requestId || current.storyId !== raw.storyId || current.version !== raw.version || current.mode !== raw.mode) throw new Error(tr('청중 영상 선택이 변경되었습니다.'))
      return prepared.story
    }, () => { if (!this.closed) this.changed() }, { prefix: '__contact-audience-story-video', inspect: doc => { if (storyHiddenFrom(doc).hiddenFrom.includes(this.uid)) throw new Error(tr('청중 스토리 숨김 설정이 변경되었습니다.')) }, cache: this.cache, address: () => { const current = this.prepare(request); return { path: current.path, audioPath: current.audioPath } } })
    this.selected = { request, ownerId: prepared.ownerId, viewer }
    const task = Promise.resolve().then(() => viewer.load(raw)).finally(() => { if (this.job === task) this.job = null; if (!this.closed) this.changed() })
    this.job = task; this.changed(); return task
  }

  // Media::Stories::Controller::preloadNext fetches the stories around the one on screen. This fetches
  // one of them without taking the viewer's place: what it reads waits in the cache until it is opened.
  preload(input: ContactAudienceStoryVideoRequest): Promise<void> {
    const request = contactAudienceStoryVideoRequest(input)
    if (this.closed) throw new Error(tr('현재 연락처의 청중 영상 스토리를 확인해 주세요.'))
    const prepared = this.prepare(request)
    if (prepared.ownerId === this.uid || prepared.story.mediaType !== 'video' || prepared.story.audio !== (request.mode === 'with-audio' ? 'attached' : 'none') || prepared.story.privacy !== request.privacy) throw new Error(tr('현재 연락처의 청중 영상 스토리를 확인해 주세요.'))
    if (this.cache.has(storyMediaKey(prepared.ownerId, request.storyId, request.version, `video:${request.mode}:${prepared.story.privacy}`))) return Promise.resolve()
    const selectionId = request.selectionId
    const raw: OwnStoryVideoRequest = { mode: request.mode, selectionId, requestId: request.requestId, storyId: request.storyId, version: request.version }
    const viewer = new OwnStoryVideo(prepared.ownerId, this.auth, current => {
      this.auth.signal.throwIfAborted()
      if (this.closed || this.contact(request) !== prepared.ownerId) throw new Error(tr('현재 연락처의 청중 영상 스토리를 확인해 주세요.'))
      if (current.selectionId !== raw.selectionId || current.requestId !== raw.requestId || current.storyId !== raw.storyId || current.version !== raw.version || current.mode !== raw.mode) throw new Error(tr('청중 영상 선택이 변경되었습니다.'))
      return this.prepare(request).story
    }, () => {}, { prefix: '__contact-audience-story-video', inspect: doc => { if (storyHiddenFrom(doc).hiddenFrom.includes(this.uid)) throw new Error(tr('청중 스토리 숨김 설정이 변경되었습니다.')) }, cache: this.cache, address: () => { const current = this.prepare(request); return { path: current.path, audioPath: current.audioPath } } })
    return viewer.load(raw).finally(() => void viewer.close())
  }
  response(token: string, request: Request, audio = false): Response {
    const selected = this.selected
    try { if (!selected) throw new Error('No audience story video'); this.validate(selected.request, selected.ownerId); return selected.viewer.response(token, request, audio) }
    catch { return new Response(null, { status: 403 }) }
  }
  async close(): Promise<void> { this.closed = true; const selected = this.selected; this.pause(); await Promise.allSettled([this.job, selected?.viewer.close()]) }
}
