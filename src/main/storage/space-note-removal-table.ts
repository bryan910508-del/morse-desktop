import type Database from 'better-sqlite3-multiple-ciphers'
import { noteRemovalRequest, type NoteRemovalRequest, type NoteRemovalState, type PendingNoteRemoval } from '../../shared/space-note-removal'
import { pendingNoteTextSave } from './space-note-text-save-table'
import { backgroundPhotoId } from '../../shared/chat-background'
export type NoteRemovalCommand = { kind: 'note-removal-read' } | { kind: 'note-removal-prepare'; request: NoteRemovalRequest } | { kind: 'note-removal-state'; id: string; expected: NoteRemovalState; state: NoteRemovalState | 'dismissed' }
const conflict = (): never => { throw Object.assign(new Error('Note removal or pending text save changed'), { deliveryCode: 'conflict' }) }
export function pendingNoteRemoval(db: Database.Database): PendingNoteRemoval | null {
  const rows = db.prepare('SELECT id,payload,state FROM space_note_removals WHERE payload IS NOT NULL LIMIT 2').all() as { id: string; payload: string; state: NoteRemovalState }[]
  if (rows.length > 1) return conflict()
  const row = rows[0]
  if (!row) return null
  if (!['prepared', 'submitted', 'confirmed', 'rejected'].includes(row.state) || row.payload.length > 1000000) return conflict()
  const request = noteRemovalRequest(JSON.parse(row.payload))
  if (request.id !== row.id) return conflict()
  return { ...request, state: row.state }
}
export function executeNoteRemoval(db: Database.Database, command: NoteRemovalCommand, uid: string): PendingNoteRemoval | null {
  if (command.kind === 'note-removal-read') { const pending = pendingNoteRemoval(db); if (pending && pending.ownerId !== uid) return conflict(); return pending }
  return db.transaction(() => {
    const current = pendingNoteRemoval(db)
    if (command.kind === 'note-removal-prepare') {
      const request = noteRemovalRequest(command.request)
      if (request.ownerId !== uid || pendingNoteTextSave(db)?.noteId === request.noteId) return conflict()
      if (current) { const { state, ...previous } = current; if (state === 'prepared' && JSON.stringify(previous) === JSON.stringify(request)) return current; return conflict() }
      if (db.prepare('SELECT 1 FROM space_note_removals WHERE id=?').get(request.id)) return conflict()
      if ((db.prepare('SELECT COUNT(*) AS n FROM space_note_removals').get() as { n: number }).n >= 10000) throw Object.assign(new Error('Note removal capacity'), { deliveryCode: 'capacity' })
      const payload = JSON.stringify(request)
      if (payload.length > 1000000) return conflict()
      db.prepare("INSERT INTO space_note_removals(id,payload,state) VALUES(?,?,'prepared')").run(request.id, payload)
    } else {
      backgroundPhotoId(command.id)
      if (!current || current.id !== command.id || current.state !== command.expected || current.ownerId !== uid) return conflict()
      if (!(command.state === 'dismissed' || (current.state === 'prepared' && command.state === 'submitted') || (current.state === 'submitted' && ['confirmed', 'rejected'].includes(command.state)))) return conflict()
      if (command.state === 'submitted' && pendingNoteTextSave(db)?.noteId === current.noteId) return conflict()
      // Deleting a server note never consumes an independently retained local edit draft.
      db.prepare('UPDATE space_note_removals SET state=?,payload=CASE WHEN ? THEN NULL ELSE payload END WHERE id=?').run(command.state, command.state === 'dismissed' ? 1 : 0, command.id)
    }
    return pendingNoteRemoval(db)
  })()
}
