import { createHash, randomUUID } from 'node:crypto'
import { backgroundPhotoId } from '../../shared/chat-background'
import { profilePhotoBytes } from '../../shared/profile-photo-upload'
import type { ContactPhotoEdit, ContactPhotoSnapshot, ContactPhotoRemoval } from '../../shared/contact-photo'
import { identifier } from '../../shared/validation'
import type { ContactPhotoCommand, ContactPhotoRecord, ContactPhotoSource } from '../storage/contact-photo-table'
import { tr } from '../../shared/i18n'

export class ContactPhotos {
  private rows = new Map<string, ContactPhotoRecord>()
  private state: ContactPhotoSnapshot['status'] = 'loading'
  private token: string = randomUUID()
  private closed = false
  private revision = 0
  private loading: Promise<void> | null = null
  private cache = new Map<string, Uint8Array>()
  private pending = new Map<string, Promise<void>>()
  constructor(private readonly store: <T>(command: ContactPhotoCommand, validate?: () => void) => Promise<T>,
    private readonly readable: (uid: string) => boolean, private readonly changed: () => void) {}
  get status(): ContactPhotoSnapshot['status'] { return this.state }
  inventory(): ContactPhotoRecord[] {
    if (this.closed || this.state !== 'ready') throw new Error(tr('개인 사진 목록을 다시 불러와 주세요.'))
    return [...this.rows.values()].filter(row => row.photoId !== null).map(row => ({ ...row }))
  }
  snapshot(uid: string): ContactPhotoSnapshot {
    const row = this.rows.get(uid)
    return { status: this.state, version: row?.version ?? '', photoId: row?.photoId ?? null }
  }
  url(uid: string): string | null {
    const row = this.rows.get(uid)
    return !this.closed && this.state === 'ready' && row?.photoId && this.readable(uid)
      ? `morse://app/__contact-personal/${this.token}/${encodeURIComponent(uid)}/${row.photoId}` : null
  }
  private valid(row: ContactPhotoRecord): void {
    identifier(row.uid); backgroundPhotoId(row.version)
    if (!Number.isSafeInteger(row.bytes) || row.bytes < 0 || row.bytes > 1048576 || (row.photoId === null ? row.bytes !== 0 : row.bytes === 0)) throw new Error(tr('잘못된 개인 사진 용량입니다.'))
    if (row.photoId === null) { if (row.sha256 !== null) throw new Error(tr('잘못된 개인 사진 기록입니다.')) }
    else { backgroundPhotoId(row.photoId); if (typeof row.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.sha256)) throw new Error(tr('잘못된 개인 사진 기록입니다.')) }
  }
  async load(): Promise<void> {
    if (this.closed) return
    if (this.loading) return this.loading
    const revision = this.revision
    this.state = 'loading'; this.revoke()
    const task = (async () => {
      try {
        const rows = await this.store<ContactPhotoRecord[]>({ kind: 'contact-photo-list' })
        if (this.closed || revision !== this.revision) return
        if (rows.length > 10000 || new Set(rows.map(row => row.uid)).size !== rows.length) throw new Error(tr('잘못된 개인 사진 목록입니다.'))
        rows.forEach(row => this.valid(row)); this.rows = new Map(rows.map(row => [row.uid, row])); this.state = 'ready'
      } catch { if (!this.closed && revision === this.revision) this.state = 'error' }
      finally { this.changed() }
    })()
    this.loading = task
    try { await task } finally { if (this.loading === task) this.loading = null }
  }
  async save(uid: string, edit: ContactPhotoEdit, bytes: Uint8Array | undefined, validate: () => void): Promise<void> {
    validate()
    const row = await this.store<ContactPhotoRecord>({ kind: 'contact-photo-save', uid, edit, bytes }, validate)
    this.valid(row)
    if (row.uid !== uid || row.version !== edit.operationId || row.photoId !== edit.photoId ||
      row.sha256 !== (bytes ? createHash('sha256').update(bytes).digest('hex') : null)) throw new Error(tr('개인 사진 저장 응답을 확인하지 못했습니다.'))
    this.revision++; this.rows.set(uid, row); this.state = 'ready'; this.revoke(); this.changed()
  }
  revoke(): void {
    this.token = randomUUID()
    for (const bytes of this.cache.values()) bytes.fill(0)
    this.cache.clear()
  }
  async remove(removal: ContactPhotoRemoval, validate: () => void): Promise<void> {
    validate()
    try {
      const row = await this.store<ContactPhotoRecord>({ kind: 'contact-photo-remove', removal }, validate)
      this.valid(row)
      if (row.uid !== removal.uid || row.version !== removal.operationId || row.photoId !== null || row.bytes !== 0) throw new Error(tr('사진 정리 응답을 확인하지 못했습니다.'))
      this.revision++; this.rows.set(row.uid, row); this.state = 'ready'
    } catch (error) {
      // A lost worker reply may follow a commit. Require a fresh inventory, never replay.
      this.revision++; this.state = 'error'; throw error
    } finally { this.revoke(); this.changed() }
  }
  async response(path: string, request: Request): Promise<Response> {
    let bytes: Uint8Array | undefined
    try {
      const [token, rawUid, photoId, ...extra] = path.split('/'), uid = identifier(decodeURIComponent(rawUid ?? ''))
      if (extra.length || !['GET', 'HEAD'].includes(request.method)) throw new Error('Invalid photo request')
      const row = this.rows.get(uid), key = `${token}/${uid}/${photoId}`, revision = this.revision
      const validate = (): void => {
        if (this.closed || this.state !== 'ready' || token !== this.token || revision !== this.revision || !this.readable(uid) || !row?.photoId || row.photoId !== photoId || this.rows.get(uid) !== row) throw new Error('Photo unavailable')
      }
      validate()
      if (!this.cache.has(key)) {
        let pending = this.pending.get(key)
        if (!pending) {
          if (this.pending.size >= 32) return new Response(null, { status: 429 })
          pending = (async () => {
            const source = await this.store<ContactPhotoSource | null>({ kind: 'contact-photo-source', uid, photoId: photoId! }, validate)
            try {
              validate()
              if (!source || source.sha256 !== row!.sha256 || createHash('sha256').update(profilePhotoBytes(source.bytes)).digest('hex') !== source.sha256) throw new Error('Invalid photo source')
              while ([...this.cache.values()].reduce((sum, bytes) => sum + bytes.byteLength, 0) + source.bytes.byteLength > 8 * 1024 * 1024) {
                const oldest = this.cache.keys().next().value
                if (!oldest) break
                this.cache.get(oldest)!.fill(0); this.cache.delete(oldest)
              }
              this.cache.set(key, new Uint8Array(source.bytes))
            } finally { source?.bytes.fill(0) }
          })()
          this.pending.set(key, pending)
          // Do not create an unhandled rejecting promise from cleanup.
          void pending.then(() => { if (this.pending.get(key) === pending) this.pending.delete(key) }, () => { if (this.pending.get(key) === pending) this.pending.delete(key) })
        }
        await pending
      }
      validate()
      const cached = this.cache.get(key)
      if (!cached) throw new Error('Photo expired')
      this.cache.delete(key); this.cache.set(key, cached)
      bytes = new Uint8Array(cached)
      return new Response(request.method === 'HEAD' ? null : new Uint8Array(bytes), { headers: {
        'Content-Type': 'image/jpeg', 'Content-Length': String(bytes.byteLength), 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox"
      } })
    } catch { return new Response(null, { status: 403 }) }
    finally { bytes?.fill(0) }
  }
  async close(): Promise<void> {
    this.closed = true; this.revoke()
    await Promise.allSettled([...(this.loading ? [this.loading] : []), ...this.pending.values()])
    this.rows.clear()
  }
}
