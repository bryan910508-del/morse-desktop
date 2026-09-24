import type { ContactProfileSnapshot, ContactSummary, ContactsSnapshot, ContactMutationSnapshot } from '../../shared/contacts'
import { contactDeleteGraceMs } from '../../shared/contacts'
import { performance } from 'node:perf_hooks'
import { randomUUID } from 'node:crypto'
import type { ContactDetails, ContactDetailsEdit, ContactDetailsSnapshot } from '../../shared/contact-details'
import type { ContactDetailsCommand } from '../storage/contact-details-table'
import { ContactWriteFailure, FirestoreReader, type ReadCredentials } from '../network/firestore-rpc'
import { boolField, childId, documents, documentVersion, stringField, type FirestoreDocument } from '../network/firestore-values'
import { ProfilePhoto } from './profile-photo'
import { ContactAvatars } from './contact-avatars'
import { ContactPhotos } from './contact-photos'
import { contactNames, PeerProfiles, registerPeerProfiles } from './peer-profiles'
import { userpicCacheFor } from './userpic-cache'
import type { ContactPhotoCommand } from '../storage/contact-photo-table'
import { maxContactPhotoStorage, type ContactPhotoBinding, type ContactPhotoEdit, type ContactPhotoStorage, type ContactPhotoRemoval } from '../../shared/contact-photo'
import type { BackgroundPhotoOwner } from '../platform/background-photos'
import { DeliveryCommandFailure, uncertainDeliveryCodes } from '../storage/delivery-client'
import { recordContactStep } from '../platform/contact-diagnostics'
import { locale, tr } from '../../shared/i18n'

interface Selection { uid: string; requestId: string }
interface DeleteGrace { id: string; uid: string; version: string; deadline: number; finish(reason: string | null): void }
interface Peer {
  selection: Selection
  value: ContactProfileSnapshot
  photo: ProfilePhoto
  local: ContactDetailsSnapshot
  stop(): void
}
const noPhoto = (): ContactProfileSnapshot['photo'] => ({ url: null, status: 'none', message: '' })
const noLocal = (): ContactDetailsSnapshot => ({ status: 'loading', nickname: '', note: '', version: '' })
function emptyProfile(selection: Selection, status: ContactProfileSnapshot['status'], message = ''): ContactProfileSnapshot {
  return { ...selection, status, displayName: '', originalName: '', contactVersion: '', local: noLocal(), personalPhoto: { status: 'loading', version: '', photoId: null }, visibility: 'unknown', userId: '', bio: '', message, photo: noPhoto() }
}

// Contact membership comes from the owner's collection. Only an explicitly
// selected, current member gets profile and reciprocal-membership subscriptions.
let watchSteps = 0
export class ContactsSession {
  private reader: FirestoreReader | null = null
  private generation = 0
  private connected = false
  private locked = false
  private closed = false
  private status: ContactsSnapshot['status'] = 'loading'
  private message = ''
  private items = new Map<string, ContactSummary>()
  private ordered: ContactSummary[] = []
  private selection: Selection | null = null
  private peer: Peer | null = null
  private contactDocs = new Map<string, FirestoreDocument>()
  private labels = new Map<string, string>()
  private mutation: ContactMutationSnapshot | null = null
  private job: Promise<void> | null = null
  private jobAbort: AbortController | null = null
  private lastDelete: { id: string; requestId: string; uid: string; version: string } | null = null
  private deleteGrace: DeleteGrace | null = null
  private deleteIntentGeneration = 0
  private removedVersions = new Map<string, string>()
  private unavailablePhotos = new Set<string>()
  private photoStorage: { value: ContactPhotoStorage; generation: number; deadline: number } | null = null
  readonly personalPhotos: ContactPhotos
  readonly listAvatars: ContactAvatars
  private readonly profileNames: PeerProfiles

  constructor(private readonly uid: string, private readonly auth: ReadCredentials, private readonly changed: () => void,
    private readonly store: <T>(command: ContactDetailsCommand | ContactPhotoCommand, validate?: () => void) => Promise<T>,
    // The picture a person has now, for the album this device keeps of that person (ProfilePhotoHistory).
    seen: (uid: string, raw: string) => void = () => {}) {
    this.profileNames = new PeerProfiles(uid, auth, auth.signal, () => { if (!this.closed) { this.order(); this.publish() } }, seen)
    registerPeerProfiles(auth, this.profileNames)
    this.personalPhotos = new ContactPhotos(store, uid => this.connected && !this.auth.signal.aborted && this.has(uid) && !this.unavailablePhotos.has(uid), () => this.publish())
    this.listAvatars = new ContactAvatars(uid, auth, peerUid => {
      if (!this.connected || !this.reader || !this.has(peerUid)) throw new Error(tr('현재 연락처를 확인해 주세요.'))
      return { uid: peerUid, reader: this.reader, personalURL: this.personalPhotos.url(peerUid) }
    }, async (raw, request) => {
      const url = new URL(raw), prefix = '/__contact-personal/'
      if (url.protocol !== 'morse:' || url.hostname !== 'app' || !url.pathname.startsWith(prefix) || url.search || url.hash || url.port || url.username || url.password) return new Response(null, { status: 403 })
      return this.personalPhotos.response(url.pathname.slice(prefix.length), request)
    }, () => { if (!this.closed) this.changed() })
  }
  get snapshot(): ContactsSnapshot {
    const peer = this.peer, doc = peer ? this.contactDocs.get(peer.selection.uid) : undefined
    const personalURL = peer?.value.status === 'ready' ? this.personalPhotos.url(peer.selection.uid) : null
    const profile = peer ? { ...peer.value,
      displayName: peer.value.status === 'ready' ? peer.local.nickname || peer.value.displayName : '', originalName: peer.value.displayName,
      contactVersion: doc ? documentVersion(doc) : '', local: peer.value.status === 'ready' ? { ...peer.local } : noLocal(),
      personalPhoto: peer.value.status === 'ready' ? this.personalPhotos.snapshot(peer.selection.uid) : { status: 'loading' as const, version: '', photoId: null },
      photo: personalURL ? { url: personalURL, status: 'ready' as const, message: '' } : peer.value.status === 'ready' && peer.value.visibility === 'visible' ? peer.photo.snapshot : noPhoto() }
      : this.selection ? emptyProfile(this.selection, this.status === 'ready' ? 'unavailable' : this.status,
        this.status === 'ready' ? tr('현재 연락처에서 이 사용자를 확인할 수 없습니다.') : this.message) : null
    return { status: this.status, message: this.message,
      items: this.ordered.map(item => ({ ...item, personalPhotoURL: this.personalPhotos.url(item.uid), avatar: this.listAvatars.snapshot(item.uid) })), personalPhotosStatus: this.personalPhotos.status,
      profile, mutation: this.mutation ? { ...this.mutation, undo: this.deleteGrace ? {
        operationId: this.deleteGrace.id, remainingMs: Math.max(0, this.deleteGrace.deadline - performance.now())
      } : null } : null }
  }
  has(uid: string): boolean { return !this.closed && !this.locked && this.status === 'ready' && this.items.has(uid) }
  get ready(): boolean { return !this.closed && !this.locked && this.status === 'ready' }
  closeFriendCandidate(uid: string): { displayName: string; version: string } {
    const doc = this.contactDocs.get(`${uid}`), item = this.items.get(uid)
    if (!this.has(uid) || !this.connected || !doc || !item) throw new Error(tr('현재 연락처에서 다시 선택해 주세요.'))
    const version = documentVersion(doc), displayName = this.nameOf(item)
    if (!version || !displayName || displayName.length > 512) throw new Error(tr('현재 연락처 이름과 버전을 확인해 주세요.'))
    return { displayName, version }
  }
  // Telegram opens a person's stories from the peer the session already holds (Data::Stories::loadAround
  // takes _owner->peer(peerId) and asks stories.getPeerStories with it); it never waits for a fresh read
  // of that person first. The selection is still this device's handle on the story, and the person must
  // still be a contact — only the wait for a profile read that a poor connection can hold up is gone.
  directPeer(requestId: string): { uid: string; displayName: string } {
    const peer = this.peer
    if (!peer || peer.selection.requestId !== requestId || !this.has(peer.selection.uid) || peer.value.status === 'unavailable') throw new Error(tr('최신 연락처 프로필을 다시 선택해 주세요.'))
    if (peer.value.status === 'ready') return { uid: peer.selection.uid, displayName: peer.value.displayName }
    const item = this.items.get(peer.selection.uid)
    if (!item) throw new Error(tr('최신 연락처 프로필을 다시 선택해 주세요.'))
    return { uid: peer.selection.uid, displayName: this.nameOf(item) }
  }
  private publish(): void { if (!this.closed) { this.listAvatars?.prune(); this.changed() } }
  private nameOf(item: ContactSummary): string { return contactNames(item, this.labels.get(item.uid), this.profileNames.name(item.uid)).displayName }
  private order(): void {
    this.ordered = [...this.items.values()].map(item => ({ ...item, ...contactNames(item, this.labels.get(item.uid), this.profileNames.name(item.uid)) }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, locale()) || a.uid.localeCompare(b.uid))
  }
  private stopPeer(): void {
    this.cancelDeleteGrace(tr('연락처 선택이나 연결이 변경되어 삭제 대기를 취소했습니다. 이 요청은 서버에 보내지 않았습니다.'))
    const peer = this.peer; this.peer = null
    peer?.stop(); peer?.photo.clear()
  }
  private invalidate(): void {
    this.listAvatars.clear()
    this.profileNames.clear()
    this.photoStorage = null
    this.personalPhotos.revoke()
    this.generation++; this.stopPeer(); this.reader?.close(); this.reader = null
    this.items.clear(); this.contactDocs.clear(); this.ordered = []; this.status = 'loading'; this.message = ''
  }
  connection(ready: boolean): void {
    if (this.closed) return
    this.connected = ready
    if (!ready) { this.jobAbort?.abort(); this.invalidate(); this.message = tr('계정 연결을 확인하고 있습니다.'); this.publish() }
    else if (!this.reader && !this.locked) this.restart()
  }
  setLocked(locked: boolean): void {
    if (this.closed || this.locked === locked) return
    this.locked = locked
    if (locked) { this.jobAbort?.abort(); this.invalidate(); this.message = tr('화면 잠금을 해제하면 연락처를 다시 불러옵니다.'); this.publish() }
    else if (this.connected) this.restart()
  }
  refresh(): void {
    if (this.closed || this.locked || !this.connected || this.job) throw new Error(tr('계정 연결과 진행 중인 연락처 저장을 확인해 주세요.'))
    this.restart()
  }
  private restart(): void {
    this.invalidate()
    if (!this.connected || this.locked || this.closed || this.auth.signal.aborted) { this.publish(); return }
    void this.personalPhotos.load()
    const generation = this.generation
    const current = (): boolean => !this.closed && this.generation === generation
    void this.store<{ uid: string; nickname: string }[]>({ kind: 'contact-labels' }).then(rows => {
      if (current()) { this.labels = new Map(rows.map(row => [row.uid, row.nickname])); this.order(); this.publish() }
    }).catch(() => { if (current()) { this.labels.clear(); this.order(); this.message = tr('이 기기의 연락처 별칭을 불러오지 못했습니다.'); this.publish() } })
    try {
      const reader = new FirestoreReader(this.auth); this.reader = reader
      const parent = `${documents}/users/${this.uid}`
      reader.watch({ query: { parent, structuredQuery: { from: [{ collectionId: 'contacts' }] } } }, this.auth.signal, {
        snapshot: rows => {
          if (!current()) return
          this.photoStorage = null
          try {
            const next = new Map<string, ContactSummary>()
            const nextDocs = new Map<string, FirestoreDocument>()
            for (const doc of rows.values()) {
              const uid = childId(doc.name, `${parent}/contacts`)
              const displayName = stringField(doc.fields, 'displayName', 512).trim()
              // iOS fromContactCache treats an empty server-masked name as
              // withdrawn. Never fall back to its old handle or photo.
              const removed = this.removedVersions.get(uid)
              if (removed && documentVersion(doc) === removed) continue
              if (uid !== this.uid && displayName && !boolField(doc.fields, 'accountDeleted')) { next.set(uid, { uid, displayName }); nextDocs.set(uid, doc) }
            }
            for (const [uid, version] of this.removedVersions) {
              const doc = rows.get(`${parent}/contacts/${uid}`)
              if (!doc || documentVersion(doc) !== version) this.removedVersions.delete(uid)
            }
            this.contactDocs = nextDocs
            if (this.deleteGrace) {
              const current = nextDocs.get(this.deleteGrace.uid)
              if (!current || documentVersion(current) !== this.deleteGrace.version) this.cancelDeleteGrace(tr('연락처가 변경되어 삭제 대기를 취소했습니다. 최신 목록에서 다시 확인해 주세요.'))
            }
            for (const uid of this.unavailablePhotos) if (!next.has(uid)) this.unavailablePhotos.delete(uid)
            this.items = next; this.profileNames.bind(this.reader, next.keys()); this.order()
            this.status = 'ready'; this.message = ''; this.syncPeer(); this.publish()
          } catch {
            this.invalidate(); this.status = 'error'; this.message = tr('연락처 데이터를 확인하지 못했습니다. 다시 불러와 주세요.'); this.publish()
          }
        },
        // A stream renewal or network retry reads the same collection again; the list stays until then.
        reconnecting: () => {},
        state: (state, error) => {
          if (!current() || state === 'ready') return
          this.photoStorage = null
          this.stopPeer(); this.items.clear(); this.contactDocs.clear(); this.ordered = []; this.status = state === 'error' ? 'error' : 'loading'
          this.message = error ? tr('연락처를 불러오지 못했습니다. 연결과 계정 권한을 확인해 주세요.') : ''
          this.publish()
        }
      }, 10000, 8 * 1024 * 1024)
    } catch {
      this.invalidate(); this.status = 'error'; this.message = tr('연락처 연결을 준비하지 못했습니다. 다시 불러와 주세요.'); this.publish()
    }
  }
  open(uid: string, requestId: string): void {
    if (!this.has(uid)) throw new Error(tr('현재 연락처에서 사용자를 다시 선택해 주세요.'))
    if (this.job && this.selection?.requestId !== requestId) throw new Error(tr('진행 중인 연락처 저장을 확인해 주세요.'))
    this.stopPeer(); this.selection = { uid, requestId }; this.syncPeer(); this.publish()
  }
  closeProfile(requestId: string): void {
    if (this.selection?.requestId !== requestId) return
    this.selection = null; this.stopPeer(); this.publish()
  }
  private syncPeer(): void {
    const selection = this.selection, reader = this.reader
    if (!selection || !reader || !this.has(selection.uid)) { this.stopPeer(); return }
    if (this.peer?.selection === selection) return
    this.stopPeer()
    const peer: Peer = { selection, value: emptyProfile(selection, 'loading'), local: noLocal(), stop: () => {},
      photo: new ProfilePhoto(selection.uid, this.auth, () => { if (this.peer === peer) this.publish() }, '__contact-photo') }
    this.peer = peer
    // The picture last confirmed for this person is read ahead, so the profile opens with it when the server agrees.
    const cache = userpicCacheFor(this.auth), known = cache?.known(`user:${selection.uid}`)
    if (known) void peer.photo.select(known).catch(() => {})
    void this.store<ContactDetails>({ kind: 'contact-details', uid: selection.uid }).then(value => {
      if (this.peer === peer) { peer.local = { ...value, status: 'ready' }; this.publish() }
    }).catch(() => { if (this.peer === peer) { peer.local = { ...noLocal(), status: 'error' }; this.publish() } })
    const root = `${documents}/users/${selection.uid}`, reciprocal = `${root}/contacts/${this.uid}`
    const current = (): boolean => this.peer === peer && this.has(selection.uid)
    peer.stop = reader.watch({ documents: { documents: [root, reciprocal] } }, this.auth.signal, {
      snapshot: rows => {
        if (!current()) return
        try {
          if ([...rows.keys()].some(name => name !== root && name !== reciprocal)) throw new Error('Profile scope mismatch')
          const doc = rows.get(root)
          const displayName = doc ? stringField(doc.fields, 'displayName', 512).trim() : ''
          if (!doc || !displayName || boolField(doc.fields, 'accountDeleted')) {
            this.cancelDeleteGrace(tr('상대 프로필을 확인할 수 없어 삭제 대기를 취소했습니다. 최신 연락처를 확인해 주세요.'))
            if (!this.unavailablePhotos.has(selection.uid)) { this.unavailablePhotos.add(selection.uid); this.personalPhotos.revoke() }
            cache?.confirm(`user:${selection.uid}`, null)
            peer.photo.clear(); peer.value = emptyProfile(selection, 'unavailable', tr('탈퇴했거나 현재 프로필을 확인할 수 없는 사용자입니다.'))
          } else {
            this.unavailablePhotos.delete(selection.uid)
            const visible = rows.has(reciprocal)
            peer.value = { ...emptyProfile(selection, 'ready'), displayName, visibility: visible ? 'visible' : 'hidden',
              userId: visible ? stringField(doc.fields, 'userId', 160) : '', bio: visible ? stringField(doc.fields, 'bio', 500) : '' }
            const raw = visible ? stringField(doc.fields, 'photoURL', 10000) : ''
            cache?.confirm(`user:${selection.uid}`, raw || null)
            if (visible) void peer.photo.select(raw); else peer.photo.clear()
          }
        } catch {
          this.cancelDeleteGrace(tr('프로필을 확인할 수 없어 삭제 대기를 취소했습니다. 최신 연락처를 확인해 주세요.'))
          peer.photo.clear(); peer.value = emptyProfile(selection, 'error', tr('프로필 데이터를 확인하지 못했습니다. 다시 불러와 주세요.'))
        }
        this.publish()
      },
      state: (state, error) => {
        if (!current()) return
        // Opening a story waits for this profile; the step and the try it happened on say whether the wait timed out.
        recordContactStep('profile-watch', `${state} ${++watchSteps}`)
        if (state === 'ready') return
        this.cancelDeleteGrace(tr('프로필 연결이 변경되어 삭제 대기를 취소했습니다. 이 요청은 서버에 보내지 않았습니다.'))
        peer.photo.clear(); peer.value = emptyProfile(selection, state === 'error' ? 'error' : 'loading',
          error ? tr('프로필을 불러오지 못했습니다. 연결과 연락처 관계를 확인해 주세요.') : '')
        this.publish()
      }
    }, 2, 2 * 1024 * 1024)
  }
  copyId(requestId: string): string {
    const peer = this.peer
    if (!peer || this.selection?.requestId !== requestId || !this.has(peer.selection.uid) || peer.value.status !== 'ready' || peer.value.visibility !== 'visible' || !peer.value.userId) throw new Error(tr('공개된 최신 프로필을 확인한 뒤 복사해 주세요.'))
    return `@${peer.value.userId}`
  }
  private editablePeer(requestId: string): Peer {
    const peer = this.peer
    if (!peer || peer.selection.requestId !== requestId || !this.has(peer.selection.uid) || !this.connected || peer.value.status !== 'ready') throw new Error(tr('최신 연락처 프로필을 다시 선택해 주세요.'))
    return peer
  }
  photoPreparation(binding: ContactPhotoBinding, allowBusy = false): BackgroundPhotoOwner {
    const peer = this.editablePeer(binding.requestId), generation = this.generation
    const validate = (): void => {
      this.auth.signal.throwIfAborted()
      const local = this.personalPhotos.snapshot(peer.selection.uid), doc = this.contactDocs.get(peer.selection.uid)
      if (this.editablePeer(binding.requestId) !== peer || generation !== this.generation || (!allowBusy && this.job) || local.status !== 'ready' ||
        local.version !== binding.expectedVersion || !doc || documentVersion(doc) !== binding.contactVersion) throw new Error(tr('연락처나 개인 사진이 변경되었습니다. 최신 프로필에서 다시 선택해 주세요.'))
    }
    validate()
    return { key: JSON.stringify(['contact-photo', this.uid, peer.selection.uid, binding.requestId, generation, binding.contactVersion, binding.expectedVersion]), validate, load: async () => null }
  }
  async photoStorageInventory(): Promise<ContactPhotoStorage> {
    if (!this.ready || !this.connected || this.auth.signal.aborted || this.job) throw new Error(tr('계정 연결과 진행 중인 연락처 작업을 확인해 주세요.'))
    const generation = this.generation
    this.photoStorage = null
    await this.personalPhotos.load()
    if (!this.ready || !this.connected || this.auth.signal.aborted || this.job || generation !== this.generation) throw new Error(tr('계정 연결을 확인한 뒤 다시 불러와 주세요.'))
    const items = this.personalPhotos.inventory().map(row => ({ uid: row.uid, version: row.version, photoId: row.photoId!, bytes: row.bytes,
      member: this.items.has(row.uid), name: this.items.has(row.uid) ? this.nameOf(this.items.get(row.uid)!) : '' }))
      .sort((a, b) => Number(a.member) - Number(b.member) || a.name.localeCompare(b.name, locale()) || a.uid.localeCompare(b.uid))
    const value: ContactPhotoStorage = { token: randomUUID(), items, bytes: items.reduce((sum, row) => sum + row.bytes, 0), limit: maxContactPhotoStorage }
    this.photoStorage = { value, generation, deadline: performance.now() + 5 * 60_000 }
    return value
  }
  async removeStoredPhoto(removal: ContactPhotoRemoval): Promise<void> {
    if (this.job) throw new Error(tr('진행 중인 연락처 작업을 먼저 마쳐 주세요.'))
    const inventory = this.photoStorage, item = inventory?.value.items.find(row => row.uid === removal.uid)
    const validate = (): void => {
      this.auth.signal.throwIfAborted()
      const local = this.personalPhotos.snapshot(removal.uid)
      if (!this.ready || !this.connected || !inventory || this.photoStorage !== inventory || inventory.generation !== this.generation ||
        inventory.deadline <= performance.now() || inventory.value.token !== removal.token || !item || item.version !== removal.version || item.photoId !== removal.photoId ||
        item.member !== this.items.has(removal.uid) || local.status !== 'ready' || local.version !== removal.version || local.photoId !== removal.photoId) {
        throw new Error(tr('사진이나 연락처 목록이 변경되었습니다. 다시 불러온 뒤 정리할 사진을 확인해 주세요.'))
      }
    }
    validate()
    const task = Promise.resolve().then(() => this.personalPhotos.remove(removal, validate))
    this.job = task
    try { await task } finally { this.photoStorage = null; this.job = null; this.publish() }
  }
  async savePhoto(edit: ContactPhotoEdit, bytes?: Uint8Array): Promise<void> {
    if (this.job) throw new Error(tr('진행 중인 연락처 저장을 먼저 마쳐 주세요.'))
    const owner = this.photoPreparation(edit, true), peer = this.editablePeer(edit.requestId)
    const result: ContactMutationSnapshot = { requestId: edit.requestId, uid: peer.selection.uid, kind: 'photo', busy: true, outcome: 'none', message: '' }
    this.mutation = result
    const task = Promise.resolve().then(async () => {
      try {
        await this.personalPhotos.save(peer.selection.uid, edit, bytes, owner.validate)
        result.outcome = 'saved'; result.message = edit.photoId ? tr('이 기기의 현재 계정에 개인 사진을 저장했습니다. 연락처 목록과 프로필에 표시됩니다.') : tr('개인 사진을 해제했습니다. 상대의 공개 범위에 따라 원래 사진을 표시합니다.')
      } catch (error) {
        const definite = error instanceof DeliveryCommandFailure && !uncertainDeliveryCodes.has(error.code)
        result.outcome = definite ? 'rejected' : 'uncertain'
        result.message = error instanceof DeliveryCommandFailure && error.code === 'capacity' ? tr('개인 사진 저장 한도에 도달했습니다. 설정의 저장공간 → 연락처 개인 사진에서 보관 사진을 정리한 뒤 다시 선택해 주세요.') : tr('사진 저장 결과를 확인하지 못했습니다. 편집을 닫고 연락처를 새로고침해 확인해 주세요.')
        throw error
      }
    })
    this.job = task; this.publish()
    try { await task } finally { if (this.job === task) this.job = null; result.busy = false; this.publish() }
  }
  async saveDetails(requestId: string, edit: ContactDetailsEdit): Promise<void> {
    const peer = this.editablePeer(requestId)
    if (this.job || peer.local.status !== 'ready') throw new Error(tr('개인 정보를 불러온 뒤 다시 저장해 주세요.'))
    const result: ContactMutationSnapshot = { requestId, uid: peer.selection.uid, kind: 'save', busy: true, outcome: 'none', message: '' }
    this.mutation = result; this.publish()
    const task = (async () => {
      try {
        const value = await this.store<ContactDetails>({ kind: 'contact-details-save', uid: peer.selection.uid, edit })
        if (value.nickname) this.labels.set(peer.selection.uid, value.nickname); else this.labels.delete(peer.selection.uid)
        this.order()
        if (this.peer === peer) peer.local = { ...value, status: 'ready' }
        result.outcome = 'saved'; result.message = tr('이 데스크톱에 별칭과 개인 메모를 저장했습니다.')
      } catch (error) { result.outcome = 'rejected'; result.message = tr('저장하지 못했습니다. 작성한 내용을 보관한 뒤 연락처를 다시 열어 확인해 주세요.'); throw error }
    })()
    this.job = task
    try { await task } finally { this.job = null; result.busy = false; this.publish() }
  }
  private waitForDelete(id: string, uid: string, version: string): Promise<string | null> {
    return new Promise(resolve => {
      let timer: NodeJS.Timeout | undefined
      const grace: DeleteGrace = { id, uid, version, deadline: performance.now() + contactDeleteGraceMs, finish: reason => {
        if (this.deleteGrace !== grace) return
        if (timer) clearTimeout(timer)
        this.deleteGrace = null; resolve(reason); this.publish()
      } }
      const tick = (): void => {
        if (this.deleteGrace !== grace) return
        const remaining = grace.deadline - performance.now()
        if (remaining > 0) timer = setTimeout(tick, Math.ceil(remaining))
        else grace.finish(null)
      }
      this.deleteGrace = grace; timer = setTimeout(tick, contactDeleteGraceMs); this.publish()
    })
  }
  private cancelDeleteGrace(reason: string): void { this.deleteGrace?.finish(reason) }
  undoDelete(operationId: string): boolean {
    const grace = this.deleteGrace
    if (!grace || grace.id !== operationId || performance.now() >= grace.deadline) return false
    grace.finish(tr('연락처 삭제를 되돌렸습니다. 이 요청은 서버에 보내지 않았습니다.'))
    return true
  }
  cancelDeleteForQuit(): void {
    this.deleteIntentGeneration++
    this.cancelDeleteGrace(tr('앱 종료 요청으로 삭제 대기를 취소했습니다. 이 요청은 서버에 보내지 않았습니다.'))
  }
  async delete(requestId: string, operationId: string, version: string): Promise<void> {
    // A repeated IPC must not issue a second remote commit, even if the first
    // response was lost. A new confirmation obtains the current contact version.
    if (this.lastDelete?.id === operationId) {
      if (this.lastDelete.requestId !== requestId || this.lastDelete.version !== version) throw new Error(tr('연락처 삭제 요청이 변경되었습니다.'))
      await this.job; return
    }
    const peer = this.editablePeer(requestId), uid = peer.selection.uid, doc = this.contactDocs.get(uid)
    if (this.job || !doc || !version || documentVersion(doc) !== version) throw new Error(tr('연락처가 변경되었습니다. 최신 목록에서 다시 확인해 주세요.'))
    this.lastDelete = { id: operationId, requestId, uid, version }
    const generation = this.generation, deleteIntentGeneration = this.deleteIntentGeneration
    const validate = (): void => {
      this.auth.signal.throwIfAborted()
      const current = this.contactDocs.get(uid)
      if (this.editablePeer(requestId) !== peer || this.generation !== generation || this.deleteIntentGeneration !== deleteIntentGeneration || !current || documentVersion(current) !== version) throw new ContactWriteFailure(false)
    }
    const abort = new AbortController(); this.jobAbort = abort
    const result: ContactMutationSnapshot = { requestId, uid, kind: 'delete', busy: true, outcome: 'none', message: tr('5초 동안 삭제를 되돌릴 수 있습니다. 아직 서버에 삭제 요청을 보내지 않았습니다.') }
    this.mutation = result; this.publish()
    const task = Promise.resolve().then(async () => {
      let reader: FirestoreReader | null = null, mayWrite = false
      try {
        validate()
        const cancelled = await this.waitForDelete(operationId, uid, version)
        if (cancelled) { result.outcome = 'cancelled'; result.message = cancelled; return }
        validate()
        result.message = tr('되돌리기 시간이 끝났습니다. 서버의 삭제 결과를 확인하고 있습니다.'); this.publish()
        reader = new FirestoreReader(this.auth); mayWrite = true
        await reader.deleteContact(this.uid, uid, doc, abort.signal, validate)
        result.outcome = 'deleted'; result.message = tr('연락처 삭제가 처리되었습니다. 대화 기록은 유지됩니다.')
        const current = this.contactDocs.get(uid)
        if (current && documentVersion(current) === version) {
          this.removedVersions.set(uid, version); this.contactDocs.delete(uid); this.items.delete(uid)
          this.ordered = this.ordered.filter(item => item.uid !== uid); this.syncPeer()
        }
      } catch (error) {
        const uncertain = error instanceof ContactWriteFailure ? error.uncertain : mayWrite
        result.outcome = uncertain ? 'uncertain' : 'rejected'
        result.message = uncertain ? tr('삭제 결과를 확인하지 못했습니다. 자동으로 다시 삭제하지 않습니다. 연락처 목록을 새로고침해 주세요.') : tr('연락처가 변경되었거나 삭제 권한을 확인하지 못했습니다. 최신 목록을 확인해 주세요.')
      } finally { reader?.close() }
    })
    this.job = task
    try { await task } finally { this.job = null; this.jobAbort = null; result.busy = false; this.publish() }
  }
  photoResponse(token: string, request: Request): Response {
    const peer = this.peer
    return peer && this.has(peer.selection.uid) && peer.value.status === 'ready' && peer.value.visibility === 'visible'
      ? peer.photo.response(token, request) : new Response(null, { status: 403 })
  }
  async close(): Promise<void> {
    this.closed = true; this.connected = false; this.selection = null; this.jobAbort?.abort(); this.invalidate()
    try { await this.job } catch { /* the saving caller receives its error */ }
    this.profileNames.close(); await this.listAvatars.close(); await this.personalPhotos.close(); this.unavailablePhotos.clear()
    this.labels.clear(); this.removedVersions.clear()
  }
}
