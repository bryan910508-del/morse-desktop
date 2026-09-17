import { randomUUID } from 'node:crypto'
import type { GroupPhotoUploadRequest, GroupPhotoUploadAction, GroupPhotoUploadSnapshot } from '../../shared/group-photo-upload'
import { profilePhotoBytes } from '../../shared/profile-photo-upload'
import { validateGroupPhotoRecord, type GroupPhotoUploadCommand, type GroupPhotoUploadRecord } from '../storage/group-photo-upload-table'
import { uploadGroupPhoto } from '../network/group-photo-upload-api'
import { GroupPhotoApplyFailure } from '../network/group-photo-apply'
import { FirestoreReader, type ReadCredentials } from '../network/firestore-rpc'
import { boolField, decodeDialog, documents, documentVersion, stringField, type FirestoreDocument } from '../network/firestore-values'
import { groupPhotoFields } from './group-photo'
import { tr } from '../../shared/i18n'

export class GroupPhotoUpload {
  private record: GroupPhotoUploadRecord | null = null
  private loaded = false
  private failed = false
  private closed = false
  private job: Promise<void> | null = null
  private abort: AbortController | null = null
  private token = randomUUID()
  private message = ''
  private progress = 0
  private networkChat: string | null = null
  private remote = false
  constructor(private readonly uid: string, private readonly auth: ReadCredentials, private readonly allowed: () => void,
    private readonly source: (chatId: string, version?: string) => FirestoreDocument,
    private readonly store: (command: GroupPhotoUploadCommand, validate?: () => void) => Promise<GroupPhotoUploadRecord | null>, private readonly changed: () => void) {}
  get blocked(): boolean { return !this.loaded || this.failed || Boolean(this.record || this.job) }
  private validate(): void { if (this.closed) throw new Error(tr('계정이 변경되었습니다.')); this.auth.signal.throwIfAborted(); this.allowed() }
  get snapshot(): GroupPhotoUploadSnapshot {
    let current: GroupPhotoUploadSnapshot['current'] = null, available = false
    try {
      this.validate(); available = true
      if (this.record) {
        const doc = this.source(this.record.chatId)
        current = { version: documentVersion(doc), title: decodeDialog(doc, this.uid).summary.title, hasPhoto: groupPhotoFields(doc).hasPhoto }
      }
    } catch { /* Local recovery remains available without ownership of the group. */ }
    const photo = this.record
    return { status: this.failed ? 'error' : this.loaded ? 'ready' : 'loading', busy: Boolean(this.job), progress: this.progress, current,
      pending: photo ? { id: photo.id, chatId: photo.chatId, title: photo.title, version: photo.version, stage: photo.stage,
        preview: available && this.loaded && !this.failed ? `morse://app/__group-photo-upload/${this.token}` : null } : null,
      message: this.message || (photo?.stage === 'committing' ? tr('이전 사진 적용 결과를 확인해야 합니다. 다시 적용하지 않고 현재 그룹 사진을 확인해 주세요.') : '') }
  }
  private replace(photo: GroupPhotoUploadRecord | null): void {
    try { if (photo) validateGroupPhotoRecord(photo) } catch (error) { photo?.bytes.fill(0); throw error }
    this.record?.bytes.fill(0); this.record = photo; this.token = randomUUID()
  }
  private async change(command: GroupPhotoUploadCommand, validate?: () => void): Promise<void> {
    let validationFailed = false
    const check = validate ? (): void => { try { validate() } catch (error) { validationFailed = true; throw error } } : undefined
    try { this.replace(await this.store(command, check)) }
    catch (error) { if (!validationFailed) this.failed = true; throw error }
  }
  async refresh(): Promise<void> {
    await this.run(async signal => {
      await this.change({ kind: 'group-photo-upload-read' }, () => { signal.throwIfAborted(); this.validate() })
      this.loaded = true; this.failed = false
    })
  }
  async queue(request: GroupPhotoUploadRequest, bytes: Uint8Array): Promise<void> {
    if (this.blocked) throw new Error(tr('이전 그룹 사진 기록을 먼저 확인해 주세요.'))
    profilePhotoBytes(bytes)
    await this.run(async signal => {
      await this.change({ kind: 'group-photo-upload-create', request, bytes }, () => {
        signal.throwIfAborted(); this.validate()
        if (decodeDialog(this.source(request.chatId, request.version), this.uid).summary.title !== request.title) throw new Error(tr('그룹 정보가 변경되었습니다.'))
      })
      this.message = tr('사진을 이 기기에 보관했습니다. 업로드한 뒤 최신 그룹 정보를 확인하고 대표 사진으로 적용해 주세요.')
    })
  }
  async action(action: GroupPhotoUploadAction): Promise<void> {
    const pending = this.record
    if (!this.loaded || this.failed || !pending || pending.id !== action.id || pending.stage !== action.stage) throw new Error(tr('최신 그룹 사진 기록을 확인해 주세요.'))
    if (action.action === 'upload' && pending.stage !== 'upload') throw new Error(tr('업로드 대기 중인 사진을 선택해 주세요.'))
    if (action.action === 'apply' && (pending.stage !== 'ready' || !action.version)) throw new Error(tr('한 번 적용을 시작한 사진은 다시 적용하지 않습니다.'))
    await this.run(async signal => {
      const photo = { ...pending, bytes: new Uint8Array(pending.bytes) }
      const validate = (): void => { signal.throwIfAborted(); this.validate() }
      const uploadAllowed = (): void => { validate(); this.source(photo.chatId) }
      try {
        this.remote = action.action !== 'discard'
        if (action.action === 'upload' || action.action === 'apply') this.networkChat = photo.chatId
        if (action.action === 'discard') {
          await this.change({ kind: 'group-photo-upload-discard', id: photo.id, from: photo.stage }, validate)
          this.message = tr('이 기기의 사진 기록과 사본을 닫았습니다. 서버 사진과 진행한 적용은 취소하지 않습니다.'); return
        }
        if (action.action === 'check') { await this.check(photo, signal); return }
        if (action.action === 'upload') {
          this.progress = 0; uploadAllowed()
          const url = await uploadGroupPhoto(this.auth, this.uid, photo, signal, async session => {
            await this.change({ kind: 'group-photo-upload-state', id: photo.id, from: 'upload', stage: 'upload', session }, uploadAllowed)
          }, value => { this.progress = value; this.publish() }, uploadAllowed)
          await this.change({ kind: 'group-photo-upload-state', id: photo.id, from: 'upload', stage: 'ready', url }, uploadAllowed)
          this.message = tr('업로드를 확인했습니다. 최신 그룹 정보를 확인한 뒤 대표 사진 적용을 선택해 주세요.'); return
        }
        this.source(photo.chatId, action.version)
        const url = await uploadGroupPhoto(this.auth, this.uid, photo, signal, async () => { throw new Error(tr('업로드했던 사진이 없습니다.')) }, () => {}, uploadAllowed)
        if (!photo.url || url !== photo.url) throw new Error(tr('업로드한 사진 URL이 변경되었습니다. 기록을 닫고 다시 준비해 주세요.'))
        const reader = new FirestoreReader(this.auth)
        let outcome: 'confirmed' | 'rejected' | null = null
        try {
          await reader.applyUploadedGroupPhoto({ id: photo.id, chatId: photo.chatId, version: action.version!, url }, signal,
            () => { validate(); return this.source(photo.chatId, action.version) }, async () => {
              await this.change({ kind: 'group-photo-upload-state', id: photo.id, from: 'ready', stage: 'committing', version: action.version }, () => { validate(); this.source(photo.chatId, action.version) })
            })
          outcome = 'confirmed'
        } catch (error) {
          if (this.failed || this.record?.stage !== 'committing') throw error
          if (error instanceof GroupPhotoApplyFailure && !error.uncertain) outcome = 'rejected'
          else this.message = tr('사진이 적용되었을 수 있습니다. 자동으로 다시 적용하지 않습니다. 현재 그룹 사진을 확인해 주세요.')
        } finally { reader.close() }
        // An acknowledged remote write and its local receipt are separate.
        // If this write is uncertain, recovery retains committing, never ready.
        if (outcome) {
          await this.change({ kind: 'group-photo-upload-state', id: photo.id, from: 'committing', stage: outcome }, validate)
          this.message = outcome === 'confirmed' ? tr('대표 사진 적용 응답을 확인했습니다. 실제 표시는 최신 서버 정보를 따릅니다.') : tr('대표 사진 적용을 보내지 못했거나 서버가 거절했습니다. 최신 그룹에서 새 사진 기록을 준비해 주세요.')
        }
      } finally { this.networkChat = null; this.remote = false; photo.bytes.fill(0) }
    })
  }
  private async check(photo: GroupPhotoUploadRecord, signal: AbortSignal): Promise<void> {
    const reader = new FirestoreReader(this.auth)
    try {
      const doc = await reader.getDocument(`${documents}/chats/${photo.chatId}`, signal)
      signal.throwIfAborted(); this.validate()
      if (!doc) { this.message = tr('현재 그룹을 찾지 못했습니다. 이전 사진 적용의 성공·취소를 판정하지 않습니다.'); return }
      const group = decodeDialog(doc, this.uid).summary
      if (group.id !== photo.chatId || group.kind !== 'group' || boolField(doc.fields, 'isChannelDiscussion') || stringField(doc.fields, 'channelId', 160) || group.id.startsWith('channel_discuss_')) throw new Error('Group mismatch')
      const matches = Boolean(photo.url && stringField(doc.fields, 'photoURL', 10000) === photo.url && stringField(doc.fields, 'cachedPhotoURL', 10000) === photo.url)
      this.message = matches ? tr('현재 두 사진 필드가 준비한 사진을 가리킵니다. 이 조회를 이전 요청의 성공 응답으로 간주하지 않으며 다시 적용하지 않습니다.') : tr('현재 그룹 사진은 준비한 사진과 다릅니다. 이후 다른 변경이 있었을 수 있으므로 이전 요청의 성공·취소를 판정하지 않습니다.')
    } catch { this.message = tr('현재 그룹 사진을 조회하지 못했습니다. 권한·연결 문제일 수 있으며 이전 적용 결과와 구분합니다.') }
    finally { reader.close() }
  }
  private publish(): void { if (!this.closed) this.changed() }
  private async run(work: (signal: AbortSignal) => Promise<void>): Promise<void> {
    this.validate()
    if (this.job) throw new Error(tr('진행 중인 그룹 사진 작업을 마쳐 주세요.'))
    const abort = new AbortController(); this.abort = abort
    const signal = AbortSignal.any([abort.signal, this.auth.signal, AbortSignal.timeout(180000)])
    const task = Promise.resolve().then(() => { signal.throwIfAborted(); this.validate(); return work(signal) }); this.job = task; this.message = ''; this.publish()
    try { await task }
    catch (error) { this.message = error instanceof Error ? error.message : tr('그룹 사진 작업을 완료하지 못했습니다.'); throw error }
    finally { if (this.job === task) this.job = null; if (this.abort === abort) this.abort = null; this.publish() }
  }
  prune(): void {
    if (this.networkChat) { try { this.validate(); this.source(this.networkChat) } catch { this.pause() } }
  }
  // Dialog refresh resets readers while keeping the account connected. Do not
  // cancel the local record load that starts during the same reconnect; every
  // local store command still validates the active account before dispatch.
  pause(): void { if (this.remote) this.abort?.abort(); this.token = randomUUID() }
  response(token: string, request: Request): Response {
    try {
      this.validate()
      if (!this.loaded || this.failed || token !== this.token || !this.record || !['GET', 'HEAD'].includes(request.method)) throw new Error('Unavailable preview')
      return new Response(request.method === 'HEAD' ? null : new Uint8Array(this.record.bytes), { headers: {
        'Content-Type': 'image/jpeg', 'Content-Length': String(this.record.bytes.byteLength), 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox"
      } })
    } catch { return new Response(null, { status: 403 }) }
  }
  async close(): Promise<void> { this.closed = true; this.pause(); await this.job?.catch(() => {}); this.replace(null) }
}
