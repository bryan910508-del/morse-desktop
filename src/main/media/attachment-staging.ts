import { nativeImage } from 'electron'
import { randomUUID, createHash } from 'node:crypto'
import { open, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename } from 'node:path'
import { maxAlbumPhotos, type AttachmentDraft, type AttachmentFile, type AttachmentMode, type AttachmentDropMode, type VideoFacts } from '../../shared/uploads'
import { rangeResponse } from './range-response'
import { outgoingPhotoPlaceholder } from './outgoing-placeholder'
import { backgroundImageInfo } from '../../shared/background-photo-bytes'
import type { MediaSendWire } from '../../shared/model'
import type { UploadDescriptor } from '../storage/upload-protocol'
import { safeFileName } from './media-document'
import { mediaType } from './media-type'
import { tr } from '../../shared/i18n'
import { maxVideoSourceBytes, maxVideoUploadBytes, type VideoSendPreset } from '../../shared/photo-quality'

// iOS compresses a picked video before it goes out (VideoRecorderView.exportCompressedMP4). The main process sets the
// compressor where the Mac media helper is available; without one a video is sent as it is, under 50 MB.
export type VideoCompression = { status: 'ok'; bytes: Buffer } | { status: 'too-long' | 'failed' | 'unavailable' }
// Editor::VideoEditor: the part of the picked file to send and its quality, always cut again from the file itself.
// overlay: iOS VideoMarkupEditorView's drawing as a PNG at the video's upright size, laid over the whole part.
export interface VideoEdit { start: number; end: number; preset: VideoSendPreset; overlay?: Uint8Array }
export type VideoCompressor = (path: string, edit?: VideoEdit) => Promise<VideoCompression>
let videoCompressor: VideoCompressor | null = null
export function setVideoCompressor(value: VideoCompressor | null): void { videoCompressor = value }

// source: a video prepared by the compressor keeps where it came from, and the first prepared copy is what the
// editor plays, so a second edit still starts from the whole video.
interface VideoSource { path: string; size: number; mtimeMs: number; original: Buffer; contentType: string }
interface StagedPart { item: AttachmentFile; upload: UploadDescriptor; bytes: Buffer; extension: string; source?: VideoSource }
interface StagedAttachment { draft: AttachmentDraft; parts: StagedPart[] }
export interface TakenAttachment { kind: AttachmentFile['kind']; name: string; size: number; contentType: string; extension: string; bytes: Buffer }
export class AttachmentStaging {
  // A chat's selection is served on __draft-media; an inquiry keeps its own route, so neither can
  // answer for the other's selection.
  constructor(private readonly previewRoute = '__draft-media') {}
  private generation = 0
  private pending = false
  private selected: StagedAttachment | null = null
  private editing = false
  hasWork(chatId: string): boolean { return this.pending || this.selected?.draft.chatId === chatId }
  drop(chatId: string, paths: string[], mode: AttachmentDropMode, allowed: () => boolean): Promise<AttachmentDraft | null> {
    if (this.pending || this.selected) throw new Error(tr('현재 첨부를 보내거나 선택을 취소한 뒤 다시 놓아 주세요.'))
    if (mode === 'file' && paths.length !== 1) throw new Error(tr('일반 파일은 한 번에 한 개씩 놓아 주세요.'))
    return this.pick(chatId, mode === 'file' ? 'file' : paths.length > 1 ? 'album' : 'media', allowed, async () => paths)
  }
  clear(id?: string): void {
    if (id && this.selected?.draft.id !== id) return
    this.generation++
    for (const part of this.selected?.parts ?? []) { if (part.source && part.source.original !== part.bytes) part.source.original.fill(0); part.bytes.fill(0) }
    this.selected = null
  }
  prepare(uid: string, chatId: string, id: string, caption: string, itemIds: string[], video: VideoFacts | null = null, circular = false) {
    const attachment = this.selected
    if (attachment?.draft.id !== id || attachment.draft.chatId !== chatId) throw new Error(tr('첨부 선택이 해제되었습니다. 파일을 다시 선택해 주세요.'))
    if (!itemIds.length || itemIds.length > maxAlbumPhotos || new Set(itemIds).size !== itemIds.length) throw new Error(tr('사진 순서를 다시 확인해 주세요.'))
    const selected = itemIds.map(itemId => {
      const part = attachment.parts.find(part => part.item.id === itemId)
      if (!part) throw new Error(tr('첨부 선택이 변경되었습니다.'))
      return part
    })
    const first = selected[0]!
    if (selected.length > 1 && selected.some(part => part.item.kind !== 'image')) throw new Error(tr('사진만 묶어 보낼 수 있습니다.'))
    // iOS records a photo's pixel size with the message, and the bubble on either side uses it to
    // keep the picture's shape. A format this reader cannot measure simply travels without it.
    const sizes = first.item.kind === 'image' ? selected.map(part => {
      try { const info = backgroundImageInfo(new Uint8Array(part.bytes)); return { width: info.width, height: info.height } } catch { return null }
    }) : []
    const measured = sizes.length && sizes.every(Boolean) ? sizes as { width: number; height: number }[] : []
    // The placeholder the photo travels with, made by the ladder iOS and Android both walk
    // (outgoing-placeholder.ts). It follows the LONG side, so a tall photo is not shrunk twice over,
    // and a picture that cannot be read simply travels without one.
    const placeholder = first.item.kind !== 'image' ? '' : outgoingPhotoPlaceholder((side, quality) => {
      const image = nativeImage.createFromBuffer(first.bytes)
      const { width, height } = image.getSize()
      if (!width || !height) return null
      const fit = width >= height ? { width: Math.max(1, Math.min(width, side)) } : { height: Math.max(1, Math.min(height, side)) }
      return image.resize({ ...fit, quality: 'good' }).toJPEG(quality)
    })
    const wire: MediaSendWire = { id, chatId, senderId: uid, type: first.item.kind,
      text: first.item.kind === 'file' ? first.item.name : '', mediaUrl: '', isSilent: false, isEncrypted: false, protocolVersion: 3,
      ...(measured.length ? { mediaWidthPx: measured[0]!.width, mediaHeightPx: measured[0]!.height } : {}),
      ...(placeholder ? { thumbData: placeholder } : {}),
      // As iOS: the display size, the length in whole seconds, and the 160px placeholder.
      ...(first.item.kind === 'video' && video ? { videoWidthPx: video.width, videoHeightPx: video.height, videoDuration: Math.round(video.duration),
        ...(video.thumb ? { thumbData: video.thumb } : {}) } : {}),
      // A video message, which every client draws as a circle; its size must be a square.
      ...(first.item.kind === 'video' && circular && video && video.width === video.height ? { isCircleVideo: true as const } : {}),
      ...(measured.length > 1 ? { imageWidthsPx: measured.map(size => size.width), imageHeightsPx: measured.map(size => size.height) } : {}),
      ...(first.item.kind === 'file' ? { fileName: first.item.name, fileSize: first.item.size } :
        caption ? first.item.kind === 'image' ? { imageCaption: caption } : { videoCaption: caption } : {}) }
    // Freeze a copy before the async storage boundary. Closing a view may clear
    // the staging buffers while the worker is committing the explicit send.
    const parts = selected.map((part, index) => ({ upload: { ...part.upload,
      path: `${part.item.kind === 'file' ? 'chat_files' : part.item.kind === 'video' ? 'chat_videos' : 'chat_media'}/${chatId}/${id}${selected.length > 1 ? `_${index}` : ''}.${part.extension}` }, bytes: Buffer.from(part.bytes) }))
    return { wire, parts }
  }
  // iOS sends a photo at its chosen quality (PhotoSendQuality): the window re-encodes the staged picture, turned
  // upright, and hands back a JPEG that takes the original's place before the send.
  replaceImage(chatId: string, id: string, itemId: string, raw: Uint8Array): AttachmentDraft {
    const selected = this.selected
    const part = selected && selected.draft.chatId === chatId && selected.draft.id === id ? selected.parts.find(value => value.item.id === itemId) : undefined
    if (!selected || !part || part.item.kind !== 'image') throw new Error(tr('첨부 선택이 해제되었습니다. 파일을 다시 선택해 주세요.'))
    const bytes = Buffer.from(raw)
    try {
      const type = mediaType(bytes)
      if (type.contentType !== 'image/jpeg' || !bytes.length || bytes.length >= 10 * 1024 * 1024) throw new Error(tr('준비한 사진을 확인하지 못했습니다.'))
      part.bytes.fill(0)
      part.bytes = bytes; part.extension = 'jpg'; part.item.size = bytes.length
      part.upload = { ...part.upload, size: bytes.length, contentType: 'image/jpeg', sha256: createHash('sha256').update(bytes).digest('hex'), md5: createHash('md5').update(bytes).digest('base64') }
      selected.draft = { ...selected.draft, size: selected.parts.reduce((sum, value) => sum + value.item.size, 0), items: selected.draft.items.map(item => item.id === itemId ? { ...item, size: bytes.length } : item) }
      return selected.draft
    } catch (error) { bytes.fill(0); throw error }
  }
  // Editor::VideoEditor → the chosen part of the picked file, at the chosen quality, replaces what is staged. The file
  // must still be the one that was picked.
  async editVideo(chatId: string, id: string, itemId: string, edit: VideoEdit, allowed: () => boolean): Promise<AttachmentDraft> {
    const selected = this.selected, generation = this.generation
    const part = selected && selected.draft.chatId === chatId && selected.draft.id === id ? selected.parts.find(value => value.item.id === itemId) : undefined
    const source = part?.source
    if (!selected || !part || part.item.kind !== 'video' || !source || !videoCompressor) throw new Error(tr('첨부 선택이 해제되었습니다. 파일을 다시 선택해 주세요.'))
    if (this.editing) throw new Error(tr('동영상을 준비하는 중입니다.'))
    this.editing = true
    try {
      const now = await stat(source.path).catch(() => null)
      if (!now?.isFile() || now.size !== source.size || now.mtimeMs !== source.mtimeMs) throw new Error(tr('원본 동영상이 바뀌었거나 옮겨졌습니다. 동영상을 다시 선택해 주세요.'))
      const result = await videoCompressor(source.path, edit)
      if (generation !== this.generation || this.selected !== selected || !allowed()) {
        if (result.status === 'ok') result.bytes.fill(0)
        throw new Error(tr('첨부 선택이 취소되었습니다.'))
      }
      if (result.status !== 'ok') throw new Error(result.status === 'too-long' ? tr('11분 이하의 동영상을 선택해 주세요.') : tr('동영상을 편집하지 못했습니다.'))
      const bytes = result.bytes
      if (bytes.length >= maxVideoUploadBytes) { bytes.fill(0); throw new Error(tr('편집한 동영상이 50 MB를 넘습니다. 더 짧게 자르거나 화질을 낮춰 주세요.')) }
      if (part.bytes !== source.original) part.bytes.fill(0)
      part.bytes = bytes; part.extension = 'mp4'; part.item.size = bytes.length
      part.upload = { ...part.upload, size: bytes.length, contentType: 'video/mp4', sha256: createHash('sha256').update(bytes).digest('hex'), md5: createHash('md5').update(bytes).digest('base64') }
      selected.draft = { ...selected.draft, size: selected.parts.reduce((sum, value) => sum + value.item.size, 0), items: selected.draft.items.map(item => item.id === itemId ? { ...item, size: bytes.length } : item) }
      return selected.draft
    } finally { this.editing = false }
  }
  // A picture copied from a page or another app has no file on disk to point at: HistoryWidget::canSendFiles accepts
  // what the clipboard itself holds (data->hasImage()) and sends it through the same box a dropped file uses. The bytes
  // become the selection here, the way a recorded video message does.
  receive(chatId: string, items: { name: string; bytes: Uint8Array }[], allowed: () => boolean): AttachmentDraft {
    if (this.pending || this.selected) throw new Error(tr('현재 첨부를 보내거나 선택을 취소한 뒤 다시 붙여넣어 주세요.'))
    if (!items.length || items.length > maxAlbumPhotos) throw new Error(tr('사진은 최대 {0}장까지 선택해 주세요.', [maxAlbumPhotos]))
    if (!allowed()) throw new Error(tr('대화와 연결을 확인해 주세요.'))
    this.clear()
    const id = randomUUID(), parts: StagedPart[] = []
    let retained = false
    try {
      for (const entry of items) {
        const bytes = Buffer.from(entry.bytes)
        try {
          // mediaType refuses anything that is not a picture or a video this app sends as one.
          const type = mediaType(bytes)
          if (items.length > 1 && type.kind !== 'image') throw new Error(tr('사진만 묶어 보낼 수 있습니다.'))
          if (type.kind === 'image' && bytes.length >= 10 * 1024 * 1024) throw new Error(tr('사진은 10 MB 미만으로 첨부해 주세요.'))
          if (type.kind === 'video' && bytes.length >= maxVideoUploadBytes) throw new Error(tr('50 MB 미만의 동영상을 붙여넣어 주세요.'))
          const item: AttachmentFile = { id: randomUUID(), name: safeFileName(entry.name || `${tr('사진')}.${type.extension}`), kind: type.kind, size: bytes.length }
          parts.push({ item, bytes, extension: type.extension, upload: { ...item, id, chatId, contentType: type.contentType, path: '',
            sha256: createHash('sha256').update(bytes).digest('hex'), md5: createHash('md5').update(bytes).digest('base64'), session: null } })
        } catch (error) { bytes.fill(0); throw error }
      }
      const draft: AttachmentDraft = { id, chatId, name: parts.length > 1 ? tr('사진 {0}장', [parts.length]) : parts[0]!.item.name,
        kind: parts[0]!.item.kind, size: parts.reduce((sum, part) => sum + part.item.size, 0),
        items: parts.map(part => ({ ...part.item, previewUrl: `morse://app/${this.previewRoute}/${id}/${part.item.id}` })) }
      this.selected = { draft, parts }; retained = true
      return draft
    } finally { if (!retained) for (const part of parts) part.bytes.fill(0) }
  }
  // A video message recorded in the window arrives as bytes, not a path: it becomes the selection itself.
  adopt(chatId: string, raw: Uint8Array, name: string): AttachmentDraft {
    if (this.pending || this.selected) throw new Error(tr('현재 첨부를 보내거나 선택을 취소한 뒤 다시 녹화해 주세요.'))
    const bytes = Buffer.from(raw)
    let retained = false
    try {
      const type = mediaType(bytes)
      if (type.kind !== 'video' || !bytes.length || bytes.length >= 50 * 1024 * 1024) throw new Error(tr('녹화한 영상 메시지의 형식이나 크기를 확인해 주세요.'))
      this.clear()
      const id = randomUUID(), item: AttachmentFile = { id: randomUUID(), name: safeFileName(name), kind: 'video', size: bytes.length }
      const part: StagedPart = { item, bytes, extension: type.extension, upload: { ...item, id, chatId, contentType: type.contentType, path: '',
        sha256: createHash('sha256').update(bytes).digest('hex'), md5: createHash('md5').update(bytes).digest('base64'), session: null } }
      const draft: AttachmentDraft = { id, chatId, name: item.name, kind: 'video', size: item.size, items: [{ ...item }] }
      this.selected = { draft, parts: [part] }; retained = true
      return draft
    } finally { if (!retained) bytes.fill(0) }
  }
  // One staged file, copied before an asynchronous send: closing the view may clear the selection.
  take(chatId: string, id: string, itemId: string): TakenAttachment | null {
    const selected = this.selected
    const part = selected && selected.draft.chatId === chatId && selected.draft.id === id ? selected.parts.find(value => value.item.id === itemId) : undefined
    return part ? { kind: part.item.kind, name: part.item.name, size: part.item.size, contentType: part.upload.contentType, extension: part.extension, bytes: Buffer.from(part.bytes) } : null
  }
  response(chatId: string, path: string, request: Request): Response {
    const keys = path.split('/'), [id, itemId] = keys
    const selected = this.selected
    const part = selected && selected.draft.chatId === chatId && selected.draft.id === id && keys.length === 2
      ? selected.parts.find(part => part.item.id === itemId && (part.item.kind === 'image' || part.item.kind === 'video')) : undefined
    if (part?.item.kind === 'video') return rangeResponse(part.bytes, part.upload.contentType, request)
    const original = selected && selected.draft.chatId === chatId && selected.draft.id === id && keys.length === 3 && keys[2] === 'original'
      ? selected.parts.find(part => part.item.id === itemId && part.item.kind === 'video')?.source : undefined
    if (original) return rangeResponse(original.original, original.contentType, request)
    if (request.method !== 'GET' || !part) return new Response(null, { status: 403 })
    return new Response(new Uint8Array(part.bytes), { headers: { 'Content-Type': part.upload.contentType,
      'Content-Length': String(part.bytes.length), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })
  }
  async pick(chatId: string, mode: AttachmentMode, allowed: () => boolean, choose: () => Promise<string[] | null>): Promise<AttachmentDraft | null> {
    if (this.pending) throw new Error(tr('파일을 선택 중입니다.'))
    this.clear(); this.pending = true
    const generation = this.generation, id = randomUUID(), parts: StagedPart[] = []
    let bytes: Buffer | null = null, retained = false
    try {
      if (!allowed()) throw new Error(tr('대화와 연결을 확인해 주세요.'))
      const paths = await choose()
      if (!paths?.length) return null
      if (paths.length > (mode === 'album' ? maxAlbumPhotos : 1)) throw new Error(tr('사진은 최대 {0}장까지 선택해 주세요.', [maxAlbumPhotos]))
      for (const path of paths) {
        if (generation !== this.generation || !allowed()) throw new Error(tr('계정 또는 대화가 변경되었습니다.'))
        if (!(await stat(path)).isFile()) throw new Error(tr('폴더가 아닌 일반 파일을 선택해 주세요.'))
        if (generation !== this.generation || !allowed()) throw new Error(tr('첨부 선택이 취소되었습니다.'))
        // The second stat checks the opened handle. Nonblocking open prevents
        // a regular file replaced by a FIFO from hanging the preparation.
        const source = await open(path, constants.O_RDONLY | constants.O_NONBLOCK)
        let compressed: Buffer | null = null, prepared: { size: number; mtimeMs: number } | null = null
        try {
          const before = await source.stat()
          const header = Buffer.alloc(16)
          const sniffed = mode === 'media' && videoCompressor && before.isFile() ? (await source.read(header, 0, 16, 0)).bytesRead : 0
          let video = false
          try { video = sniffed === 16 && mediaType(header).kind === 'video' } catch { /* Not a picture or a video the app sends as one. */ }
          if (video && videoCompressor) {
            if (before.size >= maxVideoSourceBytes) throw new Error(tr('600 MB 미만의 동영상을 선택해 주세요.'))
            const result = await videoCompressor(path)
            if (generation !== this.generation || !allowed()) { if (result.status === 'ok') result.bytes.fill(0); throw new Error(tr('첨부 선택이 취소되었습니다.')) }
            const now = await source.stat()
            if (now.size !== before.size || now.mtimeMs !== before.mtimeMs) { if (result.status === 'ok') result.bytes.fill(0); throw new Error(tr('선택한 파일이 변경되었습니다. 다시 선택해 주세요.')) }
            if (result.status === 'too-long') throw new Error(tr('11분 이하의 동영상을 선택해 주세요.'))
            prepared = { size: before.size, mtimeMs: before.mtimeMs }
            // The compressed copy goes out unless the original is already smaller and fits.
            if (result.status === 'ok' && result.bytes.length < maxVideoUploadBytes && (result.bytes.length < before.size || before.size >= maxVideoUploadBytes)) compressed = result.bytes
            else if (result.status === 'ok') result.bytes.fill(0)
            if (!compressed && before.size >= maxVideoUploadBytes) throw new Error(result.status === 'ok' ? tr('압축한 동영상도 50 MB를 넘습니다. 더 짧은 동영상을 선택해 주세요.') : tr('동영상을 압축하지 못했습니다. 50 MB 미만의 동영상을 선택해 주세요.'))
          }
          const limit = (mode === 'album' ? 10 : 50) * 1024 * 1024
          if (!before.isFile() || (!compressed && before.size >= limit)) throw new Error(mode === 'album' ? tr('사진은 각각 10 MB 미만으로 첨부해 주세요.') : tr('50 MB 미만의 일반 파일을 선택해 주세요.'))
          if (compressed) { bytes = compressed; compressed = null }
          else {
            const buffer = Buffer.alloc(before.size + 1)
            bytes = buffer
            let count = 0
            while (count < buffer.length) {
              if (generation !== this.generation || !allowed()) throw new Error(tr('첨부 선택이 취소되었습니다.'))
              const part = await source.read(buffer, count, buffer.length - count, count)
              if (!part.bytesRead) break
              count += part.bytesRead
            }
            const after = await source.stat()
            if (count !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new Error(tr('선택한 파일이 변경되었습니다. 다시 선택해 주세요.'))
            bytes = buffer.subarray(0, count)
          }
        } finally { compressed?.fill(0); await source.close() }
        const type = mode === 'file' ? { kind: 'file' as const, contentType: 'application/octet-stream', extension: 'bin' } : mediaType(bytes)
        if (mode === 'album' && type.kind !== 'image') throw new Error(tr('사진 묶음에는 사진만 선택해 주세요.'))
        if (type.kind === 'image' && bytes.length >= 10 * 1024 * 1024) throw new Error(tr('사진은 10 MB 미만으로 첨부해 주세요.'))
        const item: AttachmentFile = { id: randomUUID(), name: safeFileName(basename(path)), kind: type.kind, size: bytes.length }
        parts.push({ item, bytes, extension: type.extension, upload: { ...item, id, chatId, contentType: type.contentType, path: '',
          sha256: createHash('sha256').update(bytes).digest('hex'), md5: createHash('md5').update(bytes).digest('base64'), session: null },
          ...(prepared && type.kind === 'video' ? { source: { path, ...prepared, original: bytes, contentType: type.contentType } } : {}) })
        bytes = null
      }
      if (generation !== this.generation || !allowed()) throw new Error(tr('첨부 선택이 취소되었습니다.'))
      const draft: AttachmentDraft = { id, chatId, name: parts.length > 1 ? tr('사진 {0}장', [parts.length]) : parts[0]!.item.name,
        kind: parts[0]!.item.kind, size: parts.reduce((sum, part) => sum + part.item.size, 0),
        items: parts.map(part => ({ ...part.item, ...(part.item.kind === 'image' || part.item.kind === 'video' ? { previewUrl: `morse://app/${this.previewRoute}/${id}/${part.item.id}` } : {}),
          ...(part.source ? { originalUrl: `morse://app/${this.previewRoute}/${id}/${part.item.id}/original` } : {}) })) }
      this.selected = { draft, parts }; retained = true
      return draft
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) throw new Error(tr('파일을 읽지 못했습니다. 접근 권한과 파일 위치를 확인한 뒤 다시 선택해 주세요.'))
      throw error
    } finally {
      bytes?.fill(0)
      if (!retained) for (const part of parts) part.bytes.fill(0)
      this.pending = false
    }
  }
}
