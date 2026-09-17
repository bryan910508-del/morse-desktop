import type { ProfileSnapshot } from '../../shared/profile'
import type { ReadCredentials } from '../network/firestore-rpc'
import { storageBucket } from '../media/media-document'
import { backgroundImageInfo } from '../../shared/background-photo-bytes'
import { photoAddressShape, recordAvatarStep } from '../platform/avatar-diagnostics'
import { tr } from '../../shared/i18n'
import { photoToken, userpicCacheFor, userpicURL } from './userpic-cache'
import { forgetImages, rememberedImage, rememberImage } from './userpic-images'

const limit = 10 * 1024 * 1024
// Row photos use the storage upload ceiling (10 MB). iOS stores uncropped profile photos
// above one megapixel (e.g. 990x1485), so the row limit follows the stored pictures.
export const avatarDisplayLimits = { maxBytes: 10 * 1024 * 1024, maxPixels: 16 * 1024 * 1024 }
interface Photo { raw: string; token: string; abort: AbortController; bytes: Buffer | null; mime: string }
export function clearProfilePhotoCache(): void { forgetImages() }
function pathFor(raw: string, uid: string): string | null {
  try {
    let path: string
    if (raw.startsWith(`gs://${storageBucket}/`)) path = raw.slice(storageBucket.length + 6)
    else {
      const url = new URL(raw), prefix = `/v0/b/${storageBucket}/o/`
      if (url.protocol !== 'https:' || url.hostname !== 'firebasestorage.googleapis.com' || url.port || url.username || url.password || !url.pathname.startsWith(prefix)) return null
      path = decodeURIComponent(url.pathname.slice(prefix.length))
    }
    const parts = path.split('/')
    return path.length <= 1024 && parts.length === 3 && parts[0] === 'profile_photos' && parts[1] === uid &&
      parts.every(part => part && part !== '.' && part !== '..' && !/[\x00-\x1f\x7f\\]/.test(part)) ? path : null
  } catch { return null }
}
function imageType(bytes: Buffer): string {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg'
  if (['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'))) return 'image/gif'
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  throw new Error(tr('지원하지 않는 프로필 사진 형식입니다.'))
}
export class ProfilePhoto {
  private selected: Photo | null = null
  private value: ProfileSnapshot['photo'] = { url: null, status: 'none', message: '' }
  constructor(private readonly uid: string, private readonly auth: ReadCredentials, private readonly changed: () => void,
    private readonly route: '__profile-photo' | '__contact-photo' | '__direct-avatar' | '__contact-avatar' | '__channel-person' = '__profile-photo',
    private readonly display?: { maxBytes: number; maxPixels: number; validate(): void }) {}
  private note(step: string, detail = ''): void {
    if (this.route === '__direct-avatar' || this.route === '__contact-avatar') recordAvatarStep(this.route === '__contact-avatar' ? 'contacts' : 'dialogs', this.uid, step, detail)
  }
  get snapshot(): ProfileSnapshot['photo'] {
    try { this.display?.validate(); return { ...this.value } }
    catch { return { url: null, status: 'none', message: '' } }
  }
  clear(): void {
    const old = this.selected; this.selected = null; old?.abort.abort(); old?.bytes?.fill(0)
    this.value = { url: null, status: 'none', message: '' }
  }
  async select(raw: string): Promise<void> {
    this.display?.validate()
    if (this.selected?.raw === raw) return
    this.clear()
    if (!raw) return
    const path = pathFor(raw, this.uid)
    if (!path) { this.note('unsupported-photo-address', photoAddressShape(raw, this.uid)); this.value = { url: null, status: 'error', message: tr('이 프로필 사진을 Desktop에서 열 수 없습니다.') }; return }
    if (this.attach(raw)) { this.changed(); return }
    const owner: Photo = { raw, token: photoToken('picture', raw), abort: new AbortController(), bytes: null, mime: '' }
    this.selected = owner
    this.value = { url: null, status: 'loading', message: '' }
    // Storage::Cache: a picture fetched before this start comes from the account's cache file.
    const cache = userpicCacheFor(this.auth), stored = await cache?.read(raw, this.display?.maxBytes ?? limit)
    if (this.selected !== owner || owner.abort.signal.aborted) { stored?.bytes.fill(0); return }
    if (stored) {
      try { this.display?.validate() } catch { stored.bytes.fill(0); return }
      try {
        this.accept(owner, stored.bytes)
        this.note('photo-ready-cached')
        this.value = { url: userpicURL(owner.token), status: 'ready', message: '' }; this.changed()
        return
      } catch { owner.bytes = null; stored.bytes.fill(0) }
    }
    await this.download(owner, path).catch(error => {
      if (this.selected !== owner || owner.abort.signal.aborted) return
      this.note('download-failed', error instanceof Error ? error.message : 'unknown')
      owner.bytes?.fill(0); owner.bytes = null
      this.value = { url: null, status: 'error', message: tr('프로필 사진을 불러오지 못했습니다. 프로필을 새로고침해 주세요.') }; this.changed()
    })
  }
  // A picture already in memory is drawn in the same frame, without waiting for a read: Dialogs::Row paints the view
  // it holds. Returns false when this picture is not held, or is too large for this surface.
  attach(raw: string): boolean {
    try { this.display?.validate() } catch { return false }
    if (this.selected?.raw === raw && this.value.status === 'ready') return true
    const held = raw ? rememberedImage(raw, this.display ?? { maxBytes: limit, maxPixels: Number.POSITIVE_INFINITY }) : null
    if (!held) return false
    this.clear()
    const owner: Photo = { raw, token: photoToken('picture', raw), abort: new AbortController(), bytes: held.bytes, mime: held.mime }
    this.selected = owner
    this.value = { url: userpicURL(owner.token), status: 'ready', message: '' }
    return true
  }
  private async download(owner: Photo, path: string): Promise<void> {
    const signal = AbortSignal.any([owner.abort.signal, this.auth.signal, AbortSignal.timeout(45000)])
    this.display?.validate()
    const authorization = await this.auth.authorize(signal, false)
    signal.throwIfAborted(); this.display?.validate()
    const response = await fetch(`https://firebasestorage.googleapis.com/v0/b/${storageBucket}/o/${encodeURIComponent(path)}?alt=media`, {
      signal, redirect: 'error', credentials: 'omit', cache: 'no-store',
      headers: { Authorization: `Firebase ${authorization.idToken}`, 'X-Firebase-AppCheck': authorization.appCheckToken }
    })
    const length = response.headers.get('content-length'), size = length === null ? null : Number(length)
    const bound = this.display ? this.display.maxBytes + 1 : limit
    if (!response.ok || !response.body || (size !== null && (!Number.isSafeInteger(size) || size <= 0 || size >= bound))) {
      await response.body?.cancel(); throw new Error(`Invalid profile image response status=${response.status} length=${length ?? 'none'}`)
    }
    const reader = response.body.getReader(), chunks: Buffer[] = []
    let total = 0
    try {
      while (true) {
        const chunk = await reader.read(); signal.throwIfAborted(); this.display?.validate()
        if (this.selected !== owner) throw new Error('Profile changed')
        if (chunk.done) break
        total += chunk.value.byteLength
        if (total >= bound) throw new Error('Profile image too large')
        chunks.push(Buffer.from(chunk.value))
      }
      if (!total || (size !== null && total !== size)) throw new Error('Incomplete profile image')
      const joined = Buffer.concat(chunks, total)
      try { this.accept(owner, joined) } catch (error) { joined.fill(0); throw error }
      signal.throwIfAborted(); this.display?.validate()
      this.note('photo-ready')
      userpicCacheFor(this.auth)?.write(owner.raw, owner.bytes!, owner.mime)
      this.value = { url: userpicURL(owner.token), status: 'ready', message: '' }; this.changed()
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); for (const chunk of chunks) chunk.fill(0) }
  }
  // The picture passes the same format and size checks whether it was downloaded or read from the cache file.
  private accept(owner: Photo, bytes: Buffer): void {
    let mime: string
    if (this.display) {
      const info = backgroundImageInfo(bytes)
      if (bytes.length > this.display.maxBytes || info.width * info.height > this.display.maxPixels) throw new Error(`Profile avatar dimensions too large ${info.width}x${info.height}`)
      mime = info.type
    } else mime = imageType(bytes)
    owner.bytes = bytes; owner.mime = mime
    rememberImage(owner.raw, bytes, mime)
  }
  response(token: string, request: Request): Response {
    try { this.display?.validate() } catch { return new Response(null, { status: 403 }) }
    const owner = this.selected
    if (!owner?.bytes || owner.token !== token || this.value.status !== 'ready' || !['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 403 })
    return new Response(request.method === 'HEAD' ? null : new Uint8Array(owner.bytes), { headers: {
      'Content-Type': owner.mime, 'Content-Length': String(owner.bytes.length), 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox"
    } })
  }
}
