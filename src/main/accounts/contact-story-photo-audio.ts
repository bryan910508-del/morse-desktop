import { contactStoryPhotoAudioRequest, type ContactStoryPhotoAudioRequest, type ContactStoryPhotoAudioSnapshot } from '../../shared/contact-story-photo-audio'
import type { OwnStoryDetail } from '../../shared/own-stories'
import type { OwnStoryPhotoRequest } from '../../shared/own-story-photo'
import type { OwnStoryAudioRequest } from '../../shared/own-story-audio'
import { positionMilliseconds } from '../../shared/model'
import type { ReadCredentials } from '../network/firestore-rpc'
import type { FirestoreDocument } from '../network/firestore-values'
import { ownStoryFromDocument } from '../network/own-story-document'
import { storyHiddenFrom } from '../network/story-hidden-audience'
import { ownStoryPhotoPath } from '../media/own-story-photo-document'
import { ownStoryAudioPath } from '../media/own-story-audio-document'
import { OwnStoryPhoto } from './own-story-photo'
import { OwnStoryAudio } from './own-story-audio'
import { tr } from '../../shared/i18n'
interface Selection { request: ContactStoryPhotoAudioRequest; ownerId: string; phase: 'loading' | 'ready'; photo: OwnStoryPhoto; audio: OwnStoryAudio; photoStarted: boolean; audioStarted: boolean; deadline: number; expiresAt: number; timer: ReturnType<typeof setTimeout> | null; acquisition: ReturnType<typeof setTimeout> | null }
export class ContactStoryPhotoAudio {
  private closed = false
  private selected: Selection | null = null
  private job: Promise<void> | null = null
  constructor(private readonly uid: string, private readonly auth: ReadCredentials, private readonly prepare: (request: ContactStoryPhotoAudioRequest) => { ownerId: string; story: OwnStoryDetail }, private readonly contact: (request: ContactStoryPhotoAudioRequest) => string, private readonly changed: () => void) {}
  private publish(): void { if (!this.closed) this.changed() }
  private validate(selected: Selection): void {
    this.auth.signal.throwIfAborted()
    if (this.closed || this.selected !== selected || performance.now() >= selected.deadline || this.contact(selected.request) !== selected.ownerId) throw new Error(tr('사진과 첨부 오디오의 현재 접근 상태가 변경되었습니다.'))
  }
  prepareSource(input: ContactStoryPhotoAudioRequest): { ownerId: string; story: OwnStoryDetail } {
    const request = contactStoryPhotoAudioRequest(input), prepared = this.prepare(request)
    if (this.closed || prepared.ownerId === this.uid || prepared.story.mediaType !== 'image' || prepared.story.audio !== 'attached' || prepared.story.privacy !== request.privacy || positionMilliseconds(prepared.story.expires) <= Date.now()) throw new Error(tr('첨부 오디오가 있는 현재 사진 스토리를 다시 선택해 주세요.'))
    return prepared
  }
  pause(): void {
    const selected = this.selected; this.selected = null
    if (!selected) return
    if (selected.timer) clearTimeout(selected.timer)
    if (selected.acquisition) clearTimeout(selected.acquisition)
    selected.photo.clear(); selected.audio.clear()
  }
  private fail(selected: Selection): void { if (this.selected === selected) { this.pause(); this.publish() } }
  private childChanged(selected: Selection): void {
    if (this.selected !== selected) return
    try {
      this.validate(selected)
      const photo = selected.photo.snapshot, audio = selected.audio.snapshot
      if ((selected.photoStarted && (!photo || photo.status === 'error')) || (selected.audioStarted && (!audio || audio.status === 'error')) || (selected.phase === 'ready' && (photo?.status !== 'ready' || audio?.status !== 'ready'))) throw new Error('A paired resource is no longer ready')
      this.publish()
    } catch { this.fail(selected) }
  }
  get snapshot(): ContactStoryPhotoAudioSnapshot | null {
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
  open(input: ContactStoryPhotoAudioRequest): Promise<void> {
    const request = contactStoryPhotoAudioRequest(input)
    if (this.closed || this.job) throw new Error(tr('진행 중인 사진·오디오 읽기를 마친 뒤 다시 선택해 주세요.'))
    const prepared = this.prepareSource(request), lifetime = Math.min(60000, positionMilliseconds(prepared.story.expires) - Date.now())
    this.pause()
    const rawAudio: OwnStoryAudioRequest = { selectionId: request.selectionId, requestId: request.requestId, storyId: request.storyId, version: request.version }, rawPhoto: OwnStoryPhotoRequest = { ...rawAudio, presentation: 'image' }
    let selected: Selection
    const source = (current: OwnStoryAudioRequest): OwnStoryDetail => {
      this.validate(selected)
      if (current.selectionId !== rawAudio.selectionId || current.requestId !== rawAudio.requestId || current.storyId !== rawAudio.storyId || current.version !== rawAudio.version) throw new Error(tr('사진·오디오 선택이 변경되었습니다.'))
      return prepared.story
    }
    const inspect = (doc: FirestoreDocument): void => {
      const current = ownStoryFromDocument(doc, prepared.ownerId, request.privacy)
      if (current.mediaType !== 'image' || current.audio !== 'attached' || storyHiddenFrom(doc).hiddenFrom.includes(this.uid) || ownStoryPhotoPath(doc, prepared.ownerId, 'image') === ownStoryAudioPath(doc, prepared.ownerId)) throw new Error(tr('사진·오디오 문서 구성이 변경되었습니다.'))
    }
    const photo = new OwnStoryPhoto(prepared.ownerId, this.auth, current => { if (current.presentation !== 'image') throw new Error('Expected image'); return source(current) }, () => this.childChanged(selected), { prefix: '__contact-story-photo-audio-image', inspect })
    const audio = new OwnStoryAudio(prepared.ownerId, this.auth, source, () => this.childChanged(selected), { prefix: '__contact-story-photo-audio-sound', inspect })
    selected = { request, ownerId: prepared.ownerId, photo, audio, photoStarted: false, audioStarted: false, phase: 'loading', deadline: performance.now() + lifetime, expiresAt: Date.now() + lifetime, timer: null, acquisition: null }
    this.selected = selected
    selected.timer = setTimeout(() => this.fail(selected), lifetime)
    selected.acquisition = setTimeout(() => this.fail(selected), Math.min(45000, lifetime))
    const task = Promise.resolve().then(async () => {
      const results = await Promise.allSettled([
        Promise.resolve().then(() => { this.validate(selected); selected.photoStarted = true; return photo.load(rawPhoto) }),
        Promise.resolve().then(() => { this.validate(selected); selected.audioStarted = true; return audio.load(rawAudio) })
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
