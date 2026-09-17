import { storyViewRecordsRequest, type StoryViewRecordsRequest, type StoryViewRecordsResult } from '../../shared/story-view-records'
import { positionMilliseconds } from '../../shared/model'
import { FirestoreReader, type ReadCredentials } from '../network/firestore-rpc'
import { documents } from '../network/firestore-values'
import { ownStoryCollections, ownStoryFromDocument } from '../network/own-story-document'
import { storyViewRecords } from '../network/story-view-records'
import { tr } from '../../shared/i18n'
export class StoryViewRecords {
  private closed = false
  private owner: { id: string; abort: AbortController; reader: FirestoreReader } | null = null
  private readonly jobs = new Set<Promise<StoryViewRecordsResult>>()
  constructor(private readonly uid: string, private readonly auth: ReadCredentials, private readonly source: (request: StoryViewRecordsRequest) => void) {}
  pause(): void { const owner = this.owner; this.owner = null; owner?.abort.abort(); owner?.reader.close() }
  dismiss(id: string): void { if (this.owner?.id === id) this.pause() }
  async close(): Promise<void> { this.closed = true; this.pause(); await Promise.allSettled([...this.jobs]) }
  read(input: StoryViewRecordsRequest): Promise<StoryViewRecordsResult> {
    const request = storyViewRecordsRequest(input)
    if (this.closed || this.jobs.size >= 4) throw new Error(tr('현재 계정과 진행 중인 조회를 확인해 주세요.'))
    this.auth.signal.throwIfAborted(); this.source(request); this.pause()
    const owner = { id: request.id, abort: new AbortController(), reader: new FirestoreReader(this.auth) }; this.owner = owner
    const signal = AbortSignal.any([owner.abort.signal, this.auth.signal, AbortSignal.timeout(35000)])
    const validate = (): void => { if (this.closed || this.owner !== owner) throw new Error(tr('열람·반응 기록 조회가 변경되었습니다.')); signal.throwIfAborted(); this.source(request) }
    const task = Promise.resolve().then(async (): Promise<StoryViewRecordsResult> => {
      let result: Pick<StoryViewRecordsResult, 'outcome' | 'current' | 'message'>
      try {
        const doc = await owner.reader.getDocument(`${documents}/users/${this.uid}/${ownStoryCollections[request.privacy]}/${request.storyId}`, signal, validate); validate()
        if (!doc) result = { outcome: 'absent', current: null, message: tr('이 공개 범위에서 현재 스토리 문서를 확인하지 못했습니다. 목록을 다시 불러와 주세요.') }
        else {
          const story = ownStoryFromDocument(doc, this.uid, request.privacy), expiresAt = positionMilliseconds(story.expires)
          if (expiresAt <= Date.now()) result = { outcome: 'expired', current: null, message: tr('이 기기 시각 기준으로 스토리가 만료되었습니다.') }
          else if (story.version !== request.version) result = { outcome: 'changed', current: null, message: tr('스토리가 목록 조회 이후 바뀌었습니다. 목록을 다시 읽고 선택해 주세요.') }
          else result = { outcome: 'ready', current: { ...storyViewRecords(doc), expiresAt }, message: tr('조회 시점에 저장된 열람·반응 기록입니다. 이후 변경 여부를 실시간으로 확인하지 않습니다.') }
        }
      } catch { validate(); result = { outcome: 'unavailable', current: null, message: tr('열람·반응 기록을 확인하지 못했습니다. 잘못된 형식이나 합산 1,000명 초과 기록을 비어 있는 목록으로 표시하지 않습니다.') } }
      validate()
      return { ...request, ...result, observedAt: Date.now() }
    }).finally(() => { if (this.owner === owner) this.owner = null; owner.abort.abort(); owner.reader.close(); this.jobs.delete(task) })
    this.jobs.add(task); return task
  }
}
