import { contactStoryReactionRequest, type ContactStoryReactionRequest, type ContactStoryReactionResult } from '../../shared/contact-story-reaction'
import { positionMilliseconds } from '../../shared/model'
import { FirestoreReader, type ReadCredentials } from '../network/firestore-rpc'
import { documents } from '../network/firestore-values'
import { ownStoryCollections, ownStoryFromDocument } from '../network/own-story-document'
import { storyHiddenFrom } from '../network/story-hidden-audience'
import { currentViewerReaction } from '../network/contact-story-reaction'
import { tr } from '../../shared/i18n'
export class ContactStoryReaction {
  private closed = false
  private owner: { id: string; abort: AbortController; reader: FirestoreReader; validate(): void } | null = null
  private readonly jobs = new Set<Promise<ContactStoryReactionResult>>()
  constructor(private readonly uid: string, private readonly auth: ReadCredentials, private readonly source: (request: ContactStoryReactionRequest) => { ownerId: string; expiresAt: number }) {}
  pause(): void { const owner = this.owner; this.owner = null; owner?.abort.abort(); owner?.reader.close() }
  prune(): void { try { this.owner?.validate() } catch { this.pause() } }
  dismiss(id: string): void { if (this.owner?.id === id) this.pause() }
  async close(): Promise<void> { this.closed = true; this.pause(); await Promise.allSettled([...this.jobs]) }
  read(input: ContactStoryReactionRequest): Promise<ContactStoryReactionResult> {
    const request = contactStoryReactionRequest(input)
    if (this.closed || this.jobs.size >= 4) throw new Error(tr('현재 계정과 진행 중인 반응 조회를 확인해 주세요.'))
    this.auth.signal.throwIfAborted(); const prepared = this.source(request)
    if (prepared.ownerId === this.uid) throw new Error(tr('본인 스토리의 기록은 내 스토리에서 확인해 주세요.'))
    this.pause()
    const owner = { id: request.id, abort: new AbortController(), reader: new FirestoreReader(this.auth), validate: () => {} }; this.owner = owner
    const signal = AbortSignal.any([owner.abort.signal, this.auth.signal, AbortSignal.timeout(35000)])
    const validate = (): void => { if (this.closed || this.owner !== owner) throw new Error(tr('본인 반응 조회가 변경되었습니다.')); signal.throwIfAborted(); if (this.source(request).ownerId !== prepared.ownerId) throw new Error(tr('현재 스토리 접근이 변경되었습니다.')) }
    owner.validate = validate
    const task = Promise.resolve().then(async (): Promise<ContactStoryReactionResult> => {
      let result: Pick<ContactStoryReactionResult, 'outcome' | 'current' | 'message'>
      try {
        validate()
        const doc = await owner.reader.getDocument(`${documents}/users/${prepared.ownerId}/${ownStoryCollections[request.privacy]}/${request.storyId}`, signal, validate); validate()
        if (!doc) result = { outcome: 'absent', current: null, message: tr('이 공개 범위에서 현재 스토리 문서를 확인하지 못했습니다. 목록을 다시 조회해 주세요.') }
        else {
          const story = ownStoryFromDocument(doc, prepared.ownerId, request.privacy)
          if (storyHiddenFrom(doc).hiddenFrom.includes(this.uid)) throw new Error('Story now hidden from viewer')
          if (positionMilliseconds(story.expires) <= Date.now()) result = { outcome: 'expired', current: null, message: tr('현재 스토리가 이 기기 시각 기준으로 만료되었습니다.') }
          else if (story.version !== request.version) result = { outcome: 'changed', current: null, message: tr('목록 조회 이후 스토리 문서가 바뀌었습니다. 목록을 다시 읽고 선택해 주세요.') }
          else result = { outcome: 'ready', current: currentViewerReaction(doc, this.uid), message: tr('조회 시점에 이 스토리에 저장된 본인의 반응입니다. 이후 변경을 실시간으로 확인하지 않습니다.') }
        }
      } catch { validate(); result = { outcome: 'unavailable', current: null, message: tr('현재 스토리·숨김 설정·본인 반응의 형식을 확인하지 못했습니다. 반응이 없는 것으로 표시하지 않습니다.') } }
      validate()
      return { ...request, ...result, ownerId: prepared.ownerId, observedAt: Date.now(), expiresAt: Math.min(prepared.expiresAt, Date.now() + 30000) }
    }).finally(() => { if (this.owner === owner) this.owner = null; owner.abort.abort(); owner.reader.close(); this.jobs.delete(task) })
    this.jobs.add(task); return task
  }
}
