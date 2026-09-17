import { channelMediaResponse } from '../media/channel-media-response'
import { backgroundImageInfo } from '../../shared/background-photo-bytes'
import { storyVideoPosterRequest, type StoryVideoPosterRequest, type StoryVideoPoster } from '../../shared/story-composer-video'
import { randomUUID, createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import type { BackgroundPhotoOwner } from './background-photos'
import { maxStoryVideoInputBytes, type StoryVideoCandidate } from '../../shared/story-composer-video'
import { storyVideoHeaders } from '../media/story-video-headers'
import { tr } from '../../shared/i18n'
interface Input { owner: BackgroundPhotoOwner; bytes: Buffer; candidate: StoryVideoCandidate; timer: NodeJS.Timeout; token: string | null; poster: { info: StoryVideoPoster; bytes: Buffer } | null }
export class StoryVideoInputs {
  private input: Input | null = null
  private picking = false
  private generation = 0
  async pick(owner: BackgroundPhotoOwner, choose: () => Promise<string | null>): Promise<StoryVideoCandidate | null> {
    this.prune()
    if (this.picking || this.input) throw new Error(tr('현재 영상 입력 검토를 닫은 뒤 다시 선택해 주세요.'))
    this.picking = true; const generation = this.generation
    const validate = (): void => { owner.validate(); if (generation !== this.generation) throw new Error(tr('영상 선택이 만료되었습니다.')) }
    let bytes: Buffer | null = null
    try {
      validate(); const path = await choose(); validate(); if (!path) return null
      const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK)
      try {
        const before = await file.stat()
        if (!before.isFile() || before.size < 32 || before.size >= maxStoryVideoInputBytes) throw new Error(tr('50 MiB 미만의 MP4 파일을 선택해 주세요.'))
        bytes = Buffer.alloc(before.size + 1); let offset = 0
        while (offset < bytes.length) { validate(); const part = await file.read(bytes, offset, bytes.length - offset, offset); if (!part.bytesRead) break; offset += part.bytesRead }
        const after = await file.stat(); validate()
        if (offset !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error(tr('선택한 영상 파일이 변경되었습니다. 다시 선택해 주세요.'))
        const value = bytes.subarray(0, offset), info = storyVideoHeaders(value), id = randomUUID(), expiresAt = Date.now() + 15 * 60 * 1000
        const candidate: StoryVideoCandidate = { ...info, id, bytes: value.length, sha256: createHash('sha256').update(value).digest('hex'), expiresAt }
        const timer = setTimeout(() => this.release(id), expiresAt - Date.now()); timer.unref()
        this.input = { owner, bytes: Buffer.from(value), candidate, timer, token: null, poster: null }
        return { ...candidate }
      } finally { await file.close() }
    } catch (error) { if (this.input?.owner === owner) this.release(this.input.candidate.id); throw error }
    finally { bytes?.fill(0); this.picking = false }
  }
  private require(owner: BackgroundPhotoOwner, id: string): Input {
    this.prune(); owner.validate()
    const input = this.input
    if (!input || input.candidate.id !== id || input.owner.key !== owner.key) throw new Error(tr('이 초안에서 영상을 다시 선택해 주세요.'))
    input.owner.validate(); return input
  }
  preview(owner: BackgroundPhotoOwner, id: string): string {
    const input = this.require(owner, id)
    input.token = randomUUID()
    return `morse://app/__story-video-input/${input.token}`
  }
  response(token: string, request: Request): Response {
    this.prune(); const input = this.input
    if (!input || !token || input.token !== token) return new Response(null, { status: 404 })
    const validate = (): void => { input.owner.validate(); if (this.input !== input || input.token !== token || input.candidate.expiresAt <= Date.now()) throw new Error(tr('영상 미리보기가 만료되었습니다.')) }
    try { return channelMediaResponse(input.bytes, 'video/mp4', request, validate) } catch { return new Response(null, { status: 403 }) }
  }
  preparePoster(owner: BackgroundPhotoOwner, raw: StoryVideoPosterRequest, bytes: unknown): StoryVideoPoster {
    const request = storyVideoPosterRequest(raw), input = this.require(owner, request.sourceId), source = input.candidate
    if (request.duration !== source.declaredDuration || request.width !== source.trackWidth || request.height !== source.trackHeight || !(bytes instanceof Uint8Array)) throw new Error(tr('브라우저 보고값과 컨테이너 선언값이 다릅니다. 자동 보정하지 않습니다.'))
    const image = backgroundImageInfo(bytes, true), ratio = Math.min(1, 360 / Math.max(request.width, request.height))
    if (image.width !== Math.max(1, Math.round(request.width * ratio)) || image.height !== Math.max(1, Math.round(request.height * ratio))) throw new Error(tr('포스터 크기를 확인해 주세요.'))
    const info: StoryVideoPoster = { sourceId: source.id, posterId: request.posterId, width: image.width, height: image.height, frameTime: request.frameTime, bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') }
    if (input.poster?.info.posterId === info.posterId) { if (JSON.stringify(input.poster.info) !== JSON.stringify(info)) throw new Error(tr('포스터 준비 내용이 변경되었습니다.')); return { ...info } }
    input.poster?.bytes.fill(0); input.poster = { info, bytes: Buffer.from(bytes) }
    return { ...info }
  }
  forSave(owner: BackgroundPhotoOwner, sourceId: string, posterId: string): import('../../shared/story-composer-video-storage').StoryComposerVideoPair {
    const input = this.require(owner, sourceId)
    if (!input.poster || input.poster.info.posterId !== posterId) throw new Error(tr('현재 영상의 포스터를 다시 준비해 주세요.'))
    return { video: Buffer.from(input.bytes), poster: Buffer.from(input.poster.bytes), frameTime: input.poster.info.frameTime }
  }
  release(id: string): void { if (this.input?.candidate.id === id) { clearTimeout(this.input.timer); this.input.bytes.fill(0); this.input.poster?.bytes.fill(0); this.input = null } }
  prune(): void { if (this.input) { try { this.input.owner.validate(); if (this.input.candidate.expiresAt <= Date.now()) this.release(this.input.candidate.id) } catch { if (this.input) this.release(this.input.candidate.id) } } }
  clear(): void { this.generation++; if (this.input) this.release(this.input.candidate.id) }
}
