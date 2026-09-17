import type { ChannelCreationOwner } from '../../shared/channel-creation'
import type { BioEdit, BioSaveResult, ProfileSnapshot, SelfProfile } from '../../shared/profile'
import { FirestoreReader, ProfileWriteFailure, type ReadCredentials } from '../network/firestore-rpc'
import { boolField, documents, documentVersion, stringField, type FirestoreDocument } from '../network/firestore-values'
import { ProfilePhoto } from './profile-photo'
import type { ProfileNameEdit, ProfileNameSaveResult } from '../../shared/profile-name'
import { ProfileDisplayWriteFailure, type ProfileDisplayEdit } from '../network/profile-display-write'
import type { ProfilePhotoClear, ProfilePhotoClearResult } from '../../shared/profile-photo-clear'
import { ProfilePhotoUpload } from './profile-photo-upload'
import type { ProfileUploadCommand, ProfileUploadState } from '../storage/profile-photo-upload-table'
import type { BackgroundPhotoOwner } from '../platform/background-photos'
import { tr } from '../../shared/i18n'
import { userpicCacheFor } from './userpic-cache'

function photoSource(doc: FirestoreDocument): string {
  const raw = doc.fields.photoURL?.stringValue
  return raw === undefined ? '' : typeof raw === 'string' && raw.length <= 10000 ? raw : 'invalid'
}

export class SelfProfileSession {
  private reader: FirestoreReader | null = null
  private doc: FirestoreDocument | null = null
  private connected = false
  private locked = false
  private closed = false
  private generation = 0
  private job: Promise<BioSaveResult> | null = null
  private displayAbort: AbortController | null = null
  private value: Omit<ProfileSnapshot, 'photo' | 'photoUpload'> = { status: 'loading', profile: null, message: '', saving: false, result: 'none', resultMessage: '' }
  private readonly photo: ProfilePhoto
  readonly photoUpload: ProfilePhotoUpload
  constructor(private readonly uid: string, private readonly auth: ReadCredentials, private readonly changed: () => void, store: (command: ProfileUploadCommand, validate?: () => void) => Promise<ProfileUploadState>) {
    this.photo = new ProfilePhoto(uid, auth, () => this.publish())
    this.photoUpload = new ProfilePhotoUpload(uid, auth, store, {
      validate: version => this.photoGuard(version), changed: () => this.publish(), completed: () => this.restart(),
      apply: (photoId, url, version, signal, beforeCommit) => {
        this.photoGuard(version)
        const reader = this.reader!, generation = this.generation
        return reader.saveProfileDisplay(uid, { kind: 'photo', edit: { version }, photoId, url }, signal, () => {
          this.photoGuard(version)
          if (this.reader !== reader || this.generation !== generation) throw new Error(tr('프로필 연결이 변경되었습니다.'))
        }, beforeCommit)
      }
    })
    void Promise.resolve().then(() => this.photoUpload.load()).catch(() => {})
  }
  get snapshot(): ProfileSnapshot { return { ...this.value, profile: this.value.profile ? { ...this.value.profile } : null, photo: this.photo.snapshot, saving: this.value.saving || this.photoUpload.busy, photoUpload: this.photoUpload.snapshot } }
  private publish(): void { if (!this.closed) this.changed() }
  private decode(doc: FirestoreDocument): SelfProfile {
    if (doc.name !== `${documents}/users/${this.uid}` || boolField(doc.fields, 'accountDeleted')) throw new Error('Missing profile')
    const version = documentVersion(doc), userId = stringField(doc.fields, 'userId', 160)
    if (!version || !userId) throw new Error('Invalid profile')
    return { uid: this.uid, userId, displayName: stringField(doc.fields, 'displayName', 512) || userId,
      bio: stringField(doc.fields, 'bio', 500), premium: boolField(doc.fields, 'isPremium') || boolField(doc.fields, 'premium'), hasPhoto: typeof doc.fields.photoURL?.stringValue === 'string' && doc.fields.photoURL.stringValue.length > 0, version }
  }
  private invalidate(): void {
    this.displayAbort?.abort(); this.photoUpload.pause()
    this.generation++; this.reader?.close(); this.reader = null; this.doc = null; this.photo.clear()
    this.value.profile = null; this.value.status = 'loading'; this.value.message = ''
  }
  connection(ready: boolean): void {
    if (this.closed) return
    this.connected = ready
    if (!ready) {
      if (this.job) { this.value.result = 'uncertain'; this.value.resultMessage = tr('연결이 끊겨 프로필 저장 결과를 확인해야 합니다.') }
      this.invalidate(); this.publish()
    } else if (!this.reader) this.restart()
  }
  refresh(): void {
    if (this.closed || !this.connected || this.locked || this.job || this.photoUpload.busy) throw new Error(tr('연결과 진행 중인 저장을 확인한 뒤 다시 불러와 주세요.'))
    this.value.result = 'none'; this.value.resultMessage = ''; this.restart()
  }
  private restart(): void {
    this.invalidate()
    if (!this.connected || this.closed || this.auth.signal.aborted) { this.publish(); return }
    const generation = this.generation
    const current = (): boolean => !this.closed && this.generation === generation
    let reader: FirestoreReader
    try { reader = new FirestoreReader(this.auth); this.reader = reader }
    catch {
      this.value.status = 'error'; this.value.message = tr('프로필 연결을 준비하지 못했습니다. 앱 설치 파일을 확인해 주세요.')
      this.publish(); return
    }
    // The account's own picture as last confirmed is drawn while its profile is read again.
    const cache = userpicCacheFor(this.auth), known = cache?.known(`user:${this.uid}`)
    if (known && !this.locked) void this.photo.select(known)
    reader.watch({ documents: { documents: [`${documents}/users/${this.uid}`] } }, this.auth.signal, {
      snapshot: rows => {
        if (!current()) return
        try {
          const doc = rows.get(`${documents}/users/${this.uid}`)
          if (!doc) throw new Error('Missing profile')
          const profile = this.decode(doc)
          this.doc = doc; this.value.profile = profile; this.value.status = 'ready'; this.value.message = ''
          const raw = photoSource(doc)
          if (raw !== 'invalid') cache?.confirm(`user:${this.uid}`, raw || null)
          if (!this.locked) void this.photo.select(raw)
        } catch {
          this.doc = null; this.photo.clear(); this.value.profile = null; this.value.status = 'error'
          this.value.message = tr('프로필 정보를 확인하지 못했습니다. 다시 불러와 주세요.')
        }
        this.publish()
      },
      // A stream renewal or network retry reads the profile again; the menu keeps it until then.
      reconnecting: () => {},
      state: (state, error) => {
        if (!current() || state === 'ready') return
        this.doc = null; this.photo.clear(); this.value.profile = null
        this.value.status = state === 'error' ? 'error' : 'loading'
        this.value.message = error ? tr('프로필을 불러오지 못했습니다. 연결과 계정 권한을 확인해 주세요.') : ''
        this.publish()
      }
    }, 1)
  }
  setLocked(locked: boolean): void {
    this.locked = locked
    if (locked) { this.displayAbort?.abort(); this.photoUpload.pause() }
    if (locked) this.photo.clear()
    else if (this.doc && this.value.status === 'ready') this.photo.select(photoSource(this.doc))
    this.publish()
  }
  photoResponse(token: string, request: Request): Response {
    return this.closed || this.locked || this.value.status !== 'ready' ? new Response(null, { status: 403 }) : this.photo.response(token, request)
  }
  private photoGuard(version?: string): void {
    if (this.closed || this.locked || !this.connected || this.job || !this.reader || !this.doc || this.value.status !== 'ready' ||
      this.value.result === 'uncertain' || (version !== undefined && this.value.profile?.version !== version)) throw new Error(tr('최신 프로필과 계정 연결을 확인해 주세요.'))
  }
  photoPreparation(version: string): BackgroundPhotoOwner {
    const generation = this.generation
    const validate = (): void => {
      this.photoGuard(version)
      if (this.photoUpload.blocked || generation !== this.generation) throw new Error(tr('사진 대기 작업을 마친 뒤 다시 선택해 주세요.'))
    }
    validate()
    return { key: JSON.stringify(['profile', this.uid, generation]), validate, load: async () => null }
  }
  channelCreationOwner(): ChannelCreationOwner {
    this.photoGuard()
    const profile = this.value.profile!, doc = this.doc!, photo = doc.fields.photoURL
    if (photo && photo.nullValue === undefined && (typeof photo.stringValue !== 'string' || photo.stringValue.length > 10000)) throw new Error(tr('현재 프로필 사진 정보를 확인해 주세요.'))
    const publicKey = stringField(doc.fields, 'publicKey', 16000)
    if (!profile.displayName.trim() || profile.displayName.length > 512) throw new Error(tr('현재 소유자 표시 이름을 확인해 주세요.'))
    return { ownerId: this.uid, profileVersion: profile.version, ownerInfo: { userId: profile.userId, displayName: profile.displayName, photoURL: typeof photo?.stringValue === 'string' ? photo.stringValue : '', publicKey } }
  }
  commentAuthor(): { authorId: string; authorName: string; authorPhotoURL: string | null; profileVersion: string } {
    this.photoGuard()
    const profile = this.value.profile!, doc = this.doc!, photo = doc.fields.photoURL
    if (photo && photo.nullValue === undefined && (typeof photo.stringValue !== 'string' || photo.stringValue.length > 10000)) throw new Error(tr('현재 프로필 사진 정보를 확인해 주세요.'))
    return { authorId: this.uid, authorName: profile.displayName, authorPhotoURL: typeof photo?.stringValue === 'string' && photo.stringValue ? photo.stringValue : null, profileVersion: profile.version }
  }
  copyId(): string {
    if (this.closed || this.locked || this.value.status !== 'ready' || !this.value.profile) throw new Error(tr('최신 프로필을 확인한 뒤 복사해 주세요.'))
    return `@${this.value.profile.userId}`
  }
  async save(edit: BioEdit): Promise<BioSaveResult> {
    const doc = this.doc, reader = this.reader, generation = this.generation
    if (this.closed || this.locked || this.job || this.photoUpload.blocked || !doc || !reader || this.value.status !== 'ready' || this.value.result === 'uncertain' || this.value.profile?.version !== edit.version) throw new Error(tr('최신 프로필을 불러온 뒤 소개를 다시 저장해 주세요.'))
    this.value.saving = true; this.value.result = 'none'; this.value.resultMessage = ''; this.publish()
    const task = (async (): Promise<BioSaveResult> => {
      let result: BioSaveResult
      try { await reader.saveBio(this.uid, doc, edit.bio, this.auth.signal); result = { status: 'saved', message: tr('서버에 소개를 저장했습니다.') } }
      catch (error) { result = { status: error instanceof ProfileWriteFailure && !error.uncertain ? 'rejected' : 'uncertain', message: error instanceof ProfileWriteFailure ? error.message : tr('소개 저장 결과를 확인하지 못했습니다. 서버 정보를 다시 불러와 주세요.') } }
      if (!this.closed && generation === this.generation) {
        this.value.result = result.status; this.value.resultMessage = result.message
        if (result.status === 'saved') this.restart()
        else this.publish()
      }
      return result
    })()
    this.job = task
    try { return await task }
    finally { if (this.job === task) { this.job = null; this.value.saving = false; this.publish() } }
  }
  saveName(edit: ProfileNameEdit): Promise<ProfileNameSaveResult> { return this.saveDisplay({ kind: 'name', edit }) }
  clearPhoto(edit: ProfilePhotoClear): Promise<ProfilePhotoClearResult> {
    if (!this.value.profile?.hasPhoto) throw new Error(tr('현재 사진이 없습니다. 최신 프로필을 확인해 주세요.'))
    return this.saveDisplay({ kind: 'clear-photo', edit })
  }
  private async saveDisplay(change: ProfileDisplayEdit): Promise<ProfileNameSaveResult> {
    const edit = change.edit
    const reader = this.reader, generation = this.generation
    if (this.closed || this.locked || !this.connected || this.job || this.photoUpload.blocked || !reader || !this.doc || this.value.status !== 'ready' ||
      this.value.result === 'uncertain' || this.value.profile?.version !== edit.version) throw new Error(tr('최신 프로필을 불러온 뒤 변경 내용을 다시 확인해 주세요.'))
    const controller = new AbortController()
    this.displayAbort = controller
    const validate = (): void => {
      controller.signal.throwIfAborted()
      if (this.closed || this.locked || !this.connected || generation !== this.generation || this.reader !== reader ||
        this.value.status !== 'ready' || this.value.profile?.version !== edit.version) throw new Error(tr('프로필이 변경되었습니다.'))
    }
    this.value.saving = true; this.value.result = 'none'; this.value.resultMessage = ''; this.publish()
    const task = (async (): Promise<ProfileNameSaveResult> => {
      let result: ProfileNameSaveResult
      try {
        const count = await reader.saveProfileDisplay(this.uid, change, controller.signal, validate)
        result = { status: 'saved', message: change.kind === 'name' ? tr('이름과 조회된 관련 정보 {0}곳의 이름을 함께 저장했습니다.', [count]) : tr('현재 프로필과 조회된 관련 정보 {0}곳에서 사진 표시를 제거했습니다. 기존 사진 파일과 모바일 기록은 보존됩니다.', [count]) }
      } catch (error) {
        result = { status: error instanceof ProfileDisplayWriteFailure && !error.uncertain ? 'rejected' : 'uncertain',
          message: error instanceof ProfileDisplayWriteFailure ? error.message : tr('프로필 변경 결과를 확인하지 못했습니다. 서버 정보를 다시 불러와 주세요.') }
      }
      if (!this.closed && generation === this.generation) {
        this.value.result = result.status; this.value.resultMessage = result.message
        if (result.status === 'saved') this.restart()
        else this.publish()
      }
      return result
    })()
    this.job = task
    try { return await task }
    finally {
      if (this.displayAbort === controller) this.displayAbort = null
      if (this.job === task) { this.job = null; this.value.saving = false; this.publish() }
    }
  }
  async close(): Promise<void> { this.closed = true; this.connected = false; this.invalidate(); await this.job; await this.photoUpload.close() }
}
