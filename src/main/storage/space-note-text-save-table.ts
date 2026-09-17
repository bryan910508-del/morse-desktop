import { pendingNoteRemoval } from './space-note-removal-table'
import type Database from 'better-sqlite3-multiple-ciphers'
import { randomUUID } from 'node:crypto'
import { noteTextSaveRequest, type NoteTextSaveRequest, type NoteTextSaveState, type PendingNoteTextSave } from '../../shared/space-note-text-save'
import { noteEditDraft } from '../../shared/space-note-edit-drafts'
import { backgroundPhotoId } from '../../shared/chat-background'
export type NoteTextSaveCommand = { kind: 'note-text-save-read' } | { kind: 'note-text-save-prepare'; request: NoteTextSaveRequest } | { kind: 'note-text-save-state'; id: string; expected: NoteTextSaveState; state: NoteTextSaveState | 'dismissed' }
const conflict = (): never => { throw Object.assign(new Error('Note text save or draft changed'), { deliveryCode: 'conflict' }) }
export function pendingNoteTextSave(db: Database.Database): PendingNoteTextSave | null {
  const rows = db.prepare('SELECT id,payload,state FROM space_note_text_saves WHERE payload IS NOT NULL LIMIT 2').all() as { id: string; payload: string; state: NoteTextSaveState }[]
  if (rows.length > 1) return conflict()
  const row = rows[0]
  if (!row) return null
  if (!['prepared', 'submitted', 'confirmed', 'rejected'].includes(row.state) || row.payload.length > 2000000) return conflict()
  const request = noteTextSaveRequest(JSON.parse(row.payload))
  if (request.id !== row.id) return conflict()
  return { ...request, state: row.state }
}
function requireDraft(db: Database.Database, request: NoteTextSaveRequest): void {
  const row = db.prepare('SELECT payload,revision FROM space_note_edit_drafts WHERE note_id=?').get(request.noteId) as { payload: string | null; revision: string } | undefined
  if (!row?.payload || row.payload.length > 2000000 || row.revision !== request.draftRevision || JSON.stringify(noteEditDraft(JSON.parse(row.payload))) !== JSON.stringify(request.draft)) return conflict()
}
export function executeNoteTextSave(db: Database.Database, command: NoteTextSaveCommand, uid: string): PendingNoteTextSave | null {
  if (command.kind === 'note-text-save-read') { const pending = pendingNoteTextSave(db); if (pending && pending.ownerId !== uid) return conflict(); return pending }
  return db.transaction(() => {
    const current = pendingNoteTextSave(db)
    if (command.kind === 'note-text-save-prepare') {
      const request = noteTextSaveRequest(command.request)
      if (request.ownerId !== uid || pendingNoteRemoval(db)?.noteId === request.noteId) return conflict()
      if (current) { const { state, ...previous } = current; if (state === 'prepared' && JSON.stringify(previous) === JSON.stringify(request)) return current; return conflict() }
      if (db.prepare('SELECT 1 FROM space_note_text_saves WHERE id=?').get(request.id)) return conflict()
      if ((db.prepare('SELECT COUNT(*) AS n FROM space_note_text_saves').get() as { n: number }).n >= 10000) throw Object.assign(new Error('Note text save capacity'), { deliveryCode: 'capacity' })
      requireDraft(db, request)
      const payload = JSON.stringify(request)
      if (payload.length > 2000000) return conflict()
      db.prepare("INSERT INTO space_note_text_saves(id,payload,state) VALUES(?,?,'prepared')").run(request.id, payload)
    } else {
      backgroundPhotoId(command.id)
      if (!current || current.id !== command.id || current.state !== command.expected || current.ownerId !== uid) return conflict()
      if (!(command.state === 'dismissed' || (current.state === 'prepared' && command.state === 'submitted') || (current.state === 'submitted' && ['confirmed', 'rejected'].includes(command.state)))) return conflict()
      if (command.state === 'submitted' && pendingNoteRemoval(db)?.noteId === current.noteId) return conflict()
      if (command.state === 'submitted' || command.state === 'confirmed') requireDraft(db, current)
      if (command.state === 'confirmed') db.prepare('UPDATE space_note_edit_drafts SET payload=NULL,revision=? WHERE note_id=?').run(randomUUID(), current.noteId)
      db.prepare('UPDATE space_note_text_saves SET state=?,payload=CASE WHEN ? THEN NULL ELSE payload END WHERE id=?').run(command.state, command.state === 'dismissed' ? 1 : 0, command.id)
    }
    return pendingNoteTextSave(db)
  })()
}
