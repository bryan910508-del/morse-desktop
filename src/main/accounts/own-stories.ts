import { firstStoryCaptionLink, type StoryCaptionLinkRequest } from '../../shared/story-caption-link'
import type { StoryPrivacyMovePrepare } from '../../shared/story-privacy-move'
import type { StoryRemovalPrepare } from '../../shared/story-removal'
import type { StoryCaptionDraftStart, StoryCaptionDraft } from '../../shared/story-caption-drafts'
import { OwnStoryAudio } from './own-story-audio'
import type { OwnStoryAudioRequest } from '../../shared/own-story-audio'
import { OwnStoryVideo } from './own-story-video'
import type { OwnStoryVideoRequest } from '../../shared/own-story-video'
import { OwnStoryPhoto } from './own-story-photo'
import type { OwnStoryPhotoRequest } from '../../shared/own-story-photo'
import { ownStoryCollections, ownStoryFromDocument } from '../network/own-story-document'
import type { OwnStoriesRequest, OwnStoriesSnapshot, OwnStoryDetail, OwnStorySelection, OwnStoriesPageRequest } from '../../shared/own-stories'
import { type MessagePosition, comparePosition, positionAt, positionMilliseconds } from '../../shared/model'
import { FirestoreReader, type ReadCredentials } from '../network/firestore-rpc'
import { documents, positionValue } from '../network/firestore-values'
import { tr } from '../../shared/i18n'
interface StoryCursor { expires: MessagePosition; created: MessagePosition }
const compareStoryCursor = (a: StoryCursor, b: StoryCursor): number => a.expires.seconds - b.expires.seconds || a.expires.nanoseconds - b.expires.nanoseconds || comparePosition(a.created, b.created)
const cursorFor = (item: OwnStoryDetail): StoryCursor => ({ expires: { ...item.expires }, created: { ...item.created } })
const empty = (): OwnStoriesSnapshot => ({ view: 'list', page: { number: 1, canPrevious: false, next: null }, audio: null, video: null, photo: null, requestId: null, privacy: null, status: 'idle', rows: [], selected: null, limited: false, observedAt: null, message: '' })
export class OwnStories {
  private closed = false
  private owner: { request: OwnStoriesRequest; abort: AbortController; reader: FirestoreReader; cursor: StoryCursor | null; history: (StoryCursor | null)[]; pageNumber: number; boundary: { cursor: StoryCursor; storyId: string; version: string } | null } | null = null
  private readonly jobs = new Set<Promise<void>>()
  private items = new Map<string, OwnStoryDetail>()
  private selected: string | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private value = empty()
  readonly audio: OwnStoryAudio
  readonly video: OwnStoryVideo
  readonly photo: OwnStoryPhoto
  constructor(private readonly uid: string, private readonly auth: ReadCredentials, private readonly allowed: () => boolean, private readonly changed: () => void) { this.audio = new OwnStoryAudio(uid, auth, request => this.audioSource(request), changed); this.video = new OwnStoryVideo(uid, auth, request => this.videoSource(request), changed); this.photo = new OwnStoryPhoto(uid, auth, request => this.photoSource(request), changed) }
  private accessible(): boolean { return !this.closed && !this.auth.signal.aborted && this.allowed() }
  captionLinkSource(request: StoryCaptionLinkRequest): string {
    const current = this.captionDraftSource(request)
    const url = firstStoryCaptionLink(current.caption)
    if (!url || url !== request.url) throw new Error(tr('현재 불러온 설명의 링크가 변경되었습니다.'))
    return url
  }
  privacyMoveSource(target: StoryPrivacyMovePrepare): { caption: string; mediaType: 'image' | 'video'; expiresAt: number } {
    this.captionDraftSource(target)
    const item = this.items.get(target.storyId)!
    if (item.mediaType !== 'image' && item.mediaType !== 'video') throw new Error(tr('스토리 형식을 확인해야 공개 범위를 변경할 수 있습니다.'))
    return { caption: item.caption, mediaType: item.mediaType, expiresAt: positionMilliseconds(item.expires) }
  }
  removalSource(target: StoryRemovalPrepare): { caption: string; mediaType: 'image' | 'video' | 'unknown'; expiresAt: number } {
    this.captionDraftSource(target)
    const item = this.items.get(target.storyId)!
    return { caption: item.caption, mediaType: item.mediaType, expiresAt: positionMilliseconds(item.expires) }
  }
  captionDraftSource(target: StoryCaptionDraftStart): StoryCaptionDraft {
    const item = this.items.get(target.storyId)
    if (!this.accessible() || !this.owner || this.owner.abort.signal.aborted || this.owner.request.requestId !== target.requestId || this.value.status !== 'ready' || this.selected !== target.storyId || !item || item.privacy !== target.privacy || item.version !== target.version || positionMilliseconds(item.expires) <= Date.now()) throw new Error(tr('현재 내 스토리에서 설명 초안을 시작해 주세요.'))
    return { baseVersion: item.version, baseCaption: item.caption, caption: item.caption }
  }
  private audioSource(request: OwnStoryAudioRequest): OwnStoryDetail {
    const item = this.items.get(request.storyId)
    if (!this.accessible() || !this.owner || this.owner.abort.signal.aborted || this.owner.request.requestId !== request.requestId || this.value.status !== 'ready' || this.selected !== request.storyId || !item || item.version !== request.version || !['image', 'video'].includes(item.mediaType) || item.audio !== 'attached' || positionMilliseconds(item.expires) <= Date.now()) throw new Error(tr('현재 내 스토리의 첨부 오디오를 확인해 주세요.'))
    return item
  }
  loadAudio(request: OwnStoryAudioRequest): Promise<void> { this.audioSource(request); this.video.clear(); return this.audio.load(request) }
  private videoSource(request: OwnStoryVideoRequest): OwnStoryDetail {
    const item = this.items.get(request.storyId)
    if (!this.accessible() || !this.owner || this.owner.abort.signal.aborted || this.owner.request.requestId !== request.requestId || this.value.status !== 'ready' || this.selected !== request.storyId || !item || item.version !== request.version || item.mediaType !== 'video' || item.audio !== (request.mode === 'with-audio' ? 'attached' : 'none') || positionMilliseconds(item.expires) <= Date.now()) throw new Error(tr('현재 내 영상 스토리와 추가 오디오 구성을 확인해 주세요.'))
    return item
  }
  loadPhoto(request: OwnStoryPhotoRequest): Promise<void> { this.photoSource(request); this.video.clear(); return this.photo.load(request) }
  loadVideo(request: OwnStoryVideoRequest): Promise<void> { this.videoSource(request); this.audio.clear(); this.photo.clear(); return this.video.load(request) }
  private photoSource(request: OwnStoryPhotoRequest): OwnStoryDetail {
    const item = this.items.get(request.storyId)
    if (!this.accessible() || !this.owner || this.owner.abort.signal.aborted || this.owner.request.requestId !== request.requestId || this.value.status !== 'ready' || this.selected !== request.storyId || !item || item.version !== request.version || item.mediaType !== (request.presentation === 'video-poster' ? 'video' : 'image') || (request.presentation === 'video-poster' && !item.hasThumbnail) || positionMilliseconds(item.expires) <= Date.now()) throw new Error(tr('현재 스토리 사진 또는 영상 미리보기 선택이 변경되었습니다.'))
    return item
  }
  private publish(): void { this.audio.prune(); this.video.prune(); this.photo.prune(); if (!this.closed) this.changed() }
  get snapshot(): OwnStoriesSnapshot {
    if (!this.accessible()) return empty()
    const now = Date.now(), copy = (item: OwnStoryDetail): OwnStoryDetail => ({ ...item, created: { ...item.created }, expires: { ...item.expires } })
    const current = [...this.items.values()].filter(item => positionMilliseconds(item.expires) > now).sort((a, b) => comparePosition(a.created, b.created))
    const selected = current.find(item => item.id === this.selected)
    return { ...this.value, page: { ...this.value.page, next: this.value.page.next ? { ...this.value.page.next } : null }, audio: this.audio.snapshot, video: this.video.snapshot, photo: this.photo.snapshot, rows: current.map(item => { const { caption: _caption, ...row } = copy(item); return row }), selected: selected ? copy(selected) : null }
  }
  private expire(): void {
    if (this.timer) clearTimeout(this.timer); this.timer = null
    const now = Date.now()
    for (const [id, item] of this.items) if (positionMilliseconds(item.expires) <= now) this.items.delete(id)
    if (this.selected && !this.items.has(this.selected)) this.selected = null
    const next = Math.min(...[...this.items.values()].map(item => positionMilliseconds(item.expires)))
    if (Number.isFinite(next) && this.owner && this.accessible()) this.timer = setTimeout(() => { this.expire(); this.publish() }, Math.min(86400000, Math.max(1, next - Date.now() + 1)))
  }
  pause(): void {
    this.audio.clear(); this.video.clear(); this.photo.clear()
    const owner = this.owner; this.owner = null; owner?.abort.abort(); owner?.reader.close()
    if (this.timer) clearTimeout(this.timer); this.timer = null
    this.items.clear(); this.selected = null; this.value = empty(); this.publish()
  }
  dismiss(requestId: string): void { if (this.owner?.request.requestId === requestId) this.pause() }
  select(request: OwnStorySelection): void {
    if (!this.accessible() || !this.owner || this.owner.abort.signal.aborted || this.owner.request.requestId !== request.requestId || this.value.status !== 'ready') throw new Error(tr('현재 내 스토리 목록을 다시 읽어 주세요.'))
    const item = request.storyId ? this.items.get(request.storyId) : null
    if (request.storyId && (!item || item.version !== request.version || positionMilliseconds(item.expires) <= Date.now())) throw new Error(tr('스토리가 만료되었거나 목록이 변경되었습니다.'))
    if (this.selected !== request.storyId) { this.audio.clear(); this.video.clear(); this.photo.clear() }
    this.selected = request.storyId; this.publish()
  }
  openSingle(request: OwnStoriesRequest, storyId: string, validate: () => void): Promise<void> {
    if (!this.accessible() || this.jobs.size >= 4) throw new Error(tr('계정 연결과 진행 중인 스토리 조회를 확인해 주세요.'))
    validate(); this.pause()
    const owner = { request, abort: new AbortController(), reader: new FirestoreReader(this.auth), cursor: null, history: [], pageNumber: 1, boundary: null }; this.owner = owner
    this.value = { ...empty(), view: 'single', requestId: request.requestId, privacy: request.privacy, status: 'loading', message: tr('게시 기록의 원래 공개 범위에서 현재 스토리를 읽고 있습니다.') }
    const current = (): boolean => this.accessible() && this.owner === owner && !owner.abort.signal.aborted
    const signal = AbortSignal.any([owner.abort.signal, this.auth.signal, AbortSignal.timeout(35000)])
    const access = (): void => { signal.throwIfAborted(); if (!current()) throw new Error('Story view changed'); validate() }
    const task = Promise.resolve().then(async () => {
      access()
      const doc = await owner.reader.getDocument(`${documents}/users/${this.uid}/${ownStoryCollections[request.privacy]}/${storyId}`, signal, access)
      access()
      const item = doc ? ownStoryFromDocument(doc, this.uid, request.privacy) : null
      if (item && item.id !== storyId) throw new Error('Different story response')
      const valid = item && positionMilliseconds(item.expires) > Date.now() ? item : null
      this.items = new Map(valid ? [[valid.id, valid]] : []); this.selected = valid?.id ?? null
      this.value = { ...this.value, status: 'ready', observedAt: Date.now(), message: valid ? tr('원래 게시 범위의 현재 스토리를 읽었습니다. 게시 기록의 성공 응답을 대신하지 않으며 이후 상세 동작은 현재 읽은 버전을 사용합니다.') : item ? tr('현재 문서는 만료되었습니다. 게시 기록과 원래 초안은 변경하지 않습니다.') : tr('원래 게시 범위에 같은 ID 문서가 없습니다. 다른 공개 범위로 이동했는지나 과거 게시 결과는 추정하지 않습니다.') }
      this.expire()
    }).catch(() => {
      if (current()) { this.items.clear(); this.selected = null; this.value = { ...empty(), view: 'single', requestId: request.requestId, privacy: request.privacy, status: 'error', message: tr('현재 스토리의 접근 범위·형식·조회 결과를 확인하지 못했습니다. 게시 기록과 기기 초안은 변경하지 않습니다.') } }
    }).finally(() => { owner.reader.close(); this.jobs.delete(task); if (current()) this.publish() })
    this.jobs.add(task); this.publish(); return task
  }
  open(request: OwnStoriesRequest): Promise<void> { return this.openPage(request, null, [], 1) }
  page(request: OwnStoriesPageRequest): Promise<void> {
    const owner = this.owner
    if (!this.accessible() || !owner || owner.abort.signal.aborted || owner.request.requestId !== request.requestId || this.value.status !== 'ready') throw new Error(tr('현재 내 스토리 페이지를 다시 읽어 주세요.'))
    const next = { requestId: request.nextRequestId, privacy: owner.request.privacy }
    if (request.direction === 'previous') {
      if (!owner.history.length) throw new Error(tr('이전 페이지 위치가 없습니다. 처음부터 다시 읽어 주세요.'))
      const history = owner.history.slice(), cursor = history.pop()!
      return this.openPage(next, cursor, history, owner.pageNumber - 1)
    }
    const boundary = owner.boundary
    if (!this.value.limited || !boundary || boundary.storyId !== request.storyId || boundary.version !== request.version || !Number.isSafeInteger(owner.pageNumber + 1)) throw new Error(tr('현재 스토리 페이지 경계를 확인해 주세요.'))
    // Keep only immutable positions, including an expired boundary, not old page bodies.
    return this.openPage(next, boundary.cursor, [...owner.history, owner.cursor].slice(-50), owner.pageNumber + 1)
  }
  private openPage(request: OwnStoriesRequest, cursor: StoryCursor | null, history: (StoryCursor | null)[], pageNumber: number): Promise<void> {
    if (!this.accessible() || this.jobs.size >= 4) throw new Error(tr('계정 연결과 진행 중인 스토리 조회를 확인해 주세요.'))
    this.pause()
    const owner = { request, abort: new AbortController(), reader: new FirestoreReader(this.auth), cursor, history, pageNumber, boundary: null as { cursor: StoryCursor; storyId: string; version: string } | null }; this.owner = owner
    const page = { number: pageNumber, canPrevious: history.length > 0, next: null }
    this.value = { ...empty(), page, requestId: request.requestId, privacy: request.privacy, status: 'loading', message: tr('선택한 공개 범위의 내 스토리를 읽고 있습니다.') }
    const current = (): boolean => this.accessible() && this.owner === owner && !owner.abort.signal.aborted
    const signal = AbortSignal.any([owner.abort.signal, AbortSignal.timeout(35000)]), cutoff = Date.now()
    const task = Promise.resolve().then(async () => {
      const rows = await owner.reader.query(`${documents}/users/${this.uid}`, {
        from: [{ collectionId: ownStoryCollections[request.privacy] }], where: { fieldFilter: { field: { fieldPath: 'expiresAt' }, op: 'GREATER_THAN', value: positionValue(positionAt(cutoff, '')) } },
        orderBy: [{ field: { fieldPath: 'expiresAt' }, direction: 'ASCENDING' }, { field: { fieldPath: 'createdAt' }, direction: 'ASCENDING' }, { field: { fieldPath: '__name__' }, direction: 'ASCENDING' }], limit: { value: 51 },
        ...(cursor ? { startAt: { before: false, values: [positionValue(cursor.expires), positionValue(cursor.created), { referenceValue: `${documents}/users/${this.uid}/${ownStoryCollections[request.privacy]}/${cursor.created.id}` }] } } : {})
      }, signal)
      signal.throwIfAborted(); if (!current()) return
      if (rows.length > 51 || rows.reduce((n, doc) => n + JSON.stringify(doc).length, 0) > 4 * 1024 * 1024) throw new Error('Own story query limit')
      const parsed = rows.map(doc => ownStoryFromDocument(doc, this.uid, request.privacy))
      if (new Set(parsed.map(item => item.id)).size !== parsed.length || parsed.some(item => positionMilliseconds(item.expires) <= cutoff)) throw new Error('Invalid own story query result')
      if (cursor && parsed.some(item => compareStoryCursor(item, cursor) <= 0)) throw new Error('Story outside current page cursor')
      parsed.sort(compareStoryCursor)
      const boundary = parsed.length > 50 ? parsed[49] : null
      owner.boundary = boundary ? { cursor: cursorFor(boundary), storyId: boundary.id, version: boundary.version } : null
      this.items = new Map(parsed.slice(0, 50).map(item => [item.id, item]))
      this.value = { ...this.value, page: { ...page, next: boundary ? { storyId: boundary.id, version: boundary.version } : null }, status: 'ready', limited: parsed.length > 50, observedAt: Date.now(), message: tr('이번에 조회한 내 스토리입니다. 최신 변경은 다시 불러와 확인해 주세요.') }
      this.expire()
    }).catch(() => {
      if (current()) { this.items.clear(); this.selected = null; this.value = { ...empty(), page, requestId: request.requestId, privacy: request.privacy, status: 'error', message: tr('내 스토리의 접근 범위·형식·조회 결과를 확인하지 못했습니다. 빈 목록이나 일부 성공으로 판단하지 않습니다.') } }
    }).finally(() => { owner.reader.close(); this.jobs.delete(task); if (current()) this.publish() })
    this.jobs.add(task); this.publish(); return task
  }
  async close(): Promise<void> { this.closed = true; this.pause(); await Promise.allSettled([...this.jobs, this.photo.close(), this.video.close(), this.audio.close()]) }
}
