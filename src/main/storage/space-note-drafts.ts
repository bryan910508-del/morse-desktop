import { pendingNoteCreation } from './space-note-creation-table'
import type Database from 'better-sqlite3-multiple-ciphers'
import { noteDraftContent, noteDraftTarget, noteDraftWrite, type NoteDraftRecord, type NoteDraftRow, type NoteDraftTarget, type NoteDraftWrite } from '../../shared/space-note-drafts'
import { backgroundPhotoId } from '../../shared/chat-background'
export type NoteDraftCommand = { kind: 'note-draft-list' } | { kind: 'note-draft-read'; target: NoteDraftTarget } | { kind: 'note-draft-write'; request: NoteDraftWrite }
const conflict = (): never => { throw Object.assign(new Error('Note draft changed'), { deliveryCode: 'conflict' }) }
const capacity = (): never => { throw Object.assign(new Error('Note draft capacity'), { deliveryCode: 'capacity' }) }
const active = (v: { title: string; body: string; pinned: boolean }): boolean => Boolean(v.title || v.body || v.pinned)
function read(db: Database.Database, target: NoteDraftTarget): NoteDraftRecord {
  const row = db.prepare('SELECT title,body,pinned,revision FROM space_note_drafts WHERE id=?').get(target.id) as { title: string; body: string; pinned: number; revision: string } | undefined
  if (row && row.pinned !== 0 && row.pinned !== 1) throw new Error('Invalid stored note draft pin')
  return { ...target, ...(row ? noteDraftContent({ title: row.title, body: row.body, pinned: row.pinned === 1 }) : { title: '', body: '', pinned: false }), revision: row ? backgroundPhotoId(row.revision) : null }
}
export function executeNoteDraft(db: Database.Database, command: NoteDraftCommand): NoteDraftRecord | NoteDraftRow[] {
  if (command.kind === 'note-draft-read') return read(db, noteDraftTarget(command.target))
  if (command.kind === 'note-draft-list') {
    const rows = db.prepare("SELECT id FROM space_note_drafts WHERE title<>'' OR body<>'' OR pinned<>0 ORDER BY id LIMIT 101").all() as { id: string }[]
    if (rows.length > 100) return capacity()
    return rows.map(row => { const v = read(db, noteDraftTarget(row)); return { id: v.id, title: v.title, preview: v.body.slice(0, 160).replace(/\s+/g, ' '), pinned: v.pinned, revision: v.revision! } })
  }
  return db.transaction(() => {
    const request = noteDraftWrite(command.request), target = { id: request.id }, current = read(db, target)
    if (pendingNoteCreation(db)?.draftId === target.id) return conflict()
    if (current.revision === request.revision) { if (current.title === request.title && current.body === request.body && current.pinned === request.pinned) return current; return conflict() }
    if (current.revision !== request.expected || db.prepare('SELECT 1 FROM space_note_drafts WHERE revision=?').get(request.revision)) return conflict()
    if (!current.revision && (db.prepare('SELECT COUNT(*) AS n FROM space_note_drafts').get() as { n: number }).n >= 10000) return capacity()
    if (active(request) && !active(current) && (db.prepare("SELECT COUNT(*) AS n FROM space_note_drafts WHERE title<>'' OR body<>'' OR pinned<>0").get() as { n: number }).n >= 100) return capacity()
    // Empty content keeps its revision, so an old absent writer cannot replace it.
    db.prepare('INSERT INTO space_note_drafts(id,title,body,pinned,revision) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,body=excluded.body,pinned=excluded.pinned,revision=excluded.revision').run(target.id, request.title, request.body, Number(request.pinned), request.revision)
    return read(db, target)
  })()
}
