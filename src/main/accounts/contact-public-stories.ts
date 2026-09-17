import type { ContactStoryReactionTarget } from '../../shared/contact-story-reaction'
import { firstStoryCaptionLink } from '../../shared/story-caption-link'
import type { ContactPublicStoryLinkRequest } from '../../shared/contact-public-story-link'
import type { ContactPublicStoryAudioRequest } from '../../shared/contact-public-story-audio'
import type { ContactPublicStoryVideoRequest } from '../../shared/contact-public-story-video'
import type { ContactPublicStoryPhotoRequest } from '../../shared/contact-public-story-photo'
import type { OwnStoryDetail } from '../../shared/own-stories'
import { contactPublicStoriesPageRequest, type ContactPublicStoriesPageRequest, contactPublicStoriesRequest, type ContactPublicStoriesRequest, type ContactPublicStoriesResult } from '../../shared/contact-public-stories'
import { positionAt, positionMilliseconds, type MessagePosition } from '../../shared/model'
import { FirestoreReader, type ReadCredentials } from '../network/firestore-rpc'
import { documents, positionValue } from '../network/firestore-values'
import { ownStoryFromDocument } from '../network/own-story-document'
import { storyHiddenFrom } from '../network/story-hidden-audience'
import { tr } from '../../shared/i18n'
interface Cursor { expires: MessagePosition; created: MessagePosition }
const compareCursor = (a: Cursor, b: Cursor): number => a.expires.seconds - b.expires.seconds || a.expires.nanoseconds - b.expires.nanoseconds || a.created.seconds - b.created.seconds || a.created.nanoseconds - b.created.nanoseconds || Buffer.compare(Buffer.from(a.created.id), Buffer.from(b.created.id))
export class ContactPublicStories {
  private closed = false
  private pageState: { request: ContactPublicStoriesRequest; uid: string; cursor: Cursor | null; history: (Cursor | null)[]; next: Cursor | null; number: number; deadline: number; visible: Map<string, OwnStoryDetail>; links: Map<string, string> } | null = null
  private pageTimer: ReturnType<typeof setTimeout> | null = null
  private owner: { id: string; abort: AbortController; reader: FirestoreReader; validate(): void } | null = null
  private readonly jobs = new Set<Promise<ContactPublicStoriesResult>>()
  constructor(private readonly uid: string, private readonly auth: ReadCredentials, private readonly source: (request: ContactPublicStoriesRequest) => { uid: string; displayName: string }) {}
  pause(): void { this.pageState = null; if (this.pageTimer) clearTimeout(this.pageTimer); this.pageTimer = null; const owner = this.owner; this.owner = null; owner?.abort.abort(); owner?.reader.close() }
  prune(): void { try { this.owner?.validate(); if (this.pageState && (Date.now() >= this.pageState.deadline || this.source(this.pageState.request).uid !== this.pageState.uid)) this.pause() } catch { this.pause() } }
  dismiss(id: string): void { if (this.owner?.id === id || this.pageState?.request.id === id) this.pause() }
  async close(): Promise<void> { this.closed = true; this.pause(); await Promise.allSettled([...this.jobs]) }
  reactionSource(request: ContactStoryReactionTarget): { ownerId: string; expiresAt: number } {
    const current = this.pageState, story = current?.visible.get(request.storyId)
    if (this.closed || this.auth.signal.aborted || this.owner || !current || Date.now() >= current.deadline || current.request.id !== request.requestId || current.request.profileRequestId !== request.profileRequestId || request.privacy !== 'everyone' || request.audienceId !== null || this.source(current.request).uid !== current.uid || !story || story.version !== request.version || story.privacy !== request.privacy || positionMilliseconds(story.expires) <= Date.now()) throw new Error(tr('현재 스토리 구간에서 본인의 반응을 다시 확인해 주세요.'))
    return { ownerId: current.uid, expiresAt: Math.min(current.deadline, positionMilliseconds(story.expires)) }
  }
  linkSource(request: ContactPublicStoryLinkRequest): string {
    const current = this.pageState, story = current?.visible.get(request.storyId), url = current?.links.get(request.storyId)
    if (this.closed || this.auth.signal.aborted || this.owner || !current || Date.now() >= current.deadline || current.request.id !== request.requestId || current.request.profileRequestId !== request.profileRequestId || this.source(current.request).uid !== current.uid || !story || story.version !== request.version || positionMilliseconds(story.expires) <= Date.now() || !url || url !== request.url) throw new Error(tr('현재 공개 구간에서 설명과 전체 웹 주소를 다시 확인해 주세요.'))
    return url
  }
  audioSource(request: ContactPublicStoryAudioRequest): { ownerId: string; story: OwnStoryDetail } {
    const current = this.pageState, story = current?.visible.get(request.storyId)
    if (this.closed || this.owner || !current || Date.now() >= current.deadline || current.request.id !== request.requestId || current.request.profileRequestId !== request.profileRequestId || this.source(current.request).uid !== current.uid || !story || story.version !== request.version || !['image', 'video'].includes(story.mediaType) || story.audio !== 'attached' || positionMilliseconds(story.expires) <= Date.now()) throw new Error(tr('현재 공개 스토리의 첨부 오디오를 다시 선택해 주세요.'))
    return { ownerId: current.uid, story: { ...story, created: { ...story.created }, expires: { ...story.expires } } }
  }
  videoSource(request: ContactPublicStoryVideoRequest): { ownerId: string; story: OwnStoryDetail } {
    const current = this.pageState, story = current?.visible.get(request.storyId)
    if (this.closed || this.owner || !current || Date.now() >= current.deadline || current.request.id !== request.requestId || current.request.profileRequestId !== request.profileRequestId || this.source(current.request).uid !== current.uid || !story || story.version !== request.version || story.mediaType !== 'video' || story.audio !== (request.mode === 'with-audio' ? 'attached' : 'none') || positionMilliseconds(story.expires) <= Date.now()) throw new Error(tr('현재 공개 영상과 오디오 구성를 다시 선택해 주세요.'))
    return { ownerId: current.uid, story: { ...story, created: { ...story.created }, expires: { ...story.expires } } }
  }
  photoSource(request: ContactPublicStoryPhotoRequest): { ownerId: string; story: OwnStoryDetail } {
    const current = this.pageState, story = current?.visible.get(request.storyId)
    if (this.closed || this.owner || !current || Date.now() >= current.deadline || current.request.id !== request.requestId || current.request.profileRequestId !== request.profileRequestId || this.source(current.request).uid !== current.uid || !story || story.version !== request.version || story.mediaType !== (request.presentation === 'video-poster' ? 'video' : 'image') || (request.presentation === 'video-poster' && !story.hasThumbnail) || positionMilliseconds(story.expires) <= Date.now()) throw new Error(tr('현재 공개 스토리 구간에서 사진을 다시 선택해 주세요.'))
    return { ownerId: current.uid, story: { ...story, created: { ...story.created }, expires: { ...story.expires } } }
  }
  read(input: ContactPublicStoriesRequest): Promise<ContactPublicStoriesResult> { return this.readPage(contactPublicStoriesRequest(input), null, [], 1) }
  page(input: ContactPublicStoriesPageRequest): Promise<ContactPublicStoriesResult> {
    const request = contactPublicStoriesPageRequest(input), current = this.pageState
    if (this.closed || this.owner || !current || current.request.id !== request.previousId || current.request.profileRequestId !== request.profileRequestId || Date.now() >= current.deadline || this.source(current.request).uid !== current.uid) throw new Error(tr('현재 스토리 구간의 표시 시간이 지났거나 연락처가 변경되었습니다. 처음부터 다시 조회해 주세요.'))
    const nextRequest = { id: request.id, profileRequestId: request.profileRequestId }
    if (request.direction === 'previous') {
      if (!current.history.length) throw new Error(tr('보관된 이전 구간 위치가 없습니다.'))
      const history = current.history.slice(), cursor = history.pop()!
      return this.readPage(nextRequest, cursor, history, current.number - 1)
    }
    if (!current.next || !Number.isSafeInteger(current.number + 1)) throw new Error(tr('다음 구간 위치가 없습니다.'))
    return this.readPage(nextRequest, current.next, [...current.history, current.cursor].slice(-50), current.number + 1)
  }
  private readPage(request: ContactPublicStoriesRequest, cursor: Cursor | null, history: (Cursor | null)[], pageNumber: number): Promise<ContactPublicStoriesResult> {
    if (this.closed || this.jobs.size >= 4) throw new Error(tr('현재 계정과 진행 중인 스토리 조회를 확인해 주세요.'))
    this.auth.signal.throwIfAborted(); const peer = this.source(request)
    if (peer.uid === this.uid) throw new Error(tr('본인 스토리는 내 스토리에서 확인해 주세요.'))
    this.pause()
    const owner = { id: request.id, abort: new AbortController(), reader: new FirestoreReader(this.auth), validate: () => {} }; this.owner = owner
    const signal = AbortSignal.any([owner.abort.signal, this.auth.signal, AbortSignal.timeout(35000)]), cutoff = Date.now()
    const validate = (): void => { if (this.closed || this.owner !== owner) throw new Error(tr('연락처 스토리 조회가 변경되었습니다.')); signal.throwIfAborted(); if (this.source(request).uid !== peer.uid) throw new Error(tr('연락처가 변경되었습니다.')) }
    owner.validate = validate
    const task = Promise.resolve().then(async (): Promise<ContactPublicStoriesResult> => {
      let result: Pick<ContactPublicStoriesResult, 'outcome' | 'rows' | 'limited' | 'message' | 'page'>
      try {
        validate()
        const docs = await owner.reader.query(`${documents}/users/${peer.uid}`, { from: [{ collectionId: 'publicStories' }], where: { fieldFilter: { field: { fieldPath: 'expiresAt' }, op: 'GREATER_THAN', value: positionValue(positionAt(cutoff, '')) } }, orderBy: [{ field: { fieldPath: 'expiresAt' }, direction: 'ASCENDING' }, { field: { fieldPath: 'createdAt' }, direction: 'ASCENDING' }, { field: { fieldPath: '__name__' }, direction: 'ASCENDING' }], limit: { value: 51 }, ...(cursor ? { startAt: { before: false, values: [positionValue(cursor.expires), positionValue(cursor.created), { referenceValue: `${documents}/users/${peer.uid}/publicStories/${cursor.created.id}` }] } } : {}) }, signal)
        validate()
        if (docs.length > 51 || docs.reduce((sum, doc) => sum + JSON.stringify(doc).length, 0) > 4 * 1024 * 1024) throw new Error('Contact public stories limit exceeded')
        // Validate all rows before exposing any caption, including the pagination sentinel.
        const parsed = docs.map(doc => ({ story: ownStoryFromDocument(doc, peer.uid, 'everyone'), hidden: storyHiddenFrom(doc).hiddenFrom.includes(this.uid) }))
        if (new Set(parsed.map(item => item.story.id)).size !== parsed.length || parsed.some(item => positionMilliseconds(item.story.expires) <= cutoff)) throw new Error('Unexpected public story query result')
        parsed.sort((a, b) => compareCursor(a.story, b.story))
        if (cursor && parsed.some(item => compareCursor(item.story, cursor) <= 0)) throw new Error('Story outside page cursor')
        const boundary = parsed.length > 50 ? parsed[49]?.story : null
        if (parsed.length > 50 && !boundary) throw new Error('Missing story page boundary')
        const next = boundary ? { expires: { ...boundary.expires }, created: { ...boundary.created } } : null
        const now = Date.now()
        const rows = parsed.slice(0, 50).filter(item => !item.hidden && positionMilliseconds(item.story.expires) > now).map(({ story }) => ({ audio: story.audio, hasThumbnail: story.hasThumbnail, id: story.id, version: story.version, caption: story.caption, mediaType: story.mediaType, createdAt: positionMilliseconds(story.created), expiresAt: positionMilliseconds(story.expires) })).sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        this.pageState = { request, uid: peer.uid, cursor, history, next, number: pageNumber, links: new Map(rows.flatMap(row => { const url = firstStoryCaptionLink(row.caption); return url ? [[row.id, url] as const] : [] })), visible: new Map(parsed.slice(0, 50).filter(item => !item.hidden && positionMilliseconds(item.story.expires) > now).map(({ story }) => [story.id, { ...story, caption: '', preview: '' }])), deadline: Math.min(Date.now() + 30000, ...rows.map(row => row.expiresAt)) }
        this.pageTimer = setTimeout(() => { this.pageState = null; this.pageTimer = null }, Math.max(1, this.pageState.deadline - Date.now()))
        result = { page: { number: pageNumber, canPrevious: history.length > 0, canNext: Boolean(next) }, outcome: 'ready', rows, limited: parsed.length > 50, message: tr('조회 시점에 이 연락처가 전체 공개로 게시한 스토리의 설명입니다. 숨김 대상과 만료를 확인하며 이후 변경을 실시간으로 조회하지 않습니다.') }
      } catch { validate(); result = { page: { number: pageNumber, canPrevious: false, canNext: false }, outcome: 'unavailable', rows: [], limited: false, message: tr('공개 스토리의 접근 범위·형식·조회 결과를 확인하지 못했습니다. 빈 목록이나 일부 성공으로 표시하지 않습니다.') } }
      validate()
      return { ...request, ...result, ownerId: peer.uid, ownerName: peer.displayName, observedAt: Date.now() }
    }).finally(() => { if (this.owner === owner) this.owner = null; owner.abort.abort(); owner.reader.close(); this.jobs.delete(task) })
    this.jobs.add(task); return task
  }
}
