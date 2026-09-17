import { randomUUID } from 'node:crypto'
import type { OwnStoryDetail } from '../../shared/own-stories'
import type { OwnStoryPhotoRequest, OwnStoryPhotoSnapshot } from '../../shared/own-story-photo'
import { positionMilliseconds } from '../../shared/model'
import { backgroundImageInfo } from '../../shared/background-photo-bytes'
import { FirestoreReader, type ReadCredentials } from '../network/firestore-rpc'
import { documents, type FirestoreDocument } from '../network/firestore-values'
import { ownStoryCollections, ownStoryFromDocument } from '../network/own-story-document'
import { ownStoryPhotoPath } from '../media/own-story-photo-document'
import { downloadOwnStoryPhoto } from '../network/own-story-photo'
import { channelMediaResponse } from '../media/channel-media-response'
import { tr } from '../../shared/i18n'
interface Selection { request: OwnStoryPhotoRequest; abort: AbortController; reader: FirestoreReader; token: string; path: string | null; watched: boolean; bytes: Buffer | null; mime: string; deadline: number }
export class OwnStoryPhoto {
  private selected: Selection | null = null
  private value: OwnStoryPhotoSnapshot | null = null
  private job: Promise<void> | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private closed = false
  constructor(private readonly uid: string, private readonly auth: ReadCredentials, private readonly source: (request: OwnStoryPhotoRequest) => OwnStoryDetail, private readonly changed: () => void, private readonly options?: { prefix: '__contact-public-story-photo' | '__contact-audience-story-photo' | '__contact-story-photo-audio-image'; inspect(doc: FirestoreDocument): void }) {}
  private publish(): void { if (!this.closed) this.changed() }
  private validate(media: Selection, documentRequired = true): void {
    this.auth.signal.throwIfAborted(); media.abort.signal.throwIfAborted()
    if (this.closed || this.selected !== media || performance.now() >= media.deadline || (documentRequired && (!media.watched || !media.path))) throw new Error('Story photo lifetime changed')
    this.source(media.request)
  }
  get snapshot(): OwnStoryPhotoSnapshot | null {
    try { if (this.value) this.source(this.value); if (this.selected) this.validate(this.selected, this.value?.status === 'ready') }
    catch { return null }
    return this.value ? { ...this.value } : null
  }
  clear(): void {
    const media = this.selected; this.selected = null
    media?.abort.abort(); media?.reader.close(); media?.bytes?.fill(0)
    if (media) { media.bytes = null; media.path = null; media.watched = false }
    if (this.timer) clearTimeout(this.timer); this.timer = null; this.value = null
  }
  prune(): void { try { if (this.value) this.source(this.value); if (this.selected) this.validate(this.selected, this.value?.status === 'ready') } catch { this.clear() } }
  dismiss(selectionId: string): void { if (this.value?.selectionId === selectionId) { this.clear(); this.publish() } }
  load(request: OwnStoryPhotoRequest): Promise<void> {
    if (this.closed || this.job) throw new Error(tr('진행 중인 사진 읽기를 마친 뒤 다시 선택해 주세요.'))
    const source = this.source(request), lifetime = Math.min(60000, positionMilliseconds(source.expires) - Date.now())
    if (source.mediaType !== (request.presentation === 'video-poster' ? 'video' : 'image') || lifetime <= 0) throw new Error(tr('현재 만료되지 않은 사진 스토리를 선택해 주세요.'))
    this.clear()
    const media: Selection = { request: { ...request }, abort: new AbortController(), reader: new FirestoreReader(this.auth), token: randomUUID(), path: null, watched: false, bytes: null, mime: '', deadline: performance.now() + lifetime }
    this.selected = media; this.value = { ...request, status: 'loading', url: null, loaded: 0, total: null, message: tr('현재 스토리와 사진 권한을 확인하고 있습니다.') }
    this.timer = setTimeout(() => { if (this.selected === media) { this.clear(); this.publish() } }, lifetime)
    const signal = AbortSignal.any([this.auth.signal, media.abort.signal, AbortSignal.timeout(45000)])
    const task = this.download(media, signal).catch(() => {
      if (this.selected !== media) return
      this.clear(); this.value = { ...request, status: 'error', url: null, loaded: 0, total: null, message: tr('사진의 현재 문서·권한·형식·크기를 확인하지 못했습니다. 스토리 목록을 다시 읽은 뒤 열어 주세요.') }
    }).finally(() => { if (this.job === task) this.job = null; this.publish() })
    this.job = task; this.publish(); return task
  }
  private observe(media: Selection, signal: AbortSignal): Promise<string> {
    const source = this.source(media.request), path = `${documents}/users/${this.uid}/${ownStoryCollections[source.privacy]}/${source.id}`
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (error?: Error): void => {
        if (settled) { if (error && this.selected === media) { this.clear(); this.publish() } return }
        settled = true; signal.removeEventListener('abort', cancel)
        if (error) reject(error); else resolve(media.path!)
      }
      const cancel = (): void => finish(new Error('Story photo acquisition cancelled'))
      signal.addEventListener('abort', cancel, { once: true })
      media.reader.watch({ documents: { documents: [path] } }, media.abort.signal, {
        snapshot: rows => {
          if (this.selected !== media) return
          try {
            this.validate(media, false)
            const doc = rows.get(path)
            if (rows.size !== 1 || !doc || doc.name !== path) throw new Error('Story is absent')
            this.options?.inspect(doc)
            const current = ownStoryFromDocument(doc, this.uid, source.privacy)
            if (current.version !== media.request.version || current.mediaType !== (media.request.presentation === 'video-poster' ? 'video' : 'image') || positionMilliseconds(current.expires) <= Date.now()) throw new Error('Story changed or expired')
            const photoPath = ownStoryPhotoPath(doc, this.uid, media.request.presentation)
            if (media.path && media.path !== photoPath) throw new Error('Story photo source changed')
            media.path = photoPath; media.watched = true; finish()
          } catch { media.watched = false; finish(new Error('Current story cannot be confirmed')) }
        },
        state: state => {
          if (this.selected !== media || state === 'ready') return
          media.watched = false
          if (state === 'error' || settled) finish(new Error('Story watch lost its current state'))
        }
      }, 1, 1024 * 1024)
      if (signal.aborted) cancel()
    })
  }
  private async download(media: Selection, signal: AbortSignal): Promise<void> {
    const path = await this.observe(media, signal)
    signal.throwIfAborted(); this.validate(media)
    const downloaded = await downloadOwnStoryPhoto(this.auth, path, media.request.storyId, this.uid, signal, () => this.validate(media), 8 * 1024 * 1024, (loaded, total) => {
      this.validate(media)
      if (this.value?.selectionId === media.request.selectionId) { this.value.loaded = loaded; this.value.total = total; this.publish() }
    })
    try {
      signal.throwIfAborted(); this.validate(media)
      const info = backgroundImageInfo(downloaded)
      if (info.width * info.height > 8 * 1024 * 1024) throw new Error('Story photo dimensions too large')
      media.mime = info.type; media.bytes = downloaded
      this.value = { ...media.request, status: 'ready', url: `morse://app/${this.options?.prefix ?? '__own-story-photo'}/${media.token}`, loaded: downloaded.length, total: downloaded.length, message: '' }
    } catch (error) { downloaded.fill(0); throw error }
  }
  response(token: string, request: Request): Response {
    const media = this.selected
    try {
      if (!media?.bytes || media.token !== token || this.value?.status !== 'ready') throw new Error('Unavailable story photo')
      return channelMediaResponse(media.bytes, media.mime, request, () => this.validate(media))
    } catch { return new Response(null, { status: 403 }) }
  }
  async close(): Promise<void> { this.closed = true; this.clear(); await this.job?.catch(() => {}) }
}
