import { noteEditRebaseRequest, rebasedNoteEditDraft, type NoteEditRebaseRequest } from '../../shared/space-note-edit-rebase'
import { pendingNoteTextSave } from './space-note-text-save-table'
import type Database from 'better-sqlite3-multiple-ciphers'
import { noteEditDraft, noteEditDraftTarget, noteEditDraftWrite, type NoteEditDraft, type NoteEditDraftTarget, type NoteEditDraftRecord, type NoteEditDraftRow, type NoteEditDraftWrite } from '../../shared/space-note-edit-drafts'
import { backgroundPhotoId } from '../../shared/chat-background'
export type NoteEditDraftCommand = { kind: 'note-edit-draft-rebase'; request: NoteEditRebaseRequest } | { kind: 'note-edit-draft-list' } | { kind: 'note-edit-draft-read'; target: NoteEditDraftTarget } | { kind: 'note-edit-draft-seed'; target: NoteEditDraftTarget; draft: NoteEditDraft; revision: string } | { kind: 'note-edit-draft-write'; request: NoteEditDraftWrite }
const conflict = (): never => { throw Object.assign(new Error('Note edit draft changed'), { deliveryCode: 'conflict' }) }
const capacity = (): never => { throw Object.assign(new Error('Note edit draft capacity'), { deliveryCode: 'capacity' }) }
function read(db: Database.Database, target: NoteEditDraftTarget): NoteEditDraftRecord {
  const row = db.prepare('SELECT payload,revision FROM space_note_edit_drafts WHERE note_id=?').get(target.noteId) as { payload: string | null; revision: string } | undefined
  if (row?.payload && row.payload.length > 2000000) return conflict()
  return { ...target, revision: row ? backgroundPhotoId(row.revision) : null, draft: row && row.payload !== null ? noteEditDraft(JSON.parse(row.payload)) : null }
}
export function executeNoteEditDraft(db: Database.Database, command: NoteEditDraftCommand): NoteEditDraftRecord | NoteEditDraftRow[] {
  if (command.kind === 'note-edit-draft-read') return read(db, noteEditDraftTarget(command.target))
  if (command.kind === 'note-edit-draft-list') {
    const rows = db.prepare('SELECT note_id FROM space_note_edit_drafts WHERE payload IS NOT NULL ORDER BY note_id LIMIT 101').all() as { note_id: string }[]
    if (rows.length > 100) return capacity()
    return rows.map(row => { const value = read(db, noteEditDraftTarget({ noteId: row.note_id })); if (!value.draft || !value.revision) return conflict(); return { noteId: value.noteId, title: value.draft.title, preview: value.draft.body.slice(0, 160).replace(/\s+/g, ' '), revision: value.revision } })
  }
  return db.transaction(() => {
    if (command.kind === 'note-edit-draft-seed') {
      const target = noteEditDraftTarget(command.target), draft = noteEditDraft(command.draft), revision = backgroundPhotoId(command.revision), current = read(db, target)
      if (current.draft) return current // Existing work and its original server version always win over a new seed.
      if (pendingNoteTextSave(db)?.noteId === target.noteId) return conflict()
      if (draft.title !== draft.baseTitle || draft.body !== draft.baseBody || db.prepare('SELECT 1 FROM space_note_edit_drafts WHERE revision=?').get(revision)) return conflict()
      if (!current.revision && (db.prepare('SELECT COUNT(*) AS n FROM space_note_edit_drafts').get() as { n: number }).n >= 10000) return capacity()
      if ((db.prepare('SELECT COUNT(*) AS n FROM space_note_edit_drafts WHERE payload IS NOT NULL').get() as { n: number }).n >= 100) return capacity()
      db.prepare('INSERT INTO space_note_edit_drafts(note_id,payload,revision) VALUES(?,?,?) ON CONFLICT(note_id) DO UPDATE SET payload=excluded.payload,revision=excluded.revision').run(target.noteId, JSON.stringify(draft), revision)
      return read(db, target)
    }
    if (command.kind === 'note-edit-draft-rebase') {
      const request = noteEditRebaseRequest(command.request), target = { noteId: request.noteId }, current = read(db, target), next = rebasedNoteEditDraft(request)
      if (pendingNoteTextSave(db)?.noteId === target.noteId) return conflict()
      if (current.revision === request.revision) { if (JSON.stringify(current.draft) === JSON.stringify(next)) return current; return conflict() }
      if (current.revision !== request.draftRevision || !current.draft || JSON.stringify(current.draft) !== JSON.stringify(request.draft) || db.prepare('SELECT 1 FROM space_note_edit_drafts WHERE revision=?').get(request.revision)) return conflict()
      db.prepare('UPDATE space_note_edit_drafts SET payload=?,revision=? WHERE note_id=?').run(JSON.stringify(next), request.revision, target.noteId)
      return read(db, target)
    }
    const request = noteEditDraftWrite(command.request), target = { noteId: request.noteId }, current = read(db, target)
    if (pendingNoteTextSave(db)?.noteId === target.noteId) return conflict()
    if (current.revision === request.revision) { if (JSON.stringify(current.draft) === JSON.stringify(request.draft)) return current; return conflict() }
    if (current.revision !== request.expected || db.prepare('SELECT 1 FROM space_note_edit_drafts WHERE revision=?').get(request.revision)) return conflict()
    if (request.draft && (!current.draft || request.draft.baseVersion !== current.draft.baseVersion || request.draft.baseTitle !== current.draft.baseTitle || request.draft.baseBody !== current.draft.baseBody)) return conflict()
    // A cleared draft leaves only its revision; restoring a base requires a current server selection.
    db.prepare('UPDATE space_note_edit_drafts SET payload=?,revision=? WHERE note_id=?').run(request.draft ? JSON.stringify(request.draft) : null, request.revision, target.noteId)
    return read(db, target)
  })()
}
