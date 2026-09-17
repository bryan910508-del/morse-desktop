import { contactPublicStoryVideoRequest, type ContactPublicStoryVideoRequest, type ContactPublicStoryVideoSnapshot } from '../../shared/contact-public-story-video'
import type { OwnStoryDetail } from '../../shared/own-stories'
import type { OwnStoryVideoRequest } from '../../shared/own-story-video'
import type { ReadCredentials } from '../network/firestore-rpc'
import { storyHiddenFrom } from '../network/story-hidden-audience'
import { OwnStoryVideo } from './own-story-video'
import { tr } from '../../shared/i18n'
export class ContactPublicStoryVideo {
  private closed = false
  private job: Promise<void> | null = null
  private selected: { request: ContactPublicStoryVideoRequest; ownerId: string; viewer: OwnStoryVideo } | null = null
  constructor(private readonly uid: string, private readonly auth: ReadCredentials,
    private readonly prepare: (request: ContactPublicStoryVideoRequest) => { ownerId: string; story: OwnStoryDetail },
    private readonly contact: (profileRequestId: string) => string, private readonly changed: () => void) {}
  private validate(request: ContactPublicStoryVideoRequest, ownerId: string): void {
    this.auth.signal.throwIfAborted()
    if (this.closed || this.selected?.request.selectionId !== request.selectionId || this.selected.ownerId !== ownerId || this.contact(request.profileRequestId) !== ownerId) throw new Error(tr('선택한 연락처의 영상 읽기가 변경되었습니다.'))
  }
  get snapshot(): ContactPublicStoryVideoSnapshot | null {
    const selected = this.selected
    if (!selected) return null
    try { this.validate(selected.request, selected.ownerId); return { ...selected.request, ownerId: selected.ownerId, media: selected.viewer.snapshot } }
    catch { return null }
  }
  pause(): void { const selected = this.selected; this.selected = null; selected?.viewer.clear() }
  prune(): void { const selected = this.selected; if (!selected) return; try { this.validate(selected.request, selected.ownerId); selected.viewer.prune() } catch { this.pause() } }
  dismiss(selectionId: string): void { if (this.selected?.request.selectionId === selectionId) { this.pause(); if (!this.closed) this.changed() } }
  open(input: ContactPublicStoryVideoRequest): Promise<void> {
    const request = contactPublicStoryVideoRequest(input)
    if (this.closed || this.job) throw new Error(tr('진행 중인 공개 영상 읽기를 마친 뒤 다시 선택해 주세요.'))
    const prepared = this.prepare(request)
    if (prepared.ownerId === this.uid || prepared.story.mediaType !== 'video' || prepared.story.audio !== (request.mode === 'with-audio' ? 'attached' : 'none') || prepared.story.privacy !== 'everyone') throw new Error(tr('현재 연락처의 공개 영상 스토리를 확인해 주세요.'))
    this.pause()
    const raw: OwnStoryVideoRequest = { mode: request.mode, selectionId: request.selectionId, requestId: request.requestId, storyId: request.storyId, version: request.version }
    const viewer = new OwnStoryVideo(prepared.ownerId, this.auth, current => {
      this.validate(request, prepared.ownerId)
      if (current.selectionId !== raw.selectionId || current.requestId !== raw.requestId || current.storyId !== raw.storyId || current.version !== raw.version || current.mode !== raw.mode) throw new Error(tr('공개 영상 선택이 변경되었습니다.'))
      return prepared.story
    }, () => { if (!this.closed) this.changed() }, { prefix: '__contact-public-story-video', inspect: doc => { if (storyHiddenFrom(doc).hiddenFrom.includes(this.uid)) throw new Error(tr('공개 스토리 숨김 설정이 변경되었습니다.')) } })
    this.selected = { request, ownerId: prepared.ownerId, viewer }
    const task = Promise.resolve().then(() => viewer.load(raw)).finally(() => { if (this.job === task) this.job = null; if (!this.closed) this.changed() })
    this.job = task; this.changed(); return task
  }
  response(token: string, request: Request, audio = false): Response {
    const selected = this.selected
    try { if (!selected) throw new Error('No public story video'); this.validate(selected.request, selected.ownerId); return selected.viewer.response(token, request, audio) }
    catch { return new Response(null, { status: 403 }) }
  }
  async close(): Promise<void> { this.closed = true; const selected = this.selected; this.pause(); await Promise.allSettled([this.job, selected?.viewer.close()]) }
}
