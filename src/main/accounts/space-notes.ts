import { randomUUID } from 'node:crypto'
import { searchFold } from '../../shared/search'
import type { NotePageSearch, NotePageSearchResult } from '../../shared/space-note-search'
import type { NoteEditDraftStart, NoteEditDraft } from '../../shared/space-note-edit-drafts'
import { NotePinEditor } from './space-note-pin'
import type { NotePinRequest } from '../../shared/space-note-pin'
import type { SpaceNoteDetail, SpaceNoteRow, SpaceNoteSelection, SpaceNotesSnapshot, SpaceNotesPageRequest } from '../../shared/space-notes'
import { comparePosition, type MessagePosition } from '../../shared/model'
import { identifier } from '../../shared/validation'
import { FirestoreReader, type ReadCredentials } from '../network/firestore-rpc'
import { childId, documents, documentVersion, positionValue, timestamp, type FirestoreDocument } from '../network/firestore-values'
import { tr } from '../../shared/i18n'
const empty = (): SpaceNotesSnapshot => ({ revision: null, page: { number: 1, canPrevious: false, older: null }, requestId: null, status: 'idle', message: '', limited: false, rows: [], selected: null })
export function noteFromDocument(doc: FirestoreDocument, uid: string): SpaceNoteDetail {
  const id = identifier(childId(doc.name, `${documents}/users/${uid}/spaceNotes`)), f = doc.fields
  const title = f.title?.stringValue, body = f.body?.stringValue
  if (typeof title !== 'string' || title.length > 200 || typeof body !== 'string' || body.length > 120000 || !f.updatedAt?.timestampValue) throw new Error('Unsupported note document')
  const updated = timestamp(f.updatedAt.timestampValue, id)
  let created: SpaceNoteRow['created'] = null
  try { if (f.createdAt?.timestampValue) created = timestamp(f.createdAt.timestampValue, id) } catch { /* Do not replace missing/invalid original dates with now. */ }
  const pinned = f.isPinned === undefined ? false : typeof f.isPinned.booleanValue === 'boolean' ? f.isPinned.booleanValue : null
  return { id, version: documentVersion(doc), title, body, preview: body.slice(0, 160).replace(/\s+/g, ' '), created, updated, pinned }
}
export class SpaceNotesReader {
  private closed = false
  private owner: { requestId: string; abort: AbortController; reader: FirestoreReader; cursor: MessagePosition | null; history: (MessagePosition | null)[]; pageNumber: number } | null = null
  private value = empty()
  private notes = new Map<string, SpaceNoteDetail>()
  private selectedId: string | null = null
  private remoteDocs = new Map<string, FirestoreDocument>()
  readonly pin: NotePinEditor
  constructor(private readonly uid: string, private readonly auth: ReadCredentials, private readonly allowed: () => boolean, private readonly changed: () => void) { this.pin = new NotePinEditor(uid, auth, (request, exact) => this.pinSource(request, exact)) }
  get snapshot(): SpaceNotesSnapshot {
    if (this.closed || this.auth.signal.aborted || !this.allowed()) return empty()
    const copy = <T extends SpaceNoteRow>(row: T): T => ({ ...row, updated: { ...row.updated }, created: row.created ? { ...row.created } : null })
    const selected = this.value.status === 'ready' && this.selectedId ? this.notes.get(this.selectedId) : null
    return { ...this.value, page: { ...this.value.page, older: this.value.page.older ? { ...this.value.page.older } : null }, rows: this.value.rows.map(copy), selected: selected ? copy(selected) : null }
  }
  editDraftSource(target: NoteEditDraftStart): NoteEditDraft {
    const note = this.notes.get(target.noteId)
    if (this.closed || this.auth.signal.aborted || !this.allowed() || !this.owner || this.owner.abort.signal.aborted || this.owner.requestId !== target.requestId || this.value.status !== 'ready' || this.selectedId !== target.noteId || !note || !note.version || note.version !== target.version) throw new Error(tr('현재 노트 원문에서 편집을 다시 시작해 주세요.'))
    return { baseVersion: note.version, baseTitle: note.title, baseBody: note.body, title: note.title, body: note.body }
  }
  private pinSource(request: NotePinRequest, exact: boolean): FirestoreDocument {
    const note = this.notes.get(request.noteId), doc = this.remoteDocs.get(request.noteId)
    if (this.closed || this.auth.signal.aborted || !this.allowed() || !this.owner || this.owner.abort.signal.aborted || this.owner.requestId !== request.requestId || this.value.status !== 'ready' || this.selectedId !== request.noteId || !note || !doc || !doc.updateTime || !note.version || (exact && (note.version !== request.version || note.pinned !== request.pinned))) throw new Error(tr('현재 노트와 고정 정보를 다시 확인해 주세요.'))
    return doc
  }
  private publish(): void { this.pin.prune(); if (!this.closed) this.changed() }
  pause(): void { const owner = this.owner; this.owner = null; owner?.abort.abort(); owner?.reader.close(); if (owner) this.pin.dismiss(owner.requestId); else this.pin.pause(); this.remoteDocs.clear(); this.notes.clear(); this.selectedId = null; this.value = empty(); this.publish() }
  dismiss(requestId: string): void { if (this.owner?.requestId === requestId) this.pause() }
  select(request: SpaceNoteSelection): void {
    if (this.closed || this.auth.signal.aborted || !this.allowed() || !this.owner || this.owner.abort.signal.aborted || this.owner.requestId !== request.requestId || this.value.status !== 'ready') throw new Error(tr('현재 노트 목록을 다시 불러와 주세요.'))
    const note = request.noteId ? this.notes.get(request.noteId) : null
    if (request.noteId && (!note || note.version !== request.version)) throw new Error(tr('노트가 변경되었습니다. 최신 목록에서 다시 선택해 주세요.'))
    this.selectedId = request.noteId; this.publish()
  }
  search(request: NotePageSearch): NotePageSearchResult {
    if (this.closed || this.auth.signal.aborted || !this.allowed() || !this.owner || this.owner.abort.signal.aborted || this.owner.requestId !== request.requestId || this.value.status !== 'ready' || this.value.revision !== request.revision) throw new Error(tr('노트 페이지가 변경되었습니다. 현재 페이지에서 다시 검색해 주세요.'))
    const query = searchFold(request.query), hits: NotePageSearchResult['hits'] = []
    for (const row of this.value.rows) {
      const note = this.notes.get(row.id)
      if (!note || note.version !== row.version) throw new Error('Current note source mismatch')
      if (searchFold(note.title).includes(query)) hits.push({ id: note.id, version: note.version, field: 'title' })
      else if (searchFold(note.body).includes(query)) hits.push({ id: note.id, version: note.version, field: 'body' })
    }
    return { ...request, scanned: this.notes.size, hits }
  }
  open(requestId: string): void { this.openPage(requestId, null, [], 1) }
  page(request: SpaceNotesPageRequest): void {
    const owner = this.owner
    if (this.closed || this.auth.signal.aborted || !this.allowed() || !owner || owner.abort.signal.aborted || owner.requestId !== request.requestId || this.value.status !== 'ready') throw new Error(tr('현재 노트 페이지를 다시 불러와 주세요.'))
    if (request.direction === 'previous') {
      if (!owner.history.length) throw new Error(tr('이전 페이지 위치가 없습니다. 최근 노트부터 다시 불러와 주세요.'))
      const history = owner.history.slice(), cursor = history.pop()!
      this.openPage(request.nextRequestId, cursor, history, owner.pageNumber - 1)
      return
    }
    const older = this.value.page.older, note = older ? this.notes.get(older.noteId) : null
    if (!this.value.limited || !older || !note || !note.version || older.noteId !== request.noteId || older.version !== request.version || note.version !== request.version || !Number.isSafeInteger(owner.pageNumber + 1)) throw new Error(tr('페이지 끝의 노트가 변경되었습니다. 최신 목록에서 다시 이동해 주세요.'))
    const history = [...owner.history, owner.cursor].slice(-50)
    this.openPage(request.nextRequestId, { ...note.updated }, history, owner.pageNumber + 1)
  }
  private openPage(requestId: string, cursor: MessagePosition | null, history: (MessagePosition | null)[], pageNumber: number): void {
    if (this.closed || this.auth.signal.aborted || !this.allowed()) throw new Error(tr('현재 계정 연결과 잠금을 확인해 주세요.'))
    this.pause()
    const owner = { requestId, abort: new AbortController(), reader: new FirestoreReader(this.auth), cursor, history, pageNumber }; this.owner = owner; this.pin.open(requestId)
    const page = { number: pageNumber, canPrevious: history.length > 0, older: null }
    this.value = { ...empty(), page, requestId, status: 'loading', message: tr('본인 계정의 현재 노트 페이지를 불러오고 있습니다.') }
    const current = (): boolean => !this.closed && this.owner === owner && !owner.abort.signal.aborted && !this.auth.signal.aborted && this.allowed()
    owner.reader.watch({ query: { parent: `${documents}/users/${this.uid}`, structuredQuery: {
      from: [{ collectionId: 'spaceNotes' }], orderBy: [{ field: { fieldPath: 'updatedAt' }, direction: 'DESCENDING' }, { field: { fieldPath: '__name__' }, direction: 'DESCENDING' }], limit: { value: 51 },
      ...(cursor ? { startAt: { before: false, values: [positionValue(cursor), { referenceValue: `${documents}/users/${this.uid}/spaceNotes/${cursor.id}` }] } } : {})
    } } }, owner.abort.signal, {
      snapshot: rows => {
        if (!current()) return
        try {
          if (rows.size > 51) throw new Error('Note query limit exceeded')
          const latest = [...rows].map(([path, doc]) => { if (path !== doc.name) throw new Error('Note path mismatch'); return noteFromDocument(doc, this.uid) }).sort((a, b) => comparePosition(b.updated, a.updated))
          if (cursor && latest.some(note => comparePosition(note.updated, cursor) >= 0)) throw new Error('Note outside current page cursor')
          const boundary = latest.length > 50 ? latest[49] : null
          const visible = latest.slice(0, 50).sort((a, b) => Number(b.pinned === true) - Number(a.pinned === true) || comparePosition(b.updated, a.updated))
          this.notes = new Map(visible.map(note => [note.id, note]))
          this.remoteDocs = new Map(visible.map(note => [note.id, rows.get(`${documents}/users/${this.uid}/spaceNotes/${note.id}`)!]))
          if (this.selectedId && !this.notes.has(this.selectedId)) this.selectedId = null
          this.value = { ...this.value, revision: randomUUID(), status: 'ready', page: { ...page, older: boundary?.version ? { noteId: boundary.id, version: boundary.version } : null }, limited: latest.length > 50, message: tr('현재 조회한 노트 페이지입니다.'), rows: visible.map(({ body: _body, ...row }) => row) }
        } catch { this.remoteDocs.clear(); this.notes.clear(); this.selectedId = null; this.value = { ...empty(), page, requestId, status: 'error', message: tr('노트의 형식이나 조회 범위를 확인하지 못했습니다. 원문을 자르거나 일부 노트를 누락한 목록으로 표시하지 않습니다.') } }
        this.publish()
      },
      state: (state, error) => {
        if (!current() || state === 'ready') return
        this.remoteDocs.clear(); this.notes.clear(); this.selectedId = null
        this.value = { ...empty(), page, requestId, status: state, message: state === 'loading' ? tr('노트 연결을 확인하고 있습니다.') : error?.code === 'index' ? tr('노트 조회 인덱스를 확인해야 합니다.') : tr('본인 노트 조회를 완료하지 못했습니다. 계정과 연결을 확인해 주세요.') }
        this.publish()
      }
    }, 51, 8 * 1024 * 1024)
    this.publish()
  }
  async close(): Promise<void> { this.closed = true; this.pause(); await this.pin.close() }
}
