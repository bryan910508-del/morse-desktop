import { storyViewRecordsRequest, type StoryViewRecordsRequest, type StoryViewRecordsResult } from '../../shared/story-view-records'
import { positionMilliseconds } from '../../shared/model'
import { FirestoreReader, type ReadCredentials } from '../network/firestore-rpc'
import { documents, type FirestoreDocument } from '../network/firestore-values'
import { ownStoryCollections, ownStoryFromDocument } from '../network/own-story-document'
import { maxStoryViewRecords, storyViewRecords } from '../network/story-view-records'
import { tr } from '../../shared/i18n'
import { serverNow } from '../network/server-clock'
import { recordStoryStep } from '../platform/story-diagnostics'

// B550 (contracts/B550-story-viewers-live.md §3 · §7): the own story on screen. Its document is checked once; its counts
// (`storyStats/{storyId}`) are listened to while it is shown, and its view records (`views`, by name, at most 1000 + 1)
// only while the viewer list is open, so a person who views or reacts meanwhile joins the open list. tdesktop polls the
// count and the newest three every 10 s and never adds to an open list (data_stories.cpp:2399-2408 · :2493-2502,
// media_stories_recent_views.cpp:439-484); a Firestore listen gives the same at once for the changes only (§7, 10-15).
// The listens reconnect by themselves (reader.watch); the app lock stops them with the rest of the own stories.
interface Owner {
  request: StoryViewRecordsRequest
  abort: AbortController
  reader: FirestoreReader
  parent: string
  expiresAt: number
  stats: FirestoreDocument | null
  views: FirestoreDocument[] | null
  list: StoryViewRecordsResult['list']
  stopViews: (() => void) | null
}
const over = tr('1,000명이 넘어 다 보여 주지 못해요')
const unreadable = tr('열람·반응 기록을 확인하지 못했습니다. 잘못된 형식이나 합산 1,000명 초과 기록을 비어 있는 목록으로 표시하지 않습니다.')

export class StoryViewRecords {
  private closed = false
  private owner: Owner | null = null
  private readonly jobs = new Set<Promise<StoryViewRecordsResult>>()
  constructor(private readonly uid: string, private readonly auth: ReadCredentials, private readonly source: (request: StoryViewRecordsRequest) => void,
    private readonly changed: (result: StoryViewRecordsResult) => void = () => {},
    private readonly makeReader: (auth: ReadCredentials) => FirestoreReader = auth => new FirestoreReader(auth),
    private readonly record: (step: string, detail: string) => void = recordStoryStep) {}
  // story-check.log `viewer-listen`: each listen's start and end, by kind and a running number only (the line's `at` is
  // its time), so a paired check can see from the log that closing the list ended its listen (Android MorseStoryOwner).
  private seq = 0
  private log(kind: 'stats' | 'views', event: 'start' | 'end', extra = ''): void { this.record('viewer-listen', `${kind} ${event} #${++this.seq}${extra ? ` ${extra}` : ''}`) }
  pause(): void {
    const owner = this.owner; this.owner = null
    if (owner?.stopViews) { owner.stopViews = null; this.log('views', 'end', `docs=${owner.views?.length ?? 0}`) }
    owner?.abort.abort(); owner?.reader.close()
  }
  dismiss(id: string): void { if (this.owner?.request.id === id) this.pause() }
  async close(): Promise<void> { this.closed = true; this.pause(); await Promise.allSettled([...this.jobs]) }
  read(input: StoryViewRecordsRequest): Promise<StoryViewRecordsResult> {
    const request = storyViewRecordsRequest(input)
    if (this.closed || this.jobs.size >= 4) throw new Error(tr('현재 계정과 진행 중인 조회를 확인해 주세요.'))
    this.auth.signal.throwIfAborted(); this.source(request); this.pause()
    const parent = `${documents}/users/${this.uid}/${ownStoryCollections[request.privacy]}/${request.storyId}`
    const owner: Owner = { request, abort: new AbortController(), reader: this.makeReader(this.auth), parent, expiresAt: 0, stats: null, views: null, list: 'closed', stopViews: null }
    this.owner = owner
    const signal = AbortSignal.any([owner.abort.signal, this.auth.signal])
    const checking = AbortSignal.any([signal, AbortSignal.timeout(35000)])
    const validate = (): void => { if (!this.current(owner)) throw new Error(tr('열람·반응 기록 조회가 변경되었습니다.')); signal.throwIfAborted(); this.source(request) }
    const ended = (result: Pick<StoryViewRecordsResult, 'outcome' | 'message'>): StoryViewRecordsResult => {
      if (this.owner === owner) this.pause()
      return { ...request, ...result, current: null, list: 'closed', observedAt: Date.now() }
    }
    const task = Promise.resolve().then(async (): Promise<StoryViewRecordsResult> => {
      try {
        const doc = await owner.reader.getDocument(parent, checking, validate); validate()
        if (!doc) return ended({ outcome: 'absent', message: tr('이 공개 범위에서 현재 스토리 문서를 확인하지 못했습니다. 목록을 다시 불러와 주세요.') })
        const story = ownStoryFromDocument(doc, this.uid, request.privacy)
        owner.expiresAt = positionMilliseconds(story.expires)
        if (owner.expiresAt <= serverNow()) return ended({ outcome: 'expired', message: tr('이 기기 시각 기준으로 스토리가 만료되었습니다.') })
        if (story.version !== request.version) return ended({ outcome: 'changed', message: tr('스토리가 목록 조회 이후 바뀌었습니다. 목록을 다시 읽고 선택해 주세요.') })
        // The counts, listened to while the story is shown (§7 a); the first answer is this read's result.
        await new Promise<void>((resolve, reject) => {
          const path = `${documents}/users/${this.uid}/storyStats/${request.storyId}`
          let first = true
          const settle = (): void => { if (first) { first = false; resolve() } else this.publish(owner) }
          // No first answer within the check's time: the records are not shown as nothing.
          checking.addEventListener('abort', () => { if (first) { first = false; reject(new Error('no counts')) } }, { once: true })
          this.log('stats', 'start'); signal.addEventListener('abort', () => this.log('stats', 'end'), { once: true })
          owner.reader.watch({ documents: { documents: [path] } }, signal, {
            snapshot: rows => { if (!this.current(owner)) return; owner.stats = rows.get(path) ?? null; settle() },
            reconnecting: () => {},
            // Counts that cannot be read at first are not shown as none; later, the last ones stay.
            state: state => { if (state === 'error' && this.current(owner) && first) { first = false; reject(new Error('no counts')) } }
          }, 1, 256 * 1024)
        })
        validate()
        return this.result(owner)
      } catch {
        if (!this.current(owner)) return ended({ outcome: 'unavailable', message: tr('열람·반응 기록 조회가 변경되었습니다.') })
        return ended({ outcome: 'unavailable', message: unreadable })
      }
    }).finally(() => { this.jobs.delete(task) })
    this.jobs.add(task); return task
  }
  // The viewer list opened (or closed) over the story this owner reads: its view records are listened to meanwhile.
  viewers(id: string, open: boolean): void {
    const owner = this.owner
    if (!owner || owner.request.id !== id || owner.abort.signal.aborted || !owner.expiresAt) return
    if (!open) {
      if (owner.stopViews) { owner.stopViews(); this.log('views', 'end', `docs=${owner.views?.length ?? 0}`) }
      owner.stopViews = null; owner.views = null; owner.list = 'closed'; return
    }
    if (owner.stopViews) return
    owner.list = 'loading'; this.publish(owner); this.log('views', 'start')
    owner.stopViews = owner.reader.watch({ query: { parent: owner.parent, structuredQuery: {
      from: [{ collectionId: 'views' }], orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }], limit: { value: maxStoryViewRecords + 1 }
    } } }, owner.abort.signal, {
      snapshot: rows => { if (!this.current(owner) || !owner.stopViews) return; owner.views = [...rows.values()]; owner.list = 'ready'; this.publish(owner) },
      // The list stays shown while its listen reconnects.
      reconnecting: () => {},
      state: state => { if (state === 'error' && this.current(owner) && owner.stopViews) { owner.list = 'unavailable'; this.publish(owner) } }
    }, maxStoryViewRecords + 1, 8 * 1024 * 1024)
  }
  private current(owner: Owner): boolean { return !this.closed && this.owner === owner && !owner.abort.signal.aborted }
  private publish(owner: Owner): void {
    if (!this.current(owner)) return
    try { this.source(owner.request) } catch { this.pause(); return }
    this.changed(this.result(owner))
  }
  private result(owner: Owner): StoryViewRecordsResult {
    const base = { ...owner.request, observedAt: Date.now() }
    let list = owner.list, data
    if (list === 'ready' && (owner.views?.length ?? 0) > maxStoryViewRecords) list = 'over'
    try { data = storyViewRecords(list === 'ready' ? owner.views ?? [] : [], `${owner.parent}/views`, owner.stats) }
    catch { list = 'unavailable'; data = storyViewRecords([], `${owner.parent}/views`, owner.stats) }
    return { ...base, outcome: 'ready', list, current: { ...data, expiresAt: owner.expiresAt }, message: list === 'unavailable' ? unreadable : list === 'over' ? over : '' }
  }
}
