import { noteEditRebaseRequest, rebasedNoteEditDraft, type NoteEditRebaseRequest } from '../../shared/space-note-edit-rebase'
import type { NoteEditComparisonRequest, NoteEditComparisonResult } from '../../shared/space-note-edit-comparison'
import type { NoteEditDraft, NoteEditDraftRecord } from '../../shared/space-note-edit-drafts'
import { FirestoreReader, type ReadCredentials } from '../network/firestore-rpc'
import { documents } from '../network/firestore-values'
import { noteFromDocument } from './space-notes'
import { tr } from '../../shared/i18n'
export class NoteEditComparison {
  private closed = false
  private owner: { id: string; abort: AbortController; reader: FirestoreReader } | null = null
  constructor(private readonly uid: string, private readonly auth: ReadCredentials, private readonly allowed: () => void,
    private readonly read: (noteId: string, validate: () => void) => Promise<NoteEditDraftRecord>,
    private readonly storeRebase: (request: NoteEditRebaseRequest, validate: () => void) => Promise<NoteEditDraftRecord>) {}
  pause(): void { const owner = this.owner; this.owner = null; owner?.abort.abort(); owner?.reader.close() }
  dismiss(id: string): void { if (this.owner?.id === id) this.pause() }
  close(): void { this.closed = true; this.pause() }
  async rebase(input: NoteEditRebaseRequest): Promise<NoteEditDraftRecord> {
    const request = noteEditRebaseRequest(input)
    if (this.closed) throw new Error(tr('계정이 변경되었습니다.'))
    this.auth.signal.throwIfAborted(); this.allowed(); this.pause()
    const owner = { id: request.id, abort: new AbortController(), reader: new FirestoreReader(this.auth) }; this.owner = owner
    const validate = (): void => { if (this.closed || this.owner !== owner) throw new Error(tr('원문 변경 요청이 바뀌었습니다.')); owner.abort.signal.throwIfAborted(); this.auth.signal.throwIfAborted(); this.allowed() }
    try {
      const local = await this.read(request.noteId, validate); validate()
      const replay = local.revision === request.revision && JSON.stringify(local.draft) === JSON.stringify(rebasedNoteEditDraft(request))
      if (!replay) {
        if (local.revision !== request.draftRevision || !local.draft || JSON.stringify(local.draft) !== JSON.stringify(request.draft)) throw new Error(tr('기기 편집 초안이 변경되었습니다.'))
        const doc = await owner.reader.getDocument(`${documents}/users/${this.uid}/spaceNotes/${request.noteId}`, owner.abort.signal, validate)
        validate()
        if (!doc) throw new Error(tr('현재 서버 원문을 확인할 수 없습니다.'))
        const current = noteFromDocument(doc, this.uid)
        if (!current.version || current.version !== request.current.version || current.title !== request.current.title || current.body !== request.current.body) throw new Error(tr('서버 원문이 변경되었습니다. 다시 비교해 주세요.'))
      }
      const result = await this.storeRebase(request, validate); validate(); return result
    } finally { if (this.owner === owner) this.owner = null; owner.abort.abort(); owner.reader.close() }
  }
  async compare(request: NoteEditComparisonRequest): Promise<NoteEditComparisonResult> {
    if (this.closed) throw new Error(tr('계정이 변경되었습니다.'))
    this.auth.signal.throwIfAborted(); this.allowed(); this.pause()
    const owner = { id: request.id, abort: new AbortController(), reader: new FirestoreReader(this.auth) }; this.owner = owner
    const validate = (): void => { if (this.closed || this.owner !== owner) throw new Error(tr('비교 요청이 변경되었습니다.')); owner.abort.signal.throwIfAborted(); this.auth.signal.throwIfAborted(); this.allowed() }
    const draft = async (): Promise<NoteEditDraft> => {
      const record = await this.read(request.noteId, validate); validate()
      if (record.noteId !== request.noteId || record.revision !== request.draftRevision || !record.draft) throw new Error(tr('기기 편집 초안이 변경되었습니다.'))
      return record.draft
    }
    try {
      const before = await draft()
      let result: Omit<NoteEditComparisonResult, keyof NoteEditComparisonRequest | 'observedAt'>
      try {
        const doc = await owner.reader.getDocument(`${documents}/users/${this.uid}/spaceNotes/${request.noteId}`, owner.abort.signal, validate)
        validate()
        if (!doc) result = { outcome: 'absent', current: null, message: tr('조회 시점에 이 노트 문서가 없습니다. 삭제 원인이나 과거 저장 결과를 추정하지 않습니다. 기기 초안은 유지합니다.') }
        else {
          const current = noteFromDocument(doc, this.uid)
          if (!current.version) throw new Error('Missing current note version')
          const unchanged = current.version === before.baseVersion && current.title === before.baseTitle && current.body === before.baseBody
          result = { outcome: unchanged ? 'unchanged' : 'changed', current: { version: current.version, title: current.title, body: current.body }, message: unchanged ? tr('조회 시점에 편집 시작 원문과 문서 버전이 같습니다. 이후 서버 변경이 없다는 보장은 아닙니다.') : tr('현재 서버 문서의 버전 또는 제목·본문이 편집 시작 때와 다릅니다. 고정 등 다른 필드 변경도 버전을 바꿀 수 있습니다. 원문과 입력을 자동으로 바꾸지 않습니다.') }
        }
      } catch { validate(); result = { outcome: 'unavailable', current: null, message: tr('현재 서버 노트를 확인하지 못했습니다. 문서 부재로 판단하지 않으며 기기 초안과 원문을 유지합니다.') } }
      await draft(); validate()
      return { ...request, ...result, observedAt: Date.now() }
    } finally { if (this.owner === owner) this.owner = null; owner.abort.abort(); owner.reader.close() }
  }
}
