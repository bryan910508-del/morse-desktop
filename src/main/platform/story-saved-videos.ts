import { randomUUID, createHash } from 'node:crypto'
import { channelMediaResponse } from '../media/channel-media-response'
import { storyVideoHeaders } from '../media/story-video-headers'
import { backgroundImageInfo } from '../../shared/background-photo-bytes'
import type { StoryComposerVideoReference, StoryComposerVideoStoredSource, StoryComposerVideoView } from '../../shared/story-composer-video-storage'
import { tr } from '../../shared/i18n'
interface Owner { validate(): void; load(): Promise<StoryComposerVideoStoredSource> }
interface Lease { owner: Owner; view: StoryComposerVideoView; video: Buffer; poster: Buffer; timer: NodeJS.Timeout }
const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
export class StorySavedVideos {
  private lease: Lease | null = null
  private loading = false
  private generation = 0
  async open(owner: Owner, reference: StoryComposerVideoReference): Promise<StoryComposerVideoView> {
    this.prune(); owner.validate()
    if (this.loading || this.lease) throw new Error(tr('열려 있는 저장 영상 미리보기를 먼저 닫아 주세요.'))
    this.loading = true; const generation = this.generation
    let source: StoryComposerVideoStoredSource | null = null, adopted = false
    try {
      source = await owner.load(); owner.validate()
      if (generation !== this.generation) throw new Error(tr('영상 미리보기 요청이 변경되었습니다.'))
      const { record, pair } = source, value = record.video
      if (record.id !== reference.id || record.revision !== reference.revision || value?.sourceId !== reference.sourceId || value.posterId !== reference.posterId || pair.frameTime !== value.frameTime) throw new Error(tr('현재 저장한 영상이 변경되었습니다.'))
      const video = Buffer.from(pair.video.buffer, pair.video.byteOffset, pair.video.byteLength), poster = Buffer.from(pair.poster.buffer, pair.poster.byteOffset, pair.poster.byteLength), info = storyVideoHeaders(video), image = backgroundImageInfo(poster, true)
      if (video.length !== value.bytes || poster.length !== value.posterBytes || digest(video) !== value.sha256 || digest(poster) !== value.posterSha256 || info.declaredDuration !== value.declaredDuration || info.trackWidth !== value.trackWidth || info.trackHeight !== value.trackHeight || image.width !== value.posterWidth || image.height !== value.posterHeight) throw new Error(tr('저장한 영상과 포스터의 내용이 일치하지 않습니다.'))
      const token = randomUUID(), expiresAt = Date.now() + 60000
      const view: StoryComposerVideoView = { token, expiresAt, record, videoURL: `morse://app/__story-saved-video/${token}/video`, posterURL: `morse://app/__story-saved-video/${token}/poster` }
      const timer = setTimeout(() => this.release(token), 60000); timer.unref()
      this.lease = { owner, view, video, poster, timer }; adopted = true
      return view
    } finally { this.loading = false; if (!adopted) { source?.pair.video.fill(0); source?.pair.poster.fill(0) } }
  }
  response(path: string, request: Request): Response {
    this.prune(); const current = this.lease, pieces = path.split('/')
    if (!current || pieces.length !== 2 || pieces[0] !== current.view.token || !['video', 'poster'].includes(pieces[1]!)) return new Response(null, { status: 404 })
    const validate = (): void => { current.owner.validate(); if (this.lease !== current || current.view.expiresAt <= Date.now()) throw new Error(tr('저장 영상 미리보기가 만료되었습니다.')) }
    try { return channelMediaResponse(pieces[1] === 'video' ? current.video : current.poster, pieces[1] === 'video' ? 'video/mp4' : 'image/jpeg', request, validate) }
    catch { return new Response(null, { status: 403 }) }
  }
  release(token: string): void { const current = this.lease; if (current?.view.token === token) { this.lease = null; clearTimeout(current.timer); current.video.fill(0); current.poster.fill(0) } }
  clear(): void { this.generation++; if (this.lease) this.release(this.lease.view.token) }
  prune(): void { if (this.lease) { try { this.lease.owner.validate(); if (this.lease.view.expiresAt <= Date.now()) this.release(this.lease.view.token) } catch { if (this.lease) this.release(this.lease.view.token) } } }
}
