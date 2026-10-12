import type { ContactProfileSnapshot, ContactSummary, ContactsSnapshot, ContactMutationSnapshot } from '../../shared/contacts'
import { contactDeleteGraceMs } from '../../shared/contacts'
import { performance } from 'node:perf_hooks'
import { randomUUID } from 'node:crypto'
import type { ContactDetails, ContactDetailsEdit, ContactDetailsSnapshot } from '../../shared/contact-details'
import type { ContactDetailsCommand } from '../storage/contact-details-table'
import { ContactWriteFailure, FirestoreReader, type ReadCredentials } from '../network/firestore-rpc'
import type { ParticipantAddResult } from '../../shared/participants'
import { boolField, childId, documents, documentVersion, stringField, type FirestoreDocument } from '../network/firestore-values'
import { ProfilePhoto } from './profile-photo'
import { ContactAvatars } from './contact-avatars'
import { ContactPhotos } from './contact-photos'
import { contactNames, officialKind, PeerProfiles, photoPrivacyOf, publicProfilePath, registerPeerProfiles } from './peer-profiles'
import { photoVisible } from '../../shared/profile-photo'
import { ContactNamesSync } from './contact-names-sync'
import { userpicCacheFor } from './userpic-cache'
import { personalChannelIdField } from './personal-channel'
import type { ContactPhotoCommand } from '../storage/contact-photo-table'
import { maxContactPhotoStorage, type ContactPhotoBinding, type ContactPhotoEdit, type ContactPhotoStorage, type ContactPhotoRemoval } from '../../shared/contact-photo'
import type { BackgroundPhotoOwner } from '../platform/background-photos'
import { DeliveryCommandFailure, uncertainDeliveryCodes } from '../storage/delivery-client'
import { recordContactStep } from '../platform/contact-diagnostics'
import { locale, tr } from '../../shared/i18n'

// hint: the name the screen that opened the person already shows, for when no public profile can be read.
interface Selection { uid: string; requestId: string; hint: string }
interface DeleteGrace { id: string; uid: string; version: string; deadline: number; finish(reason: string | null): void }
interface Peer {
  selection: Selection
  value: ContactProfileSnapshot
  photo: ProfilePhoto
  local: ContactDetailsSnapshot
  // The last answer of the profile watch, kept so the profile is drawn again when the person joins or leaves the
  // contacts (what is shown depends on both), and the public fields a contact made from this profile is saved with.
  read: { rows: Map<string, FirestoreDocument> } | { failed: true } | null
  stop(): void
}
const noPhoto = (): ContactProfileSnapshot['photo'] => ({ url: null, status: 'none', message: '' })
const noLocal = (): ContactDetailsSnapshot => ({ status: 'loading', nickname: '', note: '', version: '' })
function emptyProfile(selection: Selection, status: ContactProfileSnapshot['status'], message = ''): ContactProfileSnapshot {
  return { uid: selection.uid, requestId: selection.requestId, status, contact: false, displayName: '', originalName: '', contactVersion: '', local: noLocal(), personalPhoto: { status: 'loading', version: '', photoId: null }, visibility: 'unknown', photoShown: false, userId: '', bio: '', personalChannelId: '', message, photo: noPhoto() }
}

// Contact membership comes from the owner's collection. Only an explicitly
// selected, current member gets profile and reciprocal-membership subscriptions.
let watchSteps = 0
export type PeopleSurface = import('../../shared/model').PeopleSurface
export const peopleSurfaces: readonly PeopleSurface[] = ['members', 'blocked', 'lookup', 'profile', 'subscribers']
const maxShownPeople = 200
type OfficialKind = import('../../shared/model').OfficialKind

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
  // People this account talks with outside its contacts — the other side of each 1:1 chat — whose public names the
  // chat list also needs (B48).
  private extraPeers: string[] = []
  // B178 §2-5: people a screen shows on rows of its own (group members on screen, the blocked list, a Morse ID lookup),
  // read with the same public-profile reader for their official mark only while they are shown.
  private shown = new Map<PeopleSurface, string[]>()
  private names = 0
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
  // A11: the saved names and notes, kept the same as the server's users/{me}/contactNames.
  private readonly nameSync: ContactNamesSync
  // B266: the people being added from their profile, one save each at a time.
  private readonly profileAdds = new Map<string, Promise<ParticipantAddResult>>()

  constructor(private readonly uid: string, private readonly auth: ReadCredentials, private readonly changed: () => void,
    private readonly store: <T>(command: ContactDetailsCommand | ContactPhotoCommand, validate?: () => void) => Promise<T>,
    // The picture a person has now, for the album this device keeps of that person (ProfilePhotoHistory).
    seen: (uid: string, raw: string) => void = () => {},
    // The reads, over Firestore; a test gives its own.
    private readonly openReader: () => FirestoreReader = () => new FirestoreReader(auth)) {
    this.profileNames = new PeerProfiles(uid, auth, auth.signal, () => { if (!this.closed) { this.order(); this.publish() } }, seen, 'contacts', person => this.has(person))
    this.nameSync = new ContactNamesSync(uid, command => store(command), () => this.namesMerged())
    registerPeerProfiles(auth, this.profileNames)
    this.personalPhotos = new ContactPhotos(store, uid => this.connected && !this.auth.signal.aborted && this.has(uid) && !this.unavailablePhotos.has(uid), () => this.publish())
    this.listAvatars = new ContactAvatars(uid, auth, peerUid => {
      if (!this.connected || !this.reader || !this.has(peerUid)) throw new Error(tr('현재 연락처를 확인해 주세요.'))
      return { uid: peerUid, reader: this.reader, personalURL: this.personalPhotos.url(peerUid), contact: true }
    }, async (raw, request) => {
      const url = new URL(raw), prefix = '/__contact-personal/'
      if (url.protocol !== 'morse:' || url.hostname !== 'app' || !url.pathname.startsWith(prefix) || url.search || url.hash || url.port || url.username || url.password) return new Response(null, { status: 403 })
      return this.personalPhotos.response(url.pathname.slice(prefix.length), request)
    }, () => { if (!this.closed) this.changed() })
  }
  get snapshot(): ContactsSnapshot {
    const peer = this.peer, doc = peer ? this.contactDocs.get(peer.selection.uid) : undefined
    const contact = peer ? this.has(peer.selection.uid) : false
    const personalURL = contact && peer?.value.status === 'ready' ? this.personalPhotos.url(peer.selection.uid) : null
    const profile = peer ? { ...peer.value, contact,
      displayName: peer.value.status === 'ready' ? (contact && peer.local.nickname) || peer.value.displayName : '', originalName: peer.value.displayName,
      contactVersion: doc ? documentVersion(doc) : '', local: contact && peer.value.status === 'ready' ? { ...peer.local } : noLocal(),
      personalPhoto: contact && peer.value.status === 'ready' ? this.personalPhotos.snapshot(peer.selection.uid) : { status: 'loading' as const, version: '', photoId: null },
      photo: personalURL ? { url: personalURL, status: 'ready' as const, message: '' } : peer.value.status === 'ready' && peer.value.photoShown ? peer.photo.snapshot : noPhoto() }
      : this.selection ? emptyProfile(this.selection, this.status === 'ready' ? 'unavailable' : this.status,
        this.status === 'ready' ? tr('이 사용자를 확인할 수 없습니다.') : this.message) : null
    return { status: this.status, message: this.message,
      items: this.ordered.map(item => ({ ...item, personalPhotoURL: this.personalPhotos.url(item.uid), avatar: this.listAvatars.snapshot(item.uid), ...(this.profileNames.official(item.uid) ? { official: this.profileNames.official(item.uid)! } : {}) })), personalPhotosStatus: this.personalPhotos.status,
      marks: this.shownMarks(),
      profile, mutation: this.mutation ? { ...this.mutation, undo: this.deleteGrace ? {
        operationId: this.deleteGrace.id, remainingMs: Math.max(0, this.deleteGrace.deadline - performance.now())
      } : null } : null }
  }
  private shownMarks(): Record<string, OfficialKind> {
    const marks: Record<string, OfficialKind> = {}
    if (this.closed || this.locked) return marks
    for (const uid of new Set([...this.shown.values()].flat())) { const kind = this.profileNames.official(uid); if (kind) marks[uid] = kind }
    return marks
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
  // B266 — a profile's «메시지 보내기», for anyone opened (iOS ContactProfileView.openChat ProfileView.swift:1052-1068,
  // Android prepareChat AccountContactsController.kt:431-523: no contact needed). A withdrawn account, a profile not
  // read and this account itself are refused; the caller refuses a person this account blocked.
  chatPeer(requestId: string): { uid: string; displayName: string } {
    const peer = this.peer
    if (peer && this.has(peer.selection.uid)) return this.directPeer(requestId)
    if (!peer || peer.selection.requestId !== requestId || !this.ready || peer.selection.uid === this.uid || peer.value.status !== 'ready' || !peer.value.displayName) throw new Error(tr('최신 프로필을 다시 선택해 주세요.'))
    return { uid: peer.selection.uid, displayName: peer.value.displayName }
  }
  // B266 — «연락처에 추가» from a person's profile (tdesktop makeAddAsContact, info_profile_actions.cpp:2340-2361): the
  // public profile just read names them. Its picture goes with them only when this account may see it (B153).
  profileContact(requestId: string): import('../network/contact-lookup').PublicContact {
    const peer = this.peer, read = peer?.read, doc = read && 'rows' in read ? read.rows.get(publicProfilePath(peer!.selection.uid)) : undefined
    if (!peer || peer.selection.requestId !== requestId || !this.ready || peer.selection.uid === this.uid || peer.value.status !== 'ready' || !doc || !peer.value.displayName) throw new Error(tr('최신 프로필을 다시 선택해 주세요.'))
    if (this.has(peer.selection.uid)) throw new Error(tr('이미 연락처에 있습니다.'))
    return { uid: peer.selection.uid, userId: stringField(doc.fields, 'userId', 160), displayName: peer.value.displayName,
      photoURL: peer.value.photoShown ? stringField(doc.fields, 'photoURL', 10000) : '' }
  }
  // The save itself: the contact document made once (it is never overwritten — an existing one is reported as such),
  // then the list's own watch brings the person in, and the open profile is drawn again as a contact's.
  addFromProfile(requestId: string): Promise<ParticipantAddResult> {
    const fields = this.profileContact(requestId), running = this.profileAdds.get(fields.uid)
    if (running) return running
    const task = (async (): Promise<ParticipantAddResult> => {
      const reader = this.openReader()
      try {
        const outcome = await reader.addContact(this.uid, fields, this.auth.signal)
        recordContactStep(`profile-${outcome}`)
        return { outcome, message: outcome === 'added' ? tr('내 연락처에 추가했습니다.') : tr('이미 저장된 연락처입니다. 기존 연락처 정보는 유지했습니다.') }
      } catch (error) {
        const uncertain = error instanceof ContactWriteFailure && error.uncertain
        recordContactStep(uncertain ? 'profile-uncertain' : 'profile-rejected')
        return { outcome: uncertain ? 'uncertain' : 'rejected', message: uncertain ? tr('저장 결과를 확인하지 못했습니다. 자동으로 다시 추가하지 않습니다. 연락처 목록을 확인해 주세요.') : tr('연락처를 추가하지 못했습니다. 연결을 확인해 주세요.') }
      } finally { reader.close() }
    })().finally(() => { if (this.profileAdds.get(fields.uid) === task) this.profileAdds.delete(fields.uid) })
    this.profileAdds.set(fields.uid, task)
    return task
  }
  // The server's saved names are this device's copy now (A11): the labels, and an open profile's name and note.
  private namesMerged(): void {
    if (this.closed) return
    const generation = this.generation
    void this.store<{ uid: string; nickname: string }[]>({ kind: 'contact-labels' }).then(rows => {
      if (this.closed || generation !== this.generation) return
      this.labels = new Map(rows.map(row => [row.uid, row.nickname])); this.order(); this.publish()
    }).catch(() => {})
    const peer = this.peer
    if (peer && !this.job && this.has(peer.selection.uid)) void this.store<ContactDetails>({ kind: 'contact-details', uid: peer.selection.uid }).then(value => {
      if (this.peer === peer && !this.job) { peer.local = { ...value, status: 'ready' }; this.publish() }
    }).catch(() => {})
  }
  private publish(): void { if (!this.closed) { this.listAvatars?.prune(); this.changed() } }
  private nameOf(item: ContactSummary): string { return contactNames(item, this.labels.get(item.uid), this.profileNames.name(item.uid)).displayName }
  // Telegram R-60 / A11 §4: one name for a person on every screen — a withdrawn account is «탈퇴한 계정»; otherwise the
  // name this account saved, then the person's public profile. '' when neither is known: the caller keeps its copy.
  personName(uid: string): string {
    if (this.closed || this.locked) return ''
    if (this.profileNames.withdrawn(uid)) return tr('탈퇴한 계정')
    return this.labels.get(uid) || this.profileNames.name(uid)
  }
  // B266/B153 §4: the picture this account may show of one of its contacts (the mutual rule, read with the list);
  // undefined for a person who is not a contact, whom the caller draws by what they show to everyone.
  // Before an answer (opening, a refused read, offline): the last answer remembered, else none (B153 §4).
  contactPhoto(uid: string): string | undefined {
    if (!this.has(uid)) return undefined
    return this.profileNames.hasAnswer(uid) ? this.profileNames.photo(uid) : this.profileNames.remembered(uid)
  }
  // B277: whether a person lists this account as a contact, from the contacts' own watch; null while not answered.
  keepsMe(uid: string): boolean | null { return this.closed || this.locked ? null : this.profileNames.keeps(uid) }
  // A13 §9-2: the server's mark on the support account, read with the person's public profile.
  personOfficial(uid: string): import('../../shared/model').OfficialKind | null { return this.closed || this.locked ? null : this.profileNames.official(uid) }
  // Bumped whenever a name personName gives may have changed.
  get namesRevision(): number { return this.names }
  followPeers(uids: Iterable<string>): void {
    const next = [...new Set(uids)].filter(uid => uid !== this.uid).sort()
    if (next.join('\n') === this.extraPeers.join('\n')) return
    this.extraPeers = next
    this.bindPeople()
  }
  showPeople(surface: PeopleSurface, uids: Iterable<string>): void {
    const next = [...new Set(uids)].filter(uid => uid !== this.uid).sort().slice(0, maxShownPeople)
    if (next.join('\n') === (this.shown.get(surface) ?? []).join('\n')) return
    if (next.length) this.shown.set(surface, next); else this.shown.delete(surface)
    this.bindPeople()
  }
  // `loading`: the list's own answer, which binds before the list is marked ready (as it always did).
  private bindPeople(loading = false): void {
    if (this.reader && (loading || this.status === 'ready')) this.profileNames.bind(this.reader, [...this.items.keys(), ...this.extraPeers, ...[...this.shown.values()].flat()])
  }
  private order(): void {
    this.names++
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
    this.nameSync.bind(null, this.auth.signal)
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
      const reader = this.openReader(); this.reader = reader
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
            this.items = next; this.bindPeople(true); this.order()
            this.status = 'ready'; this.message = ''; this.syncPeer(); this.redrawPeer()
            // B266 ⑥: who is a contact decides who is mutual — the same answers, decided again.
            this.profileNames.recheck(); this.publish()
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
      this.nameSync.bind(reader, this.auth.signal)
    } catch {
      this.invalidate(); this.status = 'error'; this.message = tr('연락처 연결을 준비하지 못했습니다. 다시 불러와 주세요.'); this.publish()
    }
  }
  // B266: anyone this account meets can be opened, as tdesktop's showPeerInfo opens any user (window_session_controller.cpp
  // :2846-2847); the public profile is readable by every signed-in account (firestore.rules publicProfiles get).
  open(uid: string, requestId: string, hint = ''): void {
    if (!this.ready) throw new Error(tr('연락처 목록을 불러온 뒤 다시 선택해 주세요.'))
    if (uid === this.uid) throw new Error(tr('사용자를 다시 선택해 주세요.'))
    if (this.job && this.selection?.requestId !== requestId) throw new Error(tr('진행 중인 연락처 저장을 확인해 주세요.'))
    this.stopPeer(); this.selection = { uid, requestId, hint: hint.trim().slice(0, 512) }; this.syncPeer(); this.publish()
  }
  closeProfile(requestId: string): void {
    if (this.selection?.requestId !== requestId) return
    this.selection = null; this.stopPeer(); this.publish()
  }
  private syncPeer(): void {
    const selection = this.selection, reader = this.reader
    if (!selection || !reader || !this.ready || selection.uid === this.uid) { this.stopPeer(); return }
    if (this.peer?.selection === selection) return
    this.stopPeer()
    const peer: Peer = { selection, value: emptyProfile(selection, 'loading'), local: noLocal(), read: null, stop: () => {},
      photo: new ProfilePhoto(selection.uid, this.auth, () => { if (this.peer === peer) this.publish() }, '__contact-photo') }
    this.peer = peer
    // The picture last confirmed for this person is read ahead, so the profile opens with it when the server agrees.
    const cache = userpicCacheFor(this.auth), known = cache?.known(`user:${selection.uid}`)
    if (known) void peer.photo.select(known).catch(() => {})
    this.loadLocal(peer)
    const root = publicProfilePath(selection.uid), reciprocal = `${documents}/users/${selection.uid}/contacts/${this.uid}`
    const current = (): boolean => this.peer === peer && this.ready
    peer.stop = reader.watch({ documents: { documents: [root, reciprocal] } }, this.auth.signal, {
      snapshot: rows => {
        if (!current()) return
        peer.read = [...rows.keys()].some(name => name !== root && name !== reciprocal) ? { failed: true } : { rows }
        this.drawPeer(peer); this.publish()
      },
      state: (state, error) => {
        if (!current()) return
        // Opening a story waits for this profile; the step and the try it happened on say whether the wait timed out.
        recordContactStep('profile-watch', `${state} ${++watchSteps}`)
        if (state === 'ready') return
        if (state === 'error') { peer.read = { failed: true }; this.drawPeer(peer); this.publish(); return }
        this.cancelDeleteGrace(tr('프로필 연결이 변경되어 삭제 대기를 취소했습니다. 이 요청은 서버에 보내지 않았습니다.'))
        peer.read = null; peer.photo.clear(); peer.value = emptyProfile(selection, 'loading', error ? tr('프로필을 불러오지 못했습니다. 연결과 연락처 관계를 확인해 주세요.') : '')
        this.publish()
      }
    }, 2, 2 * 1024 * 1024)
  }
  // The note and name this account keeps for a contact; a person who is not one has none.
  private loadLocal(peer: Peer): void {
    if (!this.has(peer.selection.uid)) { peer.local = { ...noLocal(), status: 'ready' }; return }
    peer.local = noLocal()
    void this.store<ContactDetails>({ kind: 'contact-details', uid: peer.selection.uid }).then(value => {
      if (this.peer === peer) { peer.local = { ...value, status: 'ready' }; this.publish() }
    }).catch(() => { if (this.peer === peer) { peer.local = { ...noLocal(), status: 'error' }; this.publish() } })
  }
  // The open person joined or left the contacts: the same profile, drawn again for what that changes (mutual, note).
  private redrawPeer(): void {
    const peer = this.peer
    if (!peer) return
    const contact = this.has(peer.selection.uid), had = peer.local.status !== 'loading' && peer.value.contact
    if (contact !== had) this.loadLocal(peer)
    this.drawPeer(peer)
  }
  // What the profile shows, from the last answer of its watch: the public profile and whether the person keeps this
  // account as a contact. Mutual contacts open the @id, the bio and the linked channel (A7 §3-1: both ways — this
  // account's contact, and the reciprocal entry); the picture follows its own rule (B153). An official account has no
  // @id line — Telegram draws a username only where there is one to show, and its service account none (B153 §4).
  private drawPeer(peer: Peer): void {
    const selection = peer.selection, read = peer.read, contact = this.has(selection.uid)
    if (!read) return
    const cache = userpicCacheFor(this.auth)
    // No public profile to read (not made yet, refused, unreadable): a contact opens with the name it was saved under,
    // anyone else with the name the screen that opened them shows — and with everything that needs no profile. Nothing
    // the public profile would show is guessed.
    // B153 §4: the picture is the last answer remembered for this account, or none.
    const fallback = (): void => {
      this.unavailablePhotos.delete(selection.uid)
      const item = this.items.get(selection.uid), remembered = cache?.known(`user:${selection.uid}`) ?? ''
      if (remembered) void peer.photo.select(remembered).catch(() => {}); else peer.photo.clear()
      peer.value = { ...emptyProfile(selection, 'ready'), contact, displayName: this.profileNames.name(selection.uid) || item?.displayName || selection.hint, visibility: 'unknown', photoShown: Boolean(remembered) }
    }
    if ('failed' in read) { fallback(); return }
    try {
      const doc = read.rows.get(publicProfilePath(selection.uid))
      const displayName = doc ? stringField(doc.fields, 'displayName', 512).trim() : ''
      // A withdrawn account's public profile keeps nothing but accountDeleted (A7 §3-1), no name.
      if (doc && boolField(doc.fields, 'accountDeleted')) {
        if (contact) {
          this.cancelDeleteGrace(tr('상대 프로필을 확인할 수 없어 삭제 대기를 취소했습니다. 최신 연락처를 확인해 주세요.'))
          if (!this.unavailablePhotos.has(selection.uid)) { this.unavailablePhotos.add(selection.uid); this.personalPhotos.revoke() }
        }
        cache?.confirm(`user:${selection.uid}`, null)
        peer.photo.clear(); peer.value = { ...emptyProfile(selection, 'unavailable', tr('탈퇴했거나 현재 프로필을 확인할 수 없는 사용자입니다.')), contact }
      } else if (!doc || !displayName) fallback()
      else {
        this.unavailablePhotos.delete(selection.uid)
        const visible = contact && read.rows.has(`${documents}/users/${selection.uid}/contacts/${this.uid}`), official = officialKind(stringField(doc.fields, 'official', 32)) !== null
        const photoShown = photoVisible({ deleted: false, privacy: photoPrivacyOf(doc.fields), mutual: visible })
        peer.value = { ...emptyProfile(selection, 'ready'), contact, displayName, visibility: visible ? 'visible' : 'hidden', photoShown,
          userId: visible && !official ? stringField(doc.fields, 'userId', 160) : '', bio: visible ? stringField(doc.fields, 'bio', 500) : '',
          personalChannelId: visible ? personalChannelIdField(doc.fields) : '' }
        const raw = photoShown ? stringField(doc.fields, 'photoURL', 10000) : ''
        cache?.confirm(`user:${selection.uid}`, raw || null)
        if (photoShown) void peer.photo.select(raw); else peer.photo.clear()
      }
    } catch { fallback() }
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
        this.order(); this.nameSync.kick()
        if (this.peer === peer) peer.local = { ...value, status: 'ready' }
        result.outcome = 'saved'; result.message = tr('별칭과 개인 메모를 저장했습니다.')
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
    return peer && this.ready && peer.value.status === 'ready' && peer.value.photoShown
      ? peer.photo.response(token, request) : new Response(null, { status: 403 })
  }
  async close(): Promise<void> {
    this.closed = true; this.connected = false; this.selection = null; this.jobAbort?.abort(); this.invalidate(); this.nameSync.close()
    try { await this.job } catch { /* the saving caller receives its error */ }
    this.profileNames.close(); await this.listAvatars.close(); await this.personalPhotos.close(); this.unavailablePhotos.clear()
    this.labels.clear(); this.removedVersions.clear()
  }
}
