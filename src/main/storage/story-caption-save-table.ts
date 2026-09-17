import { pendingStoryHiddenChange } from './story-hidden-change-table'
import { pendingStoryPrivacyMove } from './story-privacy-move-table'
import { pendingStoryRemoval } from './story-removal-table'
import type Database from 'better-sqlite3-multiple-ciphers'
import { randomUUID } from 'node:crypto'
import { storyCaptionSaveRequest, type StoryCaptionSaveRequest, type StoryCaptionSaveState, type PendingStoryCaptionSave } from '../../shared/story-caption-save'
import { storyCaptionDraft } from '../../shared/story-caption-drafts'
import { backgroundPhotoId } from '../../shared/chat-background'
export type StoryCaptionSaveCommand = { kind: 'story-caption-save-read' } | { kind: 'story-caption-save-prepare'; request: StoryCaptionSaveRequest } | { kind: 'story-caption-save-state'; id: string; expected: StoryCaptionSaveState; state: StoryCaptionSaveState | 'dismissed' }
const conflict = (): never => { throw Object.assign(new Error('Note text save or draft changed'), { deliveryCode: 'conflict' }) }
export function pendingStoryCaptionSave(db: Database.Database): PendingStoryCaptionSave | null {
  const rows = db.prepare('SELECT id,payload,state FROM story_caption_saves WHERE payload IS NOT NULL LIMIT 2').all() as { id: string; payload: string; state: StoryCaptionSaveState }[]
  if (rows.length > 1) return conflict()
  const row = rows[0]
  if (!row) return null
  if (!['prepared', 'submitted', 'confirmed', 'rejected'].includes(row.state) || row.payload.length > 100000) return conflict()
  const request = storyCaptionSaveRequest(JSON.parse(row.payload))
  if (request.id !== row.id) return conflict()
  return { ...request, state: row.state }
}
function requireDraft(db: Database.Database, request: StoryCaptionSaveRequest): void {
  const row = db.prepare('SELECT payload,revision FROM story_caption_drafts WHERE privacy=? AND story_id=?').get(request.privacy, request.storyId) as { payload: string | null; revision: string } | undefined
  if (!row?.payload || row.payload.length > 100000 || row.revision !== request.draftRevision || JSON.stringify(storyCaptionDraft(JSON.parse(row.payload))) !== JSON.stringify(request.draft)) return conflict()
}
export function executeStoryCaptionSave(db: Database.Database, command: StoryCaptionSaveCommand, uid: string): PendingStoryCaptionSave | null {
  if (command.kind === 'story-caption-save-read') { const pending = pendingStoryCaptionSave(db); if (pending && pending.ownerId !== uid) return conflict(); return pending }
  return db.transaction(() => {
    const current = pendingStoryCaptionSave(db)
    if (command.kind === 'story-caption-save-prepare') {
      const request = storyCaptionSaveRequest(command.request)
      if (pendingStoryHiddenChange(db)?.storyId === request.storyId) return conflict()
      if (pendingStoryPrivacyMove(db)?.storyId === request.storyId) return conflict()
      if (request.ownerId !== uid || (pendingStoryRemoval(db)?.storyId === request.storyId && pendingStoryRemoval(db)?.privacy === request.privacy)) return conflict()
      if (current) { const { state, ...previous } = current; if (state === 'prepared' && JSON.stringify(previous) === JSON.stringify(request)) return current; return conflict() }
      if (db.prepare('SELECT 1 FROM story_caption_saves WHERE id=?').get(request.id)) return conflict()
      if ((db.prepare('SELECT COUNT(*) AS n FROM story_caption_saves').get() as { n: number }).n >= 10000) throw Object.assign(new Error('Note text save capacity'), { deliveryCode: 'capacity' })
      requireDraft(db, request)
      const payload = JSON.stringify(request)
      if (payload.length > 100000) return conflict()
      db.prepare("INSERT INTO story_caption_saves(id,payload,state) VALUES(?,?,'prepared')").run(request.id, payload)
    } else {
      backgroundPhotoId(command.id)
      if (command.state === 'submitted' && current && pendingStoryHiddenChange(db)?.storyId === current.storyId) return conflict()
      if (command.state === 'submitted' && current && pendingStoryPrivacyMove(db)?.storyId === current.storyId) return conflict()
      if (!current || current.id !== command.id || current.state !== command.expected || current.ownerId !== uid) return conflict()
      if (!(command.state === 'dismissed' || (current.state === 'prepared' && command.state === 'submitted') || (current.state === 'submitted' && ['confirmed', 'rejected'].includes(command.state)))) return conflict()
      if (command.state === 'submitted' && pendingStoryRemoval(db)?.storyId === current.storyId && pendingStoryRemoval(db)?.privacy === current.privacy) return conflict()
      if (command.state === 'submitted' || command.state === 'confirmed') requireDraft(db, current)
      if (command.state === 'confirmed') db.prepare('UPDATE story_caption_drafts SET payload=NULL,revision=? WHERE privacy=? AND story_id=?').run(randomUUID(), current.privacy, current.storyId)
      db.prepare('UPDATE story_caption_saves SET state=?,payload=CASE WHEN ? THEN NULL ELSE payload END WHERE id=?').run(command.state, command.state === 'dismissed' ? 1 : 0, command.id)
    }
    return pendingStoryCaptionSave(db)
  })()
}
