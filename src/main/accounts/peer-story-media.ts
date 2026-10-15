import { peerStoryPhotoAudioRequest, peerStoryPhotoRequest, peerStoryVideoRequest, type PeerStoryPhotoAudioRequest, type PeerStoryPhotoAudioSnapshot, type PeerStoryPhotoRequest, type PeerStoryPhotoSnapshot, type PeerStoryVideoRequest, type PeerStoryVideoSnapshot } from '../../shared/peer-stories'
import type { OwnStoryDetail } from '../../shared/own-stories'
import { positionMilliseconds } from '../../shared/model'
import type { ReadCredentials } from '../network/firestore-rpc'
import { serverNow } from '../network/server-clock'
import { OwnStoryPhoto } from './own-story-photo'
import { OwnStoryVideo } from './own-story-video'
import { OwnStoryAudio } from './own-story-audio'
import type { PeerStoryDetail } from './peer-stories'
import { storyMediaKey, type StoryMediaCache } from './story-media-cache'
import { recordStoryStep } from '../platform/story-diagnostics'
import { tr } from '../../shared/i18n'

// B408 S2: one person's story media, fetched from the addresses the feed copy (or getMorsePeerStories) names —
// tdesktop downloads what stories.getPeerStories named (Data::Stories, media_stories_controller preloadNext) and
// never reads the story again. `detail` throws once the story is no longer the one the open list holds.
type Detail = (target: { requestId: string; storyId: string; version: string }) => PeerStoryDetail
const same = (a: { selectionId: string; requestId: string; storyId: string; version: string }, b: typeof a): boolean =>
  a.selectionId === b.selectionId && a.requestId === b.requestId && a.storyId === b.storyId && a.version === b.version

export class PeerStoryPhoto {
  private closed = false
  private job: Promise<void> | null = null
  private selected: { request: PeerStoryPhotoRequest; ownerId: string; viewer: OwnStoryPhoto } | null = null
  // `gone`: the server said a story's picture is not there (B423) — Session.storyDeleted.
  constructor(private readonly uid: string, private readonly auth: ReadCredentials, private readonly detail: Detail, private readonly cache: StoryMediaCache, private readonly changed: () => void,
    private readonly gone: (storyPath: string) => void = () => {}) {}
  private prepared(request: PeerStoryPhotoRequest): PeerStoryDetail {
    const prepared = this.detail(request), poster = request.presentation === 'video-poster'
    if (this.closed || prepared.ownerId === this.uid || prepared.story.mediaType !== (poster ? 'video' : 'image') || !(poster ? prepared.poster : prepared.image)) throw new Error(tr('현재 사진 스토리를 다시 선택해 주세요.'))
    return prepared
  }
  private viewer(request: PeerStoryPhotoRequest, prepared: PeerStoryDetail, valid: () => void, changed: () => void): OwnStoryPhoto {
    const { ownerId, storyPath } = prepared
    return new OwnStoryPhoto(ownerId, this.auth, current => {
      this.auth.signal.throwIfAborted(); valid()
      if (!same(current, request) || current.presentation !== request.presentation) throw new Error(tr('사진 선택이 변경되었습니다.'))
      return this.prepared(request).story
    }, changed, { prefix: '__peer-story-photo', cache: this.cache, address: () => { const current = this.prepared(request); return request.presentation === 'video-poster' ? current.poster : current.image }, gone: () => this.gone(storyPath) })
  }
  get snapshot(): PeerStoryPhotoSnapshot | null {
    const selected = this.selected
    if (!selected) return null
    try { this.prepared(selected.request); return { ...selected.request, ownerId: selected.ownerId, media: selected.viewer.snapshot } } catch { return null }
  }
  pause(): void { const selected = this.selected; this.selected = null; selected?.viewer.clear() }
  prune(): void { const selected = this.selected; if (!selected) return; try { this.prepared(selected.request); selected.viewer.prune() } catch { this.pause() } }
  dismiss(selectionId: string): void { if (this.selected?.request.selectionId === selectionId) { this.pause(); if (!this.closed) this.changed() } }
  open(input: unknown): Promise<void> {
    const request = peerStoryPhotoRequest(input)
    if (this.closed || this.job) throw new Error(tr('진행 중인 사진 읽기를 마친 뒤 다시 선택해 주세요.'))
    const prepared = this.prepared(request)
    this.pause()
    const selected = { request, ownerId: prepared.ownerId, viewer: null as unknown as OwnStoryPhoto }
    selected.viewer = this.viewer(request, prepared, () => { if (this.closed || this.selected !== selected) throw new Error(tr('사진 선택이 변경되었습니다.')) }, () => { if (!this.closed) this.changed() })
    this.selected = selected
    // B416 ②: how long main takes to have a story photo ready once asked (a preloaded one should be at once).
    const started = performance.now()
    const task = Promise.resolve().then(() => selected.viewer.load(request)).finally(() => {
      recordStoryStep('photo-open', `ready=${selected.viewer.snapshot?.status ?? 'none'} ms=${Math.round(performance.now() - started)}`)
      if (this.job === task) this.job = null; if (!this.closed) this.changed()
    })
    this.job = task; this.changed(); return task
  }
  // Media::Stories::Controller::preloadNext: fetched without taking the viewer's place; it waits in the cache.
  preload(input: unknown): Promise<void> {
    const request = peerStoryPhotoRequest(input), prepared = this.prepared(request)
    if (this.cache.has(storyMediaKey(prepared.ownerId, request.storyId, request.version, `photo:${request.presentation}:${prepared.story.privacy}`))) return Promise.resolve()
    const viewer = this.viewer(request, prepared, () => { if (this.closed) throw new Error(tr('사진 선택이 변경되었습니다.')) }, () => {})
    return viewer.load(request).finally(() => void viewer.close())
  }
  response(token: string, request: Request): Response {
    const selected = this.selected
    try { if (!selected) throw new Error('No story photo'); this.prepared(selected.request); return selected.viewer.response(token, request) }
    catch { return new Response(null, { status: 403 }) }
  }
  async close(): Promise<void> { this.closed = true; const selected = this.selected; this.pause(); await Promise.allSettled([this.job, selected?.viewer.close()]) }
}

export class PeerStoryVideo {
  private closed = false
  private job: Promise<void> | null = null
  private selected: { request: PeerStoryVideoRequest; ownerId: string; viewer: OwnStoryVideo } | null = null
  constructor(private readonly uid: string, private readonly auth: ReadCredentials, private readonly detail: Detail, private readonly cache: StoryMediaCache, private readonly changed: () => void,
    private readonly gone: (storyPath: string) => void = () => {}) {}
  private prepared(request: PeerStoryVideoRequest): PeerStoryDetail {
    const prepared = this.detail(request), paired = request.mode === 'with-audio'
    if (this.closed || prepared.ownerId === this.uid || prepared.story.mediaType !== 'video' || prepared.story.audio !== (paired ? 'attached' : 'none') || !prepared.video || (paired && !prepared.audio)) throw new Error(tr('현재 영상 스토리를 다시 선택해 주세요.'))
    return prepared
  }
  private viewer(request: PeerStoryVideoRequest, prepared: PeerStoryDetail, valid: () => void, changed: () => void): OwnStoryVideo {
    const { ownerId, storyPath } = prepared
    return new OwnStoryVideo(ownerId, this.auth, current => {
      this.auth.signal.throwIfAborted(); valid()
      if (!same(current, request) || current.mode !== request.mode) throw new Error(tr('영상 선택이 변경되었습니다.'))
      return this.prepared(request).story
    }, changed, { prefix: '__peer-story-video', cache: this.cache, address: () => { const current = this.prepared(request); return { path: current.video, audioPath: request.mode === 'with-audio' ? current.audio : null } }, gone: () => this.gone(storyPath) })
  }
  get snapshot(): PeerStoryVideoSnapshot | null {
    const selected = this.selected
    if (!selected) return null
    try { this.prepared(selected.request); return { ...selected.request, ownerId: selected.ownerId, media: selected.viewer.snapshot } } catch { return null }
  }
  pause(): void { const selected = this.selected; this.selected = null; selected?.viewer.clear() }
  prune(): void { const selected = this.selected; if (!selected) return; try { this.prepared(selected.request); selected.viewer.prune() } catch { this.pause() } }
  dismiss(selectionId: string): void { if (this.selected?.request.selectionId === selectionId) { this.pause(); if (!this.closed) this.changed() } }
  open(input: unknown): Promise<void> {
    const request = peerStoryVideoRequest(input)
    if (this.closed || this.job) throw new Error(tr('진행 중인 영상 읽기를 마친 뒤 다시 선택해 주세요.'))
    const prepared = this.prepared(request)
    this.pause()
    const selected = { request, ownerId: prepared.ownerId, viewer: null as unknown as OwnStoryVideo }
    selected.viewer = this.viewer(request, prepared, () => { if (this.closed || this.selected !== selected) throw new Error(tr('영상 선택이 변경되었습니다.')) }, () => { if (!this.closed) this.changed() })
    this.selected = selected
    const task = Promise.resolve().then(() => selected.viewer.load(request)).finally(() => { if (this.job === task) this.job = null; if (!this.closed) this.changed() })
    this.job = task; this.changed(); return task
  }
  preload(input: unknown): Promise<void> {
    const request = peerStoryVideoRequest(input), prepared = this.prepared(request)
    if (this.cache.has(storyMediaKey(prepared.ownerId, request.storyId, request.version, `video:${request.mode}:${prepared.story.privacy}`))) return Promise.resolve()
    const viewer = this.viewer(request, prepared, () => { if (this.closed) throw new Error(tr('영상 선택이 변경되었습니다.')) }, () => {})
    return viewer.load(request).finally(() => void viewer.close())
  }
  response(token: string, request: Request, audio = false): Response {
    const selected = this.selected
    try { if (!selected) throw new Error('No story video'); this.prepared(selected.request); return selected.viewer.response(token, request, audio) }
    catch { return new Response(null, { status: 403 }) }
  }
  async close(): Promise<void> { this.closed = true; const selected = this.selected; this.pause(); await Promise.allSettled([this.job, selected?.viewer.close()]) }
}

// A photo with attached sound: both are fetched, and shown only when both are here.
interface Pair { request: PeerStoryPhotoAudioRequest; ownerId: string; phase: 'loading' | 'ready'; photo: OwnStoryPhoto; audio: OwnStoryAudio; photoStarted: boolean; audioStarted: boolean; deadline: number; expiresAt: number; timer: ReturnType<typeof setTimeout> | null; acquisition: ReturnType<typeof setTimeout> | null }
export class PeerStoryPhotoAudio {
  private closed = false
  private selected: Pair | null = null
  private job: Promise<void> | null = null
  constructor(private readonly uid: string, private readonly auth: ReadCredentials, private readonly detail: Detail, private readonly changed: () => void, private readonly now: () => number = serverNow,
    private readonly gone: (storyPath: string) => void = () => {}) {}
  private publish(): void { if (!this.closed) this.changed() }
  private prepared(request: PeerStoryPhotoAudioRequest): PeerStoryDetail {
    const prepared = this.detail(request)
    if (this.closed || prepared.ownerId === this.uid || prepared.story.mediaType !== 'image' || prepared.story.audio !== 'attached' || !prepared.image || !prepared.audio || prepared.image === prepared.audio) throw new Error(tr('첨부 오디오가 있는 현재 사진 스토리를 다시 선택해 주세요.'))
    return prepared
  }
  private validate(selected: Pair): void {
    this.auth.signal.throwIfAborted()
    if (this.closed || this.selected !== selected || performance.now() >= selected.deadline) throw new Error(tr('사진과 첨부 오디오의 현재 접근 상태가 변경되었습니다.'))
    this.prepared(selected.request)
  }
  pause(): void {
    const selected = this.selected; this.selected = null
    if (!selected) return
    if (selected.timer) clearTimeout(selected.timer)
    if (selected.acquisition) clearTimeout(selected.acquisition)
    selected.photo.clear(); selected.audio.clear()
  }
  private fail(selected: Pair): void { if (this.selected === selected) { this.pause(); this.publish() } }
  private childChanged(selected: Pair): void {
    if (this.selected !== selected) return
    try {
      this.validate(selected)
      const photo = selected.photo.snapshot, audio = selected.audio.snapshot
      if ((selected.photoStarted && (!photo || photo.status === 'error')) || (selected.audioStarted && (!audio || audio.status === 'error')) || (selected.phase === 'ready' && (photo?.status !== 'ready' || audio?.status !== 'ready'))) throw new Error('A paired resource is no longer ready')
      this.publish()
    } catch { this.fail(selected) }
  }
  get snapshot(): PeerStoryPhotoAudioSnapshot | null {
    const selected = this.selected
    if (!selected) return null
    try {
      this.validate(selected)
      const photo = selected.photo.snapshot, audio = selected.audio.snapshot, ready = selected.phase === 'ready' && photo?.status === 'ready' && audio?.status === 'ready'
      if (selected.phase === 'ready' && !ready) return null
      return { ...selected.request, ownerId: selected.ownerId, status: ready ? 'ready' : 'loading', photoUrl: ready ? photo!.url : null, audioUrl: ready ? audio!.url : null, loaded: (photo?.loaded ?? 0) + (audio?.loaded ?? 0), total: photo?.total != null && audio?.total != null ? photo.total + audio.total : null, expiresAt: selected.expiresAt }
    } catch { return null }
  }
  prune(): void { if (this.selected) this.childChanged(this.selected) }
  dismiss(id: string): void { if (this.selected?.request.selectionId === id) { this.pause(); this.publish() } }
  open(input: unknown): Promise<void> {
    const request = peerStoryPhotoAudioRequest(input)
    if (this.closed || this.job) throw new Error(tr('진행 중인 사진·오디오 읽기를 마친 뒤 다시 선택해 주세요.'))
    const prepared = this.prepared(request), lifetime = Math.min(60000, positionMilliseconds(prepared.story.expires) - this.now())
    if (lifetime <= 0) throw new Error(tr('첨부 오디오가 있는 현재 사진 스토리를 다시 선택해 주세요.'))
    this.pause()
    let selected: Pair
    const source = (current: PeerStoryPhotoAudioRequest): OwnStoryDetail => {
      this.validate(selected)
      if (!same(current, request)) throw new Error(tr('사진·오디오 선택이 변경되었습니다.'))
      return this.prepared(request).story
    }
    const photo = new OwnStoryPhoto(prepared.ownerId, this.auth, current => { if (current.presentation !== 'image') throw new Error('Expected image'); return source(current) }, () => this.childChanged(selected), { prefix: '__peer-story-photo-audio-image', address: () => this.prepared(request).image, gone: () => this.gone(prepared.storyPath) })
    const audio = new OwnStoryAudio(prepared.ownerId, this.auth, source, () => this.childChanged(selected), { prefix: '__peer-story-photo-audio-sound', address: () => this.prepared(request).audio })
    selected = { request, ownerId: prepared.ownerId, photo, audio, photoStarted: false, audioStarted: false, phase: 'loading', deadline: performance.now() + lifetime, expiresAt: this.now() + lifetime, timer: null, acquisition: null }
    this.selected = selected
    selected.timer = setTimeout(() => this.fail(selected), lifetime)
    selected.acquisition = setTimeout(() => this.fail(selected), Math.min(45000, lifetime))
    const task = Promise.resolve().then(async () => {
      const results = await Promise.allSettled([
        Promise.resolve().then(() => { this.validate(selected); selected.photoStarted = true; return photo.load({ ...request, presentation: 'image' }) }),
        Promise.resolve().then(() => { this.validate(selected); selected.audioStarted = true; return audio.load(request) })
      ])
      if (this.selected !== selected) return
      this.validate(selected)
      if (results.some(result => result.status === 'rejected') || photo.snapshot?.status !== 'ready' || audio.snapshot?.status !== 'ready') throw new Error('Both resources are required')
      selected.phase = 'ready'
      if (selected.acquisition) clearTimeout(selected.acquisition); selected.acquisition = null
      this.publish()
    }).catch(() => this.fail(selected)).finally(() => { if (this.job === task) this.job = null; this.publish() })
    this.job = task; this.publish(); return task
  }
  response(kind: 'image' | 'audio', token: string, request: Request): Response {
    const selected = this.selected
    try {
      if (!selected) throw new Error('No paired story')
      this.validate(selected)
      if (selected.phase !== 'ready' || selected.photo.snapshot?.status !== 'ready' || selected.audio.snapshot?.status !== 'ready') throw new Error('Both resources are required')
      return (kind === 'image' ? selected.photo : selected.audio).response(token, request)
    } catch { return new Response(null, { status: 403 }) }
  }
  async close(): Promise<void> { this.closed = true; this.pause(); await this.job?.catch(() => {}) }
}
