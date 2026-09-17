import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { backgroundPhotoId } from '../../shared/chat-background'
import { backgroundImageInfo, maxBackgroundInputBytes } from '../../shared/background-photo-bytes'
import { tr } from '../../shared/i18n'

export interface BackgroundPhotoOwner {
  key: string
  validate(): void
  load(id: string): Promise<Uint8Array | null>
}
interface StagedPhoto { owner: BackgroundPhotoOwner; bytes: Buffer | null; timer: NodeJS.Timeout }
interface PhotoAccess { owner: BackgroundPhotoOwner; id: string; timer: NodeJS.Timeout }

// Only native-picked input enters preparation. Immutable staged IDs are bound to
// the editor's account/history lifetime; a reference is never a filesystem path.
export class BackgroundPhotos {
  private staged = new Map<string, StagedPhoto>()
  private access = new Map<string, PhotoAccess>()
  private picking = false
  private generation = 0

  async pick(owner: BackgroundPhotoOwner, choose: () => Promise<string | Uint8Array | null>): Promise<{ id: string; bytes: Uint8Array } | null> {
    if (this.picking) throw new Error(tr('열려 있는 사진 선택을 먼저 마쳐 주세요.'))
    this.picking = true
    const generation = this.generation
    const validate = (): void => { owner.validate(); if (generation !== this.generation) throw new Error(tr('사진 선택이 만료되었습니다.')) }
    let bytes: Buffer | null = null
    try {
      validate()
      const path = await choose()
      validate()
      if (!path) return null
      if (path instanceof Uint8Array) {
        // The built-in source is read from one fixed, packaged asset. readFile
        // supports ASAR directly; native fd-based selection stays for OS files.
        bytes = Buffer.from(path); path.fill(0)
        return this.input(owner, bytes)
      }
      const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK)
      try {
        const before = await file.stat()
        if (!before.isFile() || before.size < 24 || before.size > maxBackgroundInputBytes) throw new Error(tr('20 MB 이하의 JPEG 또는 PNG 파일을 선택해 주세요.'))
        bytes = Buffer.alloc(before.size + 1)
        let offset = 0
        while (offset < bytes.length) {
          validate()
          const part = await file.read(bytes, offset, bytes.length - offset, offset)
          if (!part.bytesRead) break
          offset += part.bytesRead
        }
        const after = await file.stat()
        validate()
        if (offset !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error(tr('선택한 파일이 변경되었습니다. 다시 선택해 주세요.'))
        const input = bytes.subarray(0, offset)
        return this.input(owner, input)
      } finally { await file.close() }
    } finally { bytes?.fill(0); this.picking = false }
  }
  private input(owner: BackgroundPhotoOwner, bytes: Uint8Array): { id: string; bytes: Uint8Array } {
    owner.validate(); backgroundImageInfo(bytes); this.prune()
    if (this.staged.size >= 2) throw new Error(tr('사진 선택을 닫은 뒤 다시 열어 주세요.'))
    const id = randomUUID(), timer = setTimeout(() => this.release(id), 15 * 60 * 1000)
    timer.unref()
    this.staged.set(id, { owner, bytes: null, timer })
    return { id, bytes: new Uint8Array(bytes) }
  }

  prepare(id: string, input: unknown): void {
    const entry = this.staged.get(backgroundPhotoId(id))
    if (!entry || entry.bytes) throw new Error(tr('사진을 다시 선택해 주세요.'))
    entry.owner.validate()
    if (!(input instanceof Uint8Array)) throw new Error(tr('사진을 다시 선택해 주세요.'))
    backgroundImageInfo(input, true)
    entry.bytes = Buffer.from(input)
  }
  forSave(owner: BackgroundPhotoOwner, id: string): Uint8Array | undefined {
    const entry = this.staged.get(backgroundPhotoId(id))
    owner.validate()
    if (!entry) return undefined // Existing committed ID is checked inside the writer.
    entry.owner.validate()
    if (entry.owner.key !== owner.key || !entry.bytes) throw new Error(tr('이 화면에서 사진을 다시 선택해 주세요.'))
    return new Uint8Array(entry.bytes)
  }
  release(id: string): void {
    const entry = this.staged.get(id)
    if (entry) { clearTimeout(entry.timer); entry.bytes?.fill(0); this.staged.delete(id) }
  }
  url(owner: BackgroundPhotoOwner, id: string): string {
    backgroundPhotoId(id); owner.validate(); this.prune()
    // Each mounted surface releases its own URL, including when preparation or
    // account state changes. A hard bound also covers a crashed renderer.
    if (this.access.size >= 16) throw new Error(tr('배경 미리보기를 닫은 뒤 다시 열어 주세요.'))
    const token = randomUUID(), timer = setTimeout(() => this.revoke(token), 24 * 60 * 60 * 1000)
    timer.unref()
    this.access.set(token, { owner, id, timer })
    return `morse://app/__background-photo/${token}`
  }
  revoke(token: string): void {
    const entry = this.access.get(token)
    if (entry) { clearTimeout(entry.timer); this.access.delete(token) }
  }
  async response(token: string, request: Request): Promise<Response> {
    if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405 })
    const entry = this.access.get(token), generation = this.generation
    if (!entry) return new Response(null, { status: 404 })
    const validate = (): void => {
      entry.owner.validate()
      if (generation !== this.generation || this.access.get(token) !== entry) throw new Error(tr('배경 조회가 만료되었습니다.'))
    }
    let bytes: Uint8Array | null = null
    try {
      validate()
      const staged = this.staged.get(entry.id)
      if (staged && staged.owner.key === entry.owner.key) {
        staged.owner.validate()
        if (staged.bytes) bytes = new Uint8Array(staged.bytes)
      }
      if (!bytes) bytes = await entry.owner.load(entry.id)
      validate()
      if (!bytes) return new Response(null, { status: 404 })
      backgroundImageInfo(bytes, true)
      return new Response(request.method === 'HEAD' ? null : new Uint8Array(bytes), { headers: {
        'Content-Type': 'image/jpeg', 'Content-Length': String(bytes.byteLength), 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox"
      } })
    } catch { return new Response(null, { status: 403 }) }
    finally { bytes?.fill(0) }
  }
  clear(): void {
    this.generation++
    for (const id of this.staged.keys()) this.release(id)
    for (const token of this.access.keys()) this.revoke(token)
  }
  revokeOwner(key: string): void {
    for (const [id, entry] of this.staged) if (entry.owner.key === key) this.release(id)
    for (const [token, entry] of this.access) if (entry.owner.key === key) this.revoke(token)
  }
  prune(): void {
    for (const [id, entry] of this.staged) { try { entry.owner.validate() } catch { this.release(id) } }
    for (const [token, entry] of this.access) { try { entry.owner.validate() } catch { this.revoke(token) } }
  }
}
