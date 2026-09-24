import { ownStoryAudioPath } from '../media/own-story-audio-document'
import { downloadOwnStoryAudio } from '../network/own-story-audio'
import { randomUUID } from 'node:crypto'
import type { OwnStoryDetail } from '../../shared/own-stories'
import type { OwnStoryVideoRequest, OwnStoryVideoSnapshot } from '../../shared/own-story-video'
import { positionMilliseconds } from '../../shared/model'
import { mediaType } from '../media/media-type'
import { FirestoreReader, type ReadCredentials } from '../network/firestore-rpc'
import { documents, type FirestoreDocument } from '../network/firestore-values'
import { ownStoryCollections, ownStoryFromDocument } from '../network/own-story-document'
import { ownStoryVideoPath } from '../media/own-story-video-document'
import { downloadOwnStoryVideo } from '../network/own-story-video'
import { channelMediaResponse } from '../media/channel-media-response'
import { storyMediaKey, type StoryMediaCache } from './story-media-cache'
import { mediaCacheFor } from './media-cache'
import { recordStoryStep } from '../platform/story-diagnostics'
import { tr } from '../../shared/i18n'
interface Selection { audioPath: string | null; audioBytes: Buffer | null; audioMime: string; request: OwnStoryVideoRequest; abort: AbortController; reader: FirestoreReader; token: string; path: string | null; watched: boolean; bytes: Buffer | null; mime: string; deadline: number }
export class OwnStoryVideo {
  private selected: Selection | null = null
  private value: OwnStoryVideoSnapshot | null = null
  private job: Promise<void> | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private closed = false
  constructor(private readonly uid: string, private readonly auth: ReadCredentials, private readonly source: (request: OwnStoryVideoRequest) => OwnStoryDetail, private readonly changed: () => void, private readonly options?: { prefix: '__contact-public-story-video' | '__contact-audience-story-video'; inspect(doc: FirestoreDocument): void; cache?: StoryMediaCache; address?: (request: OwnStoryVideoRequest) => { path: string | null; audioPath: string | null } }) {}
  private publish(): void { if (!this.closed) this.changed() }
  private validate(media: Selection, documentRequired = true): void {
    this.auth.signal.throwIfAborted(); media.abort.signal.throwIfAborted()
    if (this.closed || this.selected !== media || performance.now() >= media.deadline || (documentRequired && (!media.watched || !media.path || (media.request.mode === 'with-audio' && !media.audioPath)))) throw new Error('Story video lifetime changed')
    this.source(media.request)
  }
  get snapshot(): OwnStoryVideoSnapshot | null {
    try { if (this.value) this.source(this.value); if (this.selected) this.validate(this.selected, this.value?.status === 'ready') }
    catch { return null }
    return this.value ? { ...this.value } : null
  }
  clear(): void {
    const media = this.selected; this.selected = null
    media?.abort.abort(); media?.reader.close(); media?.bytes?.fill(0); media?.audioBytes?.fill(0)
    if (media) { media.audioBytes = null; media.audioPath = null; media.audioMime = ''; media.bytes = null; media.path = null; media.watched = false }
    if (this.timer) clearTimeout(this.timer); this.timer = null; this.value = null
  }
  prune(): void { try { if (this.value) this.source(this.value); if (this.selected) this.validate(this.selected, this.value?.status === 'ready') } catch { this.clear() } }
  dismiss(selectionId: string): void { if (this.value?.selectionId === selectionId) { this.clear(); this.publish() } }
  load(request: OwnStoryVideoRequest): Promise<void> {
    if (this.closed || this.job) throw new Error(tr('진행 중인 영상 읽기를 마친 뒤 다시 선택해 주세요.'))
    const source = this.source(request), lifetime = Math.min(10 * 60000, positionMilliseconds(source.expires) - Date.now())
    if (source.mediaType !== 'video' || source.audio !== (request.mode === 'with-audio' ? 'attached' : 'none') || lifetime <= 0) throw new Error(tr('현재 만료되지 않은 영상 스토리를 선택해 주세요.'))
    this.clear()
    const media: Selection = { audioPath: null, audioBytes: null, audioMime: '', request: { ...request }, abort: new AbortController(), reader: new FirestoreReader(this.auth), token: randomUUID(), path: null, watched: false, bytes: null, mime: '', deadline: performance.now() + lifetime }
    this.selected = media; this.value = { ...request, status: 'loading', audioUrl: null, url: null, loaded: 0, total: null, message: tr('현재 스토리와 영상 권한을 확인하고 있습니다.') }
    this.timer = setTimeout(() => { if (this.selected === media) { this.clear(); this.publish() } }, lifetime)
    const signal = AbortSignal.any([this.auth.signal, media.abort.signal, AbortSignal.timeout(45000)])
    const task = this.shown(media, source) ? Promise.resolve() : this.download(media, signal).catch(error => {
      recordStoryStep('video-failed', error instanceof Error ? error.message : '')
      if (this.selected !== media) return
      this.clear(); this.value = { ...request, status: 'error', audioUrl: null, url: null, loaded: 0, total: null, message: tr('영상의 현재 문서·권한·형식·크기를 확인하지 못했습니다. 스토리 목록을 다시 읽은 뒤 열어 주세요.') }
    }).finally(() => { if (this.job === task) this.job = null; this.publish() })
    this.job = task; this.publish(); return task
  }
  private cacheKey(request: OwnStoryVideoRequest, source: OwnStoryDetail): string {
    return storyMediaKey(this.uid, request.storyId, request.version, `video:${request.mode}:${source.privacy}`)
  }
  // Media::Stories::Controller preloads the stories around this one; one that is already here plays at
  // once, without reading the story again or downloading it a second time.
  private shown(media: Selection, source: OwnStoryDetail): boolean {
    const held = this.options?.cache?.take(this.cacheKey(media.request, source))
    if (!held) return false
    if ((media.request.mode === 'with-audio') !== Boolean(held.audioBytes)) { held.bytes.fill(0); held.audioBytes?.fill(0); return false }
    media.bytes = held.bytes; media.mime = held.mime; media.audioBytes = held.audioBytes; media.audioMime = held.audioMime
    media.watched = true; media.path = 'preloaded'; media.audioPath = held.audioBytes ? 'preloaded' : null
    const total = held.bytes.length + (held.audioBytes?.length ?? 0)
    this.value = { ...media.request, status: 'ready', url: `morse://app/${this.options?.prefix ?? '__own-story-video'}/${media.token}`,
      audioUrl: held.audioBytes ? `morse://app/${this.options?.prefix ?? '__own-story-video'}-audio/${media.token}` : null, loaded: total, total, message: '' }
    return true
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
      const cancel = (): void => finish(new Error('Story video acquisition cancelled'))
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
            if (current.version !== media.request.version || current.mediaType !== 'video' || current.audio !== (media.request.mode === 'with-audio' ? 'attached' : 'none') || positionMilliseconds(current.expires) <= Date.now()) throw new Error('Story changed or expired')
            const videoPath = ownStoryVideoPath(doc, this.uid), audioPath = media.request.mode === 'with-audio' ? ownStoryAudioPath(doc, this.uid) : null
            if (audioPath === videoPath || (media.path && media.path !== videoPath) || (media.audioPath && media.audioPath !== audioPath)) throw new Error('Story media sources changed')
            media.path = videoPath; media.audioPath = audioPath; media.watched = true; finish()
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
    // The list already named where this video and its sound live, as stories.getPeerStories does for
    // Telegram; the story is read again only when the list cannot say.
    const named = this.options?.address?.(media.request)
    const paired = media.request.mode === 'with-audio'
    const ready = named?.path && (!paired || named.audioPath) && named.path !== named.audioPath
    if (ready) { media.path = named!.path; media.audioPath = paired ? named!.audioPath : null; media.watched = true }
    const path = ready ? media.path! : await this.observe(media, signal)
    signal.throwIfAborted(); this.validate(media)
    const abort = new AbortController(), bounded = AbortSignal.any([signal, abort.signal])
    const progress = { videoLoaded: 0, videoTotal: null as number | null, audioLoaded: 0, audioTotal: paired ? null as number | null : 0 }
    const update = (kind: 'video' | 'audio', loaded: number, total: number): void => {
      this.validate(media)
      if (kind === 'video') { progress.videoLoaded = loaded; progress.videoTotal = total } else { progress.audioLoaded = loaded; progress.audioTotal = total }
      if (this.value?.selectionId === media.request.selectionId) {
        this.value.loaded = progress.videoLoaded + progress.audioLoaded
        this.value.total = progress.videoTotal === null || progress.audioTotal === null ? null : progress.videoTotal + progress.audioTotal
        this.publish()
      }
    }
    // FileLoader::start() asks tryLoadLocal() first: a video this account already fetched is played from
    // the account's own cache file, with no grant, no metadata read and no download.
    const files = mediaCacheFor(this.auth), stored = await files?.read(path, 50 * 1024 * 1024 - 1)
    signal.throwIfAborted(); this.validate(media)
    const [video, audio] = await Promise.allSettled([
      stored ? Promise.resolve(stored) : downloadOwnStoryVideo(this.auth, path, media.request.storyId, this.uid, bounded, () => this.validate(media), 50 * 1024 * 1024 - 1, (loaded, total) => update('video', loaded, total)).then(bytes => { files?.write(path, bytes); return bytes }).catch(error => { abort.abort(); throw error }),
      paired ? downloadOwnStoryAudio(this.auth, media.audioPath!, media.request.storyId, this.uid, bounded, () => this.validate(media), 15 * 1024 * 1024 - 1, (loaded, total) => update('audio', loaded, total)).catch(error => { abort.abort(); throw error }) : Promise.resolve(null)
    ] as const)
    if (video.status === 'rejected' || audio.status === 'rejected') {
      if (video.status === 'fulfilled') video.value.fill(0)
      if (audio.status === 'fulfilled') audio.value?.bytes.fill(0)
      throw new Error('Story media preparation incomplete')
    }
    const downloaded = video.value, soundtrack = audio.value
    try {
      signal.throwIfAborted(); this.validate(media)
      const type = mediaType(downloaded)
      if (type.kind !== 'video' || (paired && !soundtrack)) throw new Error('Unsupported story media')
      media.mime = type.contentType; media.bytes = downloaded; media.audioBytes = soundtrack?.bytes ?? null; media.audioMime = soundtrack?.mime ?? ''
      this.options?.cache?.keep(this.cacheKey(media.request, this.source(media.request)), { bytes: Buffer.from(downloaded), mime: type.contentType, audioBytes: soundtrack ? Buffer.from(soundtrack.bytes) : null, audioMime: soundtrack?.mime ?? '' })
      const total = downloaded.length + (soundtrack?.bytes.length ?? 0)
      this.value = { ...media.request, status: 'ready', url: `morse://app/${this.options?.prefix ?? '__own-story-video'}/${media.token}`, audioUrl: soundtrack ? `morse://app/${this.options?.prefix ?? '__own-story-video'}-audio/${media.token}` : null, loaded: total, total, message: '' }
    } catch (error) { downloaded.fill(0); soundtrack?.bytes.fill(0); throw error }
  }
  response(token: string, request: Request, audio = false): Response {
    const media = this.selected
    try {
      const bytes = audio ? media?.audioBytes : media?.bytes
      if (!media || !bytes || media.token !== token || this.value?.status !== 'ready' || (audio && media.request.mode !== 'with-audio')) throw new Error('Unavailable story media')
      return channelMediaResponse(bytes, audio ? media.audioMime : media.mime, request, () => this.validate(media))
    } catch { return new Response(null, { status: 403 }) }
  }
  async close(): Promise<void> { this.closed = true; this.clear(); await this.job?.catch(() => {}) }
}
