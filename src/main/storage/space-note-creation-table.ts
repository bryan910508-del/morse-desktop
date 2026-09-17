import type Database from 'better-sqlite3-multiple-ciphers'
import { randomUUID } from 'node:crypto'
import { noteCreationRequest, type NoteCreationRequest, type NoteCreationState, type PendingNoteCreation } from '../../shared/space-note-creation'
import { backgroundPhotoId } from '../../shared/chat-background'
export type NoteCreationCommand = { kind: 'note-creation-read' } | { kind: 'note-creation-prepare'; request: NoteCreationRequest } | { kind: 'note-creation-state'; id: string; expected: NoteCreationState; state: NoteCreationState | 'dismissed' }
const conflict = (): never => { throw Object.assign(new Error('Note creation or saved draft changed'), { deliveryCode: 'conflict' }) }
export function pendingNoteCreation(db: Database.Database): PendingNoteCreation | null {
  const rows = db.prepare('SELECT id,payload,state FROM space_note_creations WHERE payload IS NOT NULL LIMIT 2').all() as { id: string; payload: string; state: NoteCreationState }[]
  if (rows.length > 1) return conflict()
  const row = rows[0]
  if (!row) return null
  if (!['prepared', 'submitted', 'confirmed', 'rejected'].includes(row.state) || row.payload.length > 1000000) return conflict()
  const request = noteCreationRequest(JSON.parse(row.payload))
  if (request.id !== row.id) return conflict()
  return { ...request, state: row.state }
}
function requireDraft(db: Database.Database, request: NoteCreationRequest): void {
  const row = db.prepare('SELECT title,body,pinned,revision FROM space_note_drafts WHERE id=?').get(request.draftId) as { title: string; body: string; pinned: number; revision: string } | undefined
  if (!row || row.revision !== request.draftRevision || row.title !== request.title || row.body !== request.body || row.pinned !== Number(request.pinned)) return conflict()
}
export function executeNoteCreation(db: Database.Database, command: NoteCreationCommand, uid: string): PendingNoteCreation | null {
  if (command.kind === 'note-creation-read') {
    const pending = pendingNoteCreation(db)
    if (pending && pending.ownerId !== uid) return conflict()
    return pending
  }
  return db.transaction(() => {
    const current = pendingNoteCreation(db)
    if (command.kind === 'note-creation-prepare') {
      const request = noteCreationRequest(command.request)
      if (request.ownerId !== uid) return conflict()
      if (current) { const { state, ...previous } = current; if (state === 'prepared' && JSON.stringify(previous) === JSON.stringify(request)) return current; return conflict() }
      if (db.prepare('SELECT 1 FROM space_note_creations WHERE id=?').get(request.id)) return conflict()
      if ((db.prepare('SELECT COUNT(*) AS n FROM space_note_creations').get() as { n: number }).n >= 10000) throw Object.assign(new Error('Note creation capacity'), { deliveryCode: 'capacity' })
      requireDraft(db, request)
      const payload = JSON.stringify(request)
      if (payload.length > 1000000) return conflict()
      db.prepare("INSERT INTO space_note_creations(id,payload,state) VALUES(?,?,'prepared')").run(request.id, payload)
    } else {
      backgroundPhotoId(command.id)
      if (!current || current.id !== command.id || current.state !== command.expected || current.ownerId !== uid) return conflict()
      if (!(command.state === 'dismissed' || (current.state === 'prepared' && command.state === 'submitted') || (current.state === 'submitted' && ['confirmed', 'rejected'].includes(command.state)))) return conflict()
      if (command.state === 'submitted' || command.state === 'confirmed') requireDraft(db, current)
      // Only the exact acknowledged draft is consumed, in the completion transaction.
      if (command.state === 'confirmed') db.prepare("UPDATE space_note_drafts SET title='',body='',pinned=0,revision=? WHERE id=?").run(randomUUID(), current.draftId)
      db.prepare('UPDATE space_note_creations SET state=?,payload=CASE WHEN ? THEN NULL ELSE payload END WHERE id=?').run(command.state, command.state === 'dismissed' ? 1 : 0, command.id)
    }
    return pendingNoteCreation(db)
  })()
}
