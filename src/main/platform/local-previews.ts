import { randomUUID } from 'node:crypto'
import { mediaType } from '../media/media-type'
import { rangeResponse } from '../media/range-response'
import { tr } from '../../shared/i18n'

// B323-a·b (tdesktop draws a chosen picture or video from the prepared file itself): a picture or a video the window
// chose for a channel story or a sticker is shown from here. The page's policy allows no blob: images or media, so the
// copy the window made of its own showed nothing, and a video's first frame could not be taken from it. Only bytes that
// read as a picture or a video this app sends are held — never anything a page could run — and only until the window
// lets them go; the oldest go first past a few.
const maxEntries = 6, maxEntryBytes = 60 * 1024 * 1024, maxTotalBytes = 200 * 1024 * 1024
export const localPreviewRoute = '__local-preview'

export class LocalPreviews {
  private readonly entries = new Map<string, { bytes: Buffer; contentType: string }>()

  hold(raw: unknown): string {
    if (!(raw instanceof Uint8Array) || !raw.byteLength || raw.byteLength > maxEntryBytes) throw new Error(tr('사진 또는 MP4·MOV 동영상을 선택해 주세요.'))
    const bytes = Buffer.from(raw)
    let contentType: string
    try { contentType = mediaType(bytes).contentType } catch { bytes.fill(0); throw new Error(tr('사진 또는 MP4·MOV 동영상을 선택해 주세요.')) }
    const token = randomUUID()
    this.entries.set(token, { bytes, contentType })
    let total = 0
    for (const entry of this.entries.values()) total += entry.bytes.length
    for (const [key, entry] of this.entries) {
      if (this.entries.size <= maxEntries && total <= maxTotalBytes) break
      if (key === token) continue
      total -= entry.bytes.length; entry.bytes.fill(0); this.entries.delete(key)
    }
    return `morse://app/${localPreviewRoute}/${token}`
  }
  response(path: string, request: Request): Response {
    const entry = /^[0-9a-f-]{36}$/.test(path) ? this.entries.get(path) : undefined
    return entry ? rangeResponse(entry.bytes, entry.contentType, request) : new Response(null, { status: 403 })
  }
  release(url: unknown): void {
    const token = typeof url === 'string' ? url.slice(`morse://app/${localPreviewRoute}/`.length) : ''
    const entry = this.entries.get(token)
    if (!entry) return
    entry.bytes.fill(0); this.entries.delete(token)
  }
  clear(): void { for (const entry of this.entries.values()) entry.bytes.fill(0); this.entries.clear() }
}
