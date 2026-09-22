import { randomUUID } from 'node:crypto'
import { rangeResponse } from './range-response'
import { open, rename, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { MediaReady, MediaRequest } from '../../shared/media'
import type { ReadCredentials } from '../network/firestore-rpc'
import { safeFileName, type MediaResource } from './media-document'
import { restoreFile } from './compression'
import { downloadMedia, MediaFailure } from './download-media'
import { mediaCacheFor } from '../accounts/media-cache'
import { tr } from '../../shared/i18n'

interface OwnedMedia {
  chatId: string
  request: MediaRequest
  resource: MediaResource
  abort: AbortController
  token: string
  bytes: Buffer | null
  mime: string
  ready: MediaReady | null
}

function format(bytes: Buffer, resource: MediaResource): { mime: string; presentation: MediaReady['presentation']; extension: string } {
  const kind = resource.summary.kind
  if (kind === 'file') {
    return { mime: 'application/octet-stream', presentation: 'file', extension: '' }
  }
  if (kind === 'image' || kind === 'sticker') {
    if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { mime: 'image/png', presentation: 'image', extension: '.png' }
    if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return { mime: 'image/jpeg', presentation: 'image', extension: '.jpg' }
    if (['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'))) return { mime: 'image/gif', presentation: 'image', extension: '.gif' }
    if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return { mime: 'image/webp', presentation: 'image', extension: '.webp' }
  }
  if (['video', 'voice', 'sticker'].includes(kind) && bytes.length >= 16 && bytes.subarray(4, 8).toString('ascii') === 'ftyp') {
    const quicktime = bytes.subarray(8, 12).toString('ascii') === 'qt  '
    return kind === 'voice' ? { mime: 'audio/mp4', presentation: 'audio', extension: '.m4a' } :
      { mime: quicktime ? 'video/quicktime' : 'video/mp4', presentation: 'video', extension: quicktime ? '.mov' : '.mp4' }
  }
  throw new MediaFailure(tr('이 첨부 형식은 아직 Desktop에서 열 수 없습니다.'))
}

// A single explicit selection owns both the network request and its in-memory
// payload. No tokens, remote URLs or filesystem paths cross the preload bridge.
export class MediaSession {
  private selected: OwnedMedia | null = null
  private downloading: Promise<MediaReady> | null = null
  private saving = false
  private writing: Promise<boolean> | null = null
  private closed = false

  constructor(private readonly credentials: ReadCredentials,
    private readonly resolve: (chatId: string, request: MediaRequest) => MediaResource | null,
    private readonly progress: (requestId: string, loaded: number, total: number | null) => void) {}

  private current(owner: OwnedMedia): boolean {
    if (this.closed || this.credentials.signal.aborted || owner.abort.signal.aborted || this.selected !== owner) return false
    const resource = this.resolve(owner.chatId, owner.request)
    return resource?.path !== null && resource?.path === owner.resource.path && Boolean(resource?.summary.available)
  }
  private requireCurrent(owner: OwnedMedia): void {
    if (!this.current(owner)) throw new MediaFailure(tr('첨부가 닫혔거나 메시지가 변경되었습니다. 최신 메시지에서 다시 선택해 주세요.'))
  }
  prune(): void { if (this.selected && !this.current(this.selected)) this.clear() }
  clear(requestId?: string): void {
    if (!this.selected || (requestId && this.selected.request.requestId !== requestId)) return
    const owner = this.selected
    this.selected = null; owner.abort.abort(); owner.bytes?.fill(0); owner.bytes = null; owner.ready = null
  }
  async close(): Promise<void> {
    this.closed = true; this.clear()
    await this.downloading?.catch(() => {})
    await this.writing?.catch(() => {})
  }

  open(chatId: string, request: MediaRequest): Promise<MediaReady> {
    if (this.downloading) throw new MediaFailure(tr('이전 다운로드를 정리하고 있습니다. 잠시 후 다시 선택해 주세요.'))
    this.clear()
    const resource = this.resolve(chatId, request)
    if (this.closed || !resource?.summary.available || !resource.path) throw new MediaFailure(tr('현재 메시지에서 열 수 있는 첨부를 확인하지 못했습니다.'))
    const owner: OwnedMedia = { chatId, request, resource, abort: new AbortController(), token: randomUUID(), bytes: null, mime: '', ready: null }
    this.selected = owner
    const task = this.download(owner).then(result => { this.requireCurrent(owner); return result }).catch(error => {
      const cancelled = owner.abort.signal.aborted || this.credentials.signal.aborted
      if (this.selected === owner) this.clear()
      throw error instanceof MediaFailure ? error : new MediaFailure(cancelled ? tr('다운로드가 취소되었습니다.') : tr('첨부를 불러오지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.'))
    })
    this.downloading = task
    void task.finally(() => { if (this.downloading === task) this.downloading = null }).catch(() => {})
    return task
  }

  private async download(owner: OwnedMedia): Promise<MediaReady> {
    const signal = AbortSignal.any([owner.abort.signal, this.credentials.signal, AbortSignal.timeout(120000)])
    // FileLoader::tryLoadLocal(): an attachment already fetched is opened from the account's cache file, with no
    // request at all. A one-time-view attachment is never kept, so it is read and written only over the network.
    const cache = owner.resource.summary.blind ? null : mediaCacheFor(this.credentials)
    const path = owner.resource.path ?? ''
    const stored = await cache?.read(path)
    let bytes: Buffer | null = null
    if (stored) {
      if (!this.current(owner)) { stored.fill(0); this.requireCurrent(owner) }
      // A kept copy that no longer reads as this attachment is fetched again.
      if (owner.resource.summary.kind === 'file') bytes = stored
      else { try { format(stored, owner.resource); bytes = stored } catch { stored.fill(0) } }
      if (bytes) this.progress(owner.request.requestId, bytes.length, bytes.length)
    }
    if (!bytes) {
      bytes = await downloadMedia(this.credentials, owner.resource, signal, () => this.requireCurrent(owner),
        (loaded, total) => this.progress(owner.request.requestId, loaded, total))
      if (this.current(owner)) cache?.write(path, bytes)
    }
    if (!this.current(owner)) { bytes.fill(0); this.requireCurrent(owner) }
    owner.bytes = bytes
    this.requireCurrent(owner)
    if (owner.resource.summary.kind === 'file') {
      let restored: Buffer
      try { restored = await restoreFile(bytes, signal) } catch (error) { throw new MediaFailure(error instanceof Error ? error.message : tr('압축 파일을 복원하지 못했습니다.')) }
      if (!this.current(owner)) { restored.fill(0); this.requireCurrent(owner) }
      if (restored !== bytes) { bytes.fill(0); bytes = restored; owner.bytes = bytes }
    }
    const type = format(bytes, owner.resource)
    this.requireCurrent(owner)
    owner.mime = type.mime
    owner.ready = { requestId: owner.request.requestId, presentation: type.presentation,
      url: type.presentation === 'file' ? null : `morse://app/__media/${owner.token}`,
      name: safeFileName(owner.resource.summary.name + type.extension), size: bytes.length }
    return owner.ready
  }

  response(token: string, request: Request): Response {
    this.prune()
    const owner = this.selected
    if (!owner?.bytes || !owner.ready || owner.token !== token || !['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 403 })
    return rangeResponse(owner.bytes, owner.mime, request)
  }

  async save(requestId: string, choose: (name: string) => Promise<string | null>): Promise<boolean> {
    if (this.saving) throw new MediaFailure(tr('저장 위치를 선택 중입니다.'))
    const owner = this.selected
    if (!owner?.ready || !owner.bytes || owner.request.requestId !== requestId) throw new MediaFailure(tr('첨부를 먼저 열어 주세요.'))
    this.requireCurrent(owner); this.saving = true
    try {
      const destination = await choose(owner.ready.name)
      if (!destination) return false
      this.requireCurrent(owner)
      const task = this.write(owner, destination)
      this.writing = task
      try { return await task } finally { if (this.writing === task) this.writing = null }
    } catch (error) {
      throw error instanceof MediaFailure ? error : new MediaFailure(tr('파일을 저장하지 못했습니다. 저장 위치와 여유 공간을 확인해 주세요.'))
    } finally { this.saving = false }
  }

  private async write(owner: OwnedMedia, destination: string): Promise<boolean> {
    let temporary: string | null = null
    try {
      temporary = join(dirname(destination), `.morse-save-${randomUUID()}.part`)
      const file = await open(temporary, 'wx', 0o600)
      try {
        this.requireCurrent(owner)
        await file.writeFile(owner.bytes!, { signal: owner.abort.signal }); await file.sync()
      } finally { await file.close() }
      this.requireCurrent(owner)
      await rename(temporary, destination)
      temporary = null
      return true
    } finally {
      if (temporary) await unlink(temporary).catch(() => {})
    }
  }
}
