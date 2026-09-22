import { randomUUID } from 'node:crypto'
import type { ChannelPostMediaRequest, ChannelPostMediaSnapshot } from '../../shared/channel-post-media'
import { backgroundImageInfo } from '../../shared/background-photo-bytes'
import type { ReadCredentials } from '../network/firestore-rpc'
import { downloadChannelPostMedia } from '../network/channel-post-media'
import { mediaType } from '../media/media-type'
import { channelMediaResponse } from '../media/channel-media-response'
import { mediaCacheFor } from './media-cache'
import { tr } from '../../shared/i18n'

interface Selection { request: ChannelPostMediaRequest; path: string; abort: AbortController; token: string; bytes: Buffer | null; mime: string; deadline: number }
export class ChannelPostMediaSession {
  private selected: Selection | null = null
  private value: ChannelPostMediaSnapshot | null = null
  private job: Promise<void> | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  constructor(private readonly auth: ReadCredentials, private readonly source: (request: ChannelPostMediaRequest) => string,
    private readonly changed: () => void, private readonly route: '__channel-post-media' | '__public-channel-post-media' = '__channel-post-media') {}
  get snapshot(): ChannelPostMediaSnapshot | null {
    if (this.selected) { try { this.validate(this.selected) } catch { return null } }
    return this.value ? { ...this.value } : null
  }
  private validate(media: Selection): void {
    this.auth.signal.throwIfAborted(); media.abort.signal.throwIfAborted()
    if (this.selected !== media || performance.now() >= media.deadline || this.source(media.request) !== media.path) throw new Error('Channel media selection changed')
  }
  clear(): void {
    const media = this.selected; this.selected = null; media?.abort.abort(); media?.bytes?.fill(0)
    if (media) media.bytes = null
    if (this.timer) clearTimeout(this.timer)
    this.timer = null; this.value = null
  }
  prune(): void { if (this.selected) { try { this.validate(this.selected) } catch { this.clear() } } }
  dismiss(selectionId: string): void { if (this.value?.selectionId === selectionId) { this.clear(); this.changed() } }
  async load(request: ChannelPostMediaRequest): Promise<void> {
    if (this.job) throw new Error(tr('진행 중인 미디어 읽기를 마친 뒤 다시 선택해 주세요.'))
    const path = this.source(request), lifetime = request.presentation === 'video' ? 10 * 60000 : 60000
    this.clear()
    const media: Selection = { request: { ...request }, path, abort: new AbortController(), token: randomUUID(), bytes: null, mime: '', deadline: performance.now() + lifetime }
    this.selected = media; this.value = { ...request, status: 'loading', url: null, message: '', loaded: 0, total: null }
    this.timer = setTimeout(() => { if (this.selected === media) { this.clear(); this.changed() } }, lifetime)
    // Acquisition finishes inside the existing short-lived remote grant. Local
    // playback owns already downloaded authorized bytes and still checks the post.
    const signal = AbortSignal.any([this.auth.signal, media.abort.signal, AbortSignal.timeout(45000)])
    const task = this.download(media, signal).catch(() => {
      if (this.selected !== media || media.abort.signal.aborted) return
      media.bytes?.fill(0); media.bytes = null
      this.value = { ...request, status: 'error', url: null, loaded: 0, total: null,
        message: tr('미디어를 읽지 못했습니다. 연결·접근 권한과 지원 형식·크기를 확인한 뒤 다시 열어 주세요.') }
    }).finally(() => { if (this.job === task) this.job = null; this.changed() })
    this.job = task; this.changed(); await task
  }
  private async download(media: Selection, signal: AbortSignal): Promise<void> {
    const video = media.request.presentation === 'video', maxBytes = video ? 50 * 1024 * 1024 - 1 : 8 * 1024 * 1024
    // FileLoader::start() asks tryLoadLocal() first: media this account already fetched is shown from the account's
    // cache file, with no grant, no metadata read and no download. Opening the same post picture or video again is
    // then immediate, as it is in Telegram.
    const cache = mediaCacheFor(this.auth), stored = await cache?.read(media.path, maxBytes)
    if (stored) {
      try { signal.throwIfAborted(); this.validate(media) } catch (error) { stored.fill(0); throw error }
      try { this.accept(media, stored, video); return } catch { stored.fill(0) /* An unusable copy is fetched again. */ }
    }
    const downloaded = await downloadChannelPostMedia(this.auth, media.path, media.request.postId, signal, () => this.validate(media), maxBytes, (loaded, total) => {
      this.validate(media)
      if (this.value?.selectionId === media.request.selectionId) { this.value.loaded = loaded; this.value.total = total; this.changed() }
    })
    try {
      signal.throwIfAborted(); this.validate(media)
      this.accept(media, downloaded, video)
      cache?.write(media.path, downloaded)
    } catch (error) { downloaded.fill(0); throw error }
  }
  // The same format and size checks whether the bytes were downloaded or read from the cache file.
  private accept(media: Selection, bytes: Buffer, video: boolean): void {
    if (video) {
      const type = mediaType(bytes)
      if (type.kind !== 'video') throw new Error('Unsupported channel video container')
      media.mime = type.contentType
    } else {
      const info = backgroundImageInfo(bytes)
      if (info.width * info.height > 8 * 1024 * 1024) throw new Error('Channel image dimensions too large')
      media.mime = info.type
    }
    media.bytes = bytes
    this.value = { ...media.request, status: 'ready', url: `morse://app/${this.route}/${media.token}`, message: '', loaded: bytes.length, total: bytes.length }
  }
  response(token: string, request: Request): Response {
    const media = this.selected
    try {
      if (!media?.bytes || media.token !== token || this.value?.status !== 'ready') throw new Error('Unavailable media')
      return channelMediaResponse(media.bytes, media.mime, request, () => this.validate(media))
    } catch { return new Response(null, { status: 403 }) }
  }
}
