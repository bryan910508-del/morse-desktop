import type { GroupPhotoImage, GroupPhotoRequest } from '../../shared/group-photo'
import type { FirestoreDocument } from '../network/firestore-values'
import type { ReadCredentials } from '../network/firestore-rpc'
import { storageBucket } from '../media/media-document'
import { backgroundImageInfo } from '../../shared/background-photo-bytes'
import { photoAddressShape, recordAvatarStep } from '../platform/avatar-diagnostics'
import { tr } from '../../shared/i18n'
import { photoToken, userpicCacheFor, userpicURL } from './userpic-cache'
import { rememberedImage, rememberImage } from './userpic-images'

export function groupPhotoFields(doc: FirestoreDocument): { hasPhoto: boolean; raw: string | null; channelId: string | null } {
  const primary = doc.fields.photoURL, cached = doc.fields.cachedPhotoURL
  const hasPhoto = [primary, cached].some(value => value !== undefined && value.stringValue !== '')
  const value = primary !== undefined && primary.stringValue !== '' ? primary.stringValue : cached?.stringValue ?? ''
  // A channel discussion group is created with the channel's own photo address (server
  // ensureDiscussionChat), which lives under the channel's storage folder, not the group's.
  const discussion = doc.fields.isChannelDiscussion?.booleanValue === true
  const channel = doc.fields.channelId?.stringValue
  return { hasPhoto, raw: typeof value === 'string' && value.length <= 10000 ? value : null,
    channelId: discussion && typeof channel === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(channel) ? channel : null }
}
export function groupPhotoStoragePath(raw: string, chatId: string, uid: string, channelId: string | null = null): string | null {
  try {
    let path: string
    if (raw.startsWith(`gs://${storageBucket}/`)) path = raw.slice(storageBucket.length + 6)
    else {
      const url = new URL(raw), prefix = `/v0/b/${storageBucket}/o/`
      if (url.protocol !== 'https:' || url.hostname !== 'firebasestorage.googleapis.com' || url.port || url.username || url.password || url.hash || !url.pathname.startsWith(prefix)) return null
      path = decodeURIComponent(url.pathname.slice(prefix.length))
    }
    const parts = path.split('/')
    // Creation drafts are readable only by their owner under the existing rules.
    // Download-token query parameters are never used to bypass those rules.
    // channel_photos and the legacy channels folder are publicly readable (storage.rules), which is
    // how ChatListView shows a discussion row's picture; only this room's own channel is accepted.
    const channel = channelId !== null && ['channel_photos', 'channels'].includes(parts[0] ?? '') && parts[1] === channelId
    const scope = channel || (parts[0] === 'group_photos' && parts[1] === chatId) || (parts[0] === 'group_photos_draft' && parts[1] === uid)
    return path.length <= 1024 && parts.length === 3 && scope && parts.every(part => part && part !== '.' && part !== '..' && !/[\x00-\x1f\x7f\\]/.test(part)) ? path : null
  } catch { return null }
}
interface Photo { request: GroupPhotoRequest; raw: string; token: string; abort: AbortController; bytes: Buffer | null; mime: string }
const empty = (): GroupPhotoImage => ({ status: 'idle', url: null, message: '' })
export class GroupPhoto {
  private selected: Photo | null = null
  private job: Promise<void> | null = null
  private closed = false
  private value: GroupPhotoImage = empty()
  constructor(private readonly uid: string, private readonly auth: ReadCredentials,
    private readonly source: (request: GroupPhotoRequest, exact: boolean) => FirestoreDocument, private readonly changed: () => void,
    private readonly display?: { maxBytes: number; maxPixels: number }) {}
  get snapshot(): GroupPhotoImage {
    if (this.selected) { try { this.validate(this.selected) } catch { return empty() } }
    return { ...this.value }
  }
  clear(): void {
    const previous = this.selected; this.selected = null; previous?.abort.abort(); previous?.bytes?.fill(0)
    this.value = empty()
  }
  prune(): void { if (this.selected) { try { this.validate(this.selected) } catch { this.clear() } } }
  private validate(photo: Photo): void {
    if (this.closed || this.selected !== photo) throw new Error(tr('사진 선택이 변경되었습니다.'))
    this.auth.signal.throwIfAborted(); photo.abort.signal.throwIfAborted()
    if (groupPhotoFields(this.source(photo.request, false)).raw !== photo.raw) throw new Error(tr('그룹 사진이 변경되었습니다.'))
  }
  // A picture already in memory is drawn in the same frame, as Dialogs::Row paints the view it holds.
  attach(request: GroupPhotoRequest): boolean {
    if (this.closed || this.job) return false
    let raw: string | null
    try { raw = groupPhotoFields(this.source(request, false)).raw } catch { return false }
    if (!raw) return false
    if (this.selected?.raw === raw && this.value.status === 'ready') return true
    const held = rememberedImage(raw, this.display)
    if (!held) return false
    this.clear()
    this.selected = { request: { ...request }, raw, token: photoToken('picture', raw), abort: new AbortController(), bytes: held.bytes, mime: held.mime }
    this.value = { status: 'ready', url: userpicURL(this.selected.token), message: '' }
    return true
  }
  async load(request: GroupPhotoRequest): Promise<void> {
    if (this.closed || this.job) throw new Error(tr('진행 중인 사진 읽기를 마친 뒤 다시 선택해 주세요.'))
    const { raw, hasPhoto, channelId } = groupPhotoFields(this.source(request, true))
    this.clear()
    if (!hasPhoto) { this.changed(); return }
    const path = raw ? groupPhotoStoragePath(raw, request.chatId, this.uid, channelId) : null
    if (!path || !raw) {
      if (this.display) recordAvatarStep('dialogs', request.chatId, 'group-photo-address-unsupported', raw ? photoAddressShape(raw, request.chatId) : 'empty')
      this.value = { status: 'error', url: null, message: tr('이 사진 경로나 형식은 Desktop에서 열 수 없습니다. 그룹 생성 시 임시 사진은 업로드한 계정의 접근 권한이 필요합니다.') }
      this.changed(); return
    }
    const photo: Photo = { request: { ...request }, raw, token: photoToken('picture', raw), abort: new AbortController(), bytes: null, mime: '' }
    this.selected = photo; this.value = { status: 'loading', url: null, message: '' }
    const task = this.download(photo, path).catch(error => {
      if (this.selected !== photo || photo.abort.signal.aborted) return
      if (this.display) recordAvatarStep('dialogs', request.chatId, 'group-download-failed', error instanceof Error ? error.message : 'unknown')
      photo.bytes?.fill(0); photo.bytes = null
      this.value = { status: 'error', url: null, message: tr('그룹 사진을 불러오지 못했습니다. 연결·접근 권한과 지원 형식을 확인한 뒤 다시 불러와 주세요.') }
    }).finally(() => { if (this.job === task) this.job = null; if (!this.closed) this.changed() })
    this.job = task; this.changed(); await task
  }
  private async download(photo: Photo, path: string): Promise<void> {
    const signal = AbortSignal.any([this.auth.signal, photo.abort.signal, AbortSignal.timeout(45000)])
    this.validate(photo)
    // Storage::Cache: a picture fetched before this start comes from the account's cache file.
    const cache = userpicCacheFor(this.auth), stored = await cache?.read(photo.raw, this.display ? this.display.maxBytes : 10 * 1024 * 1024)
    if (stored) {
      try { signal.throwIfAborted(); this.validate(photo) } catch (error) { stored.bytes.fill(0); throw error }
      try {
        this.accept(photo, stored.bytes)
        rememberImage(photo.raw, photo.bytes!, photo.mime)
        if (this.display) recordAvatarStep('dialogs', photo.request.chatId, 'group-photo-ready-cached')
        this.value = { status: 'ready', url: userpicURL(photo.token), message: '' }
        return
      } catch { stored.bytes.fill(0); photo.bytes = null }
    }
    const auth = await this.auth.authorize(signal, false)
    signal.throwIfAborted(); this.validate(photo)
    const response = await fetch(`https://firebasestorage.googleapis.com/v0/b/${storageBucket}/o/${encodeURIComponent(path)}?alt=media`, {
      signal, redirect: 'error', credentials: 'omit', cache: 'no-store',
      headers: { Authorization: `Firebase ${auth.idToken}`, 'X-Firebase-AppCheck': auth.appCheckToken }
    })
    const limit = this.display ? this.display.maxBytes + 1 : 10 * 1024 * 1024, header = response.headers.get('content-length'), size = header === null ? null : Number(header)
    if (!response.ok || !response.body || (size !== null && (!Number.isSafeInteger(size) || size <= 0 || size >= limit))) {
      await response.body?.cancel(); throw new Error('Invalid group image response')
    }
    const reader = response.body.getReader(), chunks: Buffer[] = []
    let total = 0
    try {
      while (true) {
        const part = await reader.read(); signal.throwIfAborted(); this.validate(photo)
        if (part.done) break
        total += part.value.byteLength
        if (total >= limit) throw new Error('Group image too large')
        chunks.push(Buffer.from(part.value))
      }
      if (!total || (size !== null && size !== total)) throw new Error('Incomplete group image')
      const joined = Buffer.concat(chunks, total)
      try { this.accept(photo, joined) } catch (error) { joined.fill(0); throw error }
      this.validate(photo); signal.throwIfAborted()
      if (this.display) recordAvatarStep('dialogs', photo.request.chatId, 'group-photo-ready')
      cache?.write(photo.raw, photo.bytes!, photo.mime); rememberImage(photo.raw, photo.bytes!, photo.mime)
      this.value = { status: 'ready', url: userpicURL(photo.token), message: '' }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); chunks.forEach(chunk => chunk.fill(0)) }
  }
  // Header dimensions bound browser decoding; no native image decoder runs here.
  private accept(photo: Photo, bytes: Buffer): void {
    const info = backgroundImageInfo(bytes)
    if (this.display && (bytes.length > this.display.maxBytes || info.width * info.height > this.display.maxPixels)) throw new Error(`Group avatar dimensions too large ${info.width}x${info.height}`)
    photo.bytes = bytes; photo.mime = info.type
  }
  response(token: string, request: Request): Response {
    const photo = this.selected
    try {
      if (!photo?.bytes || photo.token !== token || this.value.status !== 'ready' || !['GET', 'HEAD'].includes(request.method)) throw new Error('Unavailable photo')
      this.validate(photo)
      return new Response(request.method === 'HEAD' ? null : new Uint8Array(photo.bytes), { headers: {
        'Content-Type': photo.mime, 'Content-Length': String(photo.bytes.length), 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox"
      } })
    } catch { return new Response(null, { status: 403 }) }
  }
  async close(): Promise<void> { this.closed = true; this.clear(); await this.job?.catch(() => {}) }
}
