import { createHash, randomUUID } from 'node:crypto'
import { maxProfilePhotoHistory, profilePhotoBytes, type ProfilePhotoHistoryAction, type ProfilePhotoUploadAction, type ProfilePhotoUploadSnapshot } from '../../shared/profile-photo-upload'
import { backgroundPhotoId } from '../../shared/chat-background'
import { profileUploadSession, profileUploadURL, type ProfileHistoryRecord, type ProfileUploadCommand, type ProfileUploadRecord, type ProfileUploadState } from '../storage/profile-photo-upload-table'
import { uploadProfilePhoto } from '../network/profile-photo-upload-api'
import type { ReadCredentials } from '../network/firestore-rpc'
import { ProfileDisplayWriteFailure } from '../network/profile-display-write'
import { tr } from '../../shared/i18n'

interface Owner {
  validate(version?: string): void
  changed(): void
  completed(): void
  apply(id: string, url: string, version: string, signal: AbortSignal, beforeCommit: () => Promise<void>): Promise<number>
}
export class ProfilePhotoUpload {
  private record: ProfileUploadRecord | null = null
  private history: ProfileHistoryRecord[] = []
  private loaded = false
  private failed = false
  private closed = false
  private job: Promise<void> | null = null
  private abort: AbortController | null = null
  private token: string = randomUUID()
  private message = ''
  private progress = 0
  constructor(private readonly uid: string, private readonly auth: ReadCredentials,
    private readonly store: (command: ProfileUploadCommand, validate?: () => void) => Promise<ProfileUploadState>, private readonly owner: Owner) {}
  get blocked(): boolean { return !this.loaded || this.failed || Boolean(this.record || this.job) }
  get busy(): boolean { return Boolean(this.job) }
  get snapshot(): ProfilePhotoUploadSnapshot {
    let available = false
    try { this.owner.validate(); available = true } catch { /* Hide scoped preview while unavailable. */ }
    return { status: this.failed ? 'error' : !this.loaded ? 'loading' : this.record?.stage ?? 'none', id: this.record?.id ?? null,
      preview: available && this.record ? `morse://app/__profile-upload/${this.token}` : null,
      busy: this.busy, progress: this.progress, message: this.message || (this.record?.stage === 'committing' ? tr('이전 사진 적용 결과를 확인해야 합니다. 자동으로 다시 적용하지 않습니다. 서버 프로필을 새로고침해 주세요.') : ''),
      history: available && this.loaded && !this.failed ? this.history.map(photo => ({ id: photo.id, appliedAt: photo.appliedAt, preview: `morse://app/__profile-history/${this.token}/${photo.id}` })) : [] }
  }
  private validatePhoto(photo: Pick<ProfileUploadRecord, 'id' | 'bytes' | 'sha256' | 'md5'>): void {
    backgroundPhotoId(photo.id); profilePhotoBytes(photo.bytes)
    if (createHash('sha256').update(photo.bytes).digest('hex') !== photo.sha256 || createHash('md5').update(photo.bytes).digest('base64') !== photo.md5) throw new Error(tr('잘못된 사진 준비 기록입니다.'))
  }
  private replace(next: ProfileUploadState): void {
    try {
      if (next.pending) {
        const photo = next.pending
        this.validatePhoto(photo)
        if (!['upload', 'ready', 'committing'].includes(photo.stage) || (photo.stage !== 'upload' && !photo.url)) throw new Error(tr('잘못된 사진 준비 기록입니다.'))
        if (photo.session) profileUploadSession(photo.session, this.uid, photo.id)
        if (photo.url) profileUploadURL(photo.url, this.uid, photo.id)
      }
      if (next.history) {
        if (next.history.length > maxProfilePhotoHistory || new Set(next.history.map(photo => photo.id)).size !== next.history.length) throw new Error(tr('사진 기록의 범위를 확인하지 못했습니다.'))
        for (const photo of next.history) {
          this.validatePhoto(photo); profileUploadURL(photo.url, this.uid, photo.id)
          if (!Number.isSafeInteger(photo.appliedAt) || photo.appliedAt <= 0 || photo.appliedAt > 8640000000000000) throw new Error(tr('사진 기록의 시각을 확인하지 못했습니다.'))
        }
      }
    } catch (error) { next.pending?.bytes.fill(0); next.history?.forEach(photo => photo.bytes.fill(0)); throw error }
    this.record?.bytes.fill(0); this.record = next.pending
    if (next.history) { this.history.forEach(photo => photo.bytes.fill(0)); this.history = next.history }
    this.token = randomUUID(); this.owner.changed()
  }
  async load(): Promise<void> {
    await this.run(async () => {
      try {
        this.replace(await this.store({ kind: 'profile-upload-read' })); this.loaded = true
      } catch { this.failed = true; throw new Error(tr('사진 준비 기록을 읽지 못했습니다. 원본 기록은 보존됩니다. 앱을 다시 열어 주세요.')) }
    })
  }
  async historyAction(request: ProfilePhotoHistoryAction): Promise<void> {
    if (this.blocked || !this.history.some(photo => photo.id === request.id)) throw new Error(tr('사진 대기 작업을 마친 뒤 기록을 다시 확인해 주세요.'))
    this.owner.validate(request.version)
    const scope = this.token
    await this.run(async () => {
      await this.change({ kind: request.action === 'restore' ? 'profile-history-restore' : 'profile-history-forget', id: request.id }, () => {
        this.auth.signal.throwIfAborted()
        this.owner.validate(request.version)
        if (this.token !== scope) throw new Error(tr('사진 기록의 연결이 변경되었습니다. 다시 확인해 주세요.'))
      })
      this.message = request.action === 'restore' ? tr('이전 사진을 준비했습니다. 현재 프로필에 사진 적용을 선택하면 기존 파일을 확인한 뒤 적용합니다.') : tr('이 기기의 사진 기록과 사본을 제거했습니다. 현재 프로필과 서버 사진 파일은 유지됩니다.')
    })
  }
  async queue(id: string, bytes: Uint8Array, version: string): Promise<void> {
    if (this.blocked) throw new Error(tr('기존 사진 대기 작업을 먼저 마쳐 주세요.'))
    this.owner.validate(version); profilePhotoBytes(bytes)
    await this.run(async () => {
      await this.change({ kind: 'profile-upload-create', id, bytes }, () => this.owner.validate(version))
      this.message = tr('이 기기에 사진을 준비했습니다. 업로드 후 최신 프로필을 확인하고 적용해 주세요.')
    })
  }
  async action(request: ProfilePhotoUploadAction): Promise<void> {
    this.owner.validate()
    if (!this.loaded || this.failed || !this.record || this.record.id !== request.id) throw new Error(tr('사진 대기 작업을 다시 확인해 주세요.'))
    await this.run(async () => {
      const photo = { ...this.record!, bytes: new Uint8Array(this.record!.bytes) }
      const controller = new AbortController(); this.abort = controller
      const signal = AbortSignal.any([controller.signal, this.auth.signal, AbortSignal.timeout(180000)])
      const validate = (): void => { signal.throwIfAborted(); this.owner.validate() }
      try {
        if (request.action === 'discard') {
          await this.discard(photo.id)
          this.message = tr('이 기기의 대기 기록을 정리했습니다. 이미 업로드되거나 적용된 사진은 되돌리지 않습니다.')
        } else if (request.action === 'upload') {
          if (photo.stage !== 'upload') throw new Error(tr('업로드 가능한 사진 대기 작업이 아닙니다.'))
          this.progress = 0
          const url = await uploadProfilePhoto(this.auth, this.uid, photo, signal, async session => {
            await this.change({ kind: 'profile-upload-state', id: photo.id, from: 'upload', stage: 'upload', session }, validate)
          }, progress => { this.progress = progress; this.owner.changed() }, validate)
          await this.change({ kind: 'profile-upload-state', id: photo.id, from: 'upload', stage: 'ready', url }, validate)
          this.message = tr('업로드를 확인했습니다. 현재 프로필에 사진 적용을 선택해 주세요.')
        } else {
          if (photo.stage !== 'ready' || !photo.url) throw new Error(tr('사진 적용 결과 확인 또는 업로드를 먼저 마쳐 주세요.'))
          this.owner.validate(request.version)
          const confirmed = await uploadProfilePhoto(this.auth, this.uid, photo, signal, async () => { throw new Error(tr('업로드했던 사진이 없습니다.')) }, () => {}, validate)
          if (confirmed !== photo.url) throw new Error(tr('사진 URL이 변경되었습니다. 대기 작업을 정리한 뒤 다시 선택해 주세요.'))
          let count: number
          try {
            count = await this.owner.apply(photo.id, photo.url, request.version, signal, async () => {
              await this.change({ kind: 'profile-upload-state', id: photo.id, from: 'ready', stage: 'committing' }, () => { validate(); this.owner.validate(request.version) })
            })
          } catch (error) {
            if (error instanceof ProfileDisplayWriteFailure && !error.uncertain && !this.failed && this.record?.stage === 'committing') {
              await this.change({ kind: 'profile-upload-state', id: photo.id, from: 'committing', stage: 'ready' })
            }
            throw error
          }
          // Preserve committing until history retention and pending cleanup commit together.
          try { await this.change({ kind: 'profile-upload-finalize', id: photo.id }) }
          catch { throw new Error(tr('서버는 사진 적용을 확인했지만 이 기기의 사진 기록 저장을 확인하지 못했습니다. 다시 적용하지 말고 앱을 다시 열어 서버 프로필을 확인해 주세요.')) }
          this.message = tr('현재 프로필과 조회된 관련 정보 {0}곳에 사진을 함께 적용했습니다.', [count])
          this.owner.completed()
        }
      } finally { photo.bytes.fill(0); if (this.abort === controller) this.abort = null }
    })
  }
  private async change(command: ProfileUploadCommand, validate?: () => void): Promise<void> {
    let validationRejected = false
    const check = validate ? (): void => { try { validate() } catch (error) { validationRejected = true; throw error } } : undefined
    try { this.replace(await this.store(command, check)) }
    catch (error) { if (!validationRejected) this.failed = true; throw error }
  }
  private async discard(id: string): Promise<void> { await this.change({ kind: 'profile-upload-discard', id }) }
  private async run(work: () => Promise<void>): Promise<void> {
    if (this.closed || this.job) throw new Error(tr('진행 중인 사진 작업을 먼저 마쳐 주세요.'))
    const task = Promise.resolve().then(work)
    this.job = task; this.message = ''; this.owner.changed()
    try { await task }
    catch (error) { this.message = error instanceof Error ? error.message : tr('사진 작업을 완료하지 못했습니다.'); throw error }
    finally { if (this.job === task) this.job = null; this.owner.changed() }
  }
  pause(): void { this.abort?.abort(); this.token = randomUUID() }
  response(token: string, request: Request): Response {
    return this.photoResponse(token, request, this.record?.bytes)
  }
  historyResponse(path: string, request: Request): Response {
    const [token, id, ...extra] = path.split('/')
    if (extra.length || !this.loaded || this.failed) return new Response(null, { status: 403 })
    return this.photoResponse(token!, request, this.history.find(photo => photo.id === id)?.bytes)
  }
  private photoResponse(token: string, request: Request, bytes?: Uint8Array): Response {
    try {
      this.owner.validate()
      if (this.closed || token !== this.token || !bytes || !['GET', 'HEAD'].includes(request.method)) throw new Error('Unavailable photo')
      return new Response(request.method === 'HEAD' ? null : new Uint8Array(bytes), { headers: {
        'Content-Type': 'image/jpeg', 'Content-Length': String(bytes.byteLength), 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox"
      } })
    } catch { return new Response(null, { status: 403 }) }
  }
  async close(): Promise<void> { this.closed = true; this.pause(); await this.job?.catch(() => {}); this.replace({ pending: null, history: [] }) }
}
