import { pendingStoryPrivacyMove } from './story-privacy-move-table'
import { pendingStoryRemoval } from './story-removal-table'
import type Database from 'better-sqlite3-multiple-ciphers'
import { storyHiddenChangeRequest, type StoryHiddenChangeRequest, type StoryHiddenChangeState, type PendingStoryHiddenChange } from '../../shared/story-hidden-change'
import { pendingStoryCaptionSave } from './story-caption-save-table'
import { backgroundPhotoId } from '../../shared/chat-background'
export type StoryHiddenChangeCommand = { kind: 'story-hidden-change-read' } | { kind: 'story-hidden-change-prepare'; request: StoryHiddenChangeRequest } | { kind: 'story-hidden-change-state'; id: string; expected: StoryHiddenChangeState; state: StoryHiddenChangeState | 'dismissed' }
const conflict = (): never => { throw Object.assign(new Error('Story hidden audience or pending mutation changed'), { deliveryCode: 'conflict' }) }
export function pendingStoryHiddenChange(db: Database.Database): PendingStoryHiddenChange | null {
  const rows = db.prepare('SELECT id,payload,state FROM story_hidden_changes WHERE payload IS NOT NULL LIMIT 2').all() as { id: string; payload: string; state: StoryHiddenChangeState }[]
  if (rows.length > 1) return conflict()
  const row = rows[0]
  if (!row) return null
  if (!['prepared', 'submitted', 'confirmed', 'rejected'].includes(row.state) || row.payload.length > 400000) return conflict()
  const request = storyHiddenChangeRequest(JSON.parse(row.payload))
  if (request.id !== row.id) return conflict()
  return { ...request, state: row.state }
}
export function executeStoryHiddenChange(db: Database.Database, command: StoryHiddenChangeCommand, uid: string): PendingStoryHiddenChange | null {
  if (command.kind === 'story-hidden-change-read') { const pending = pendingStoryHiddenChange(db); if (pending && pending.ownerId !== uid) return conflict(); return pending }
  return db.transaction(() => {
    const current = pendingStoryHiddenChange(db)
    if (command.kind === 'story-hidden-change-prepare') {
      const request = storyHiddenChangeRequest(command.request)
      if (request.ownerId !== uid || (pendingStoryCaptionSave(db)?.storyId === request.storyId || pendingStoryRemoval(db)?.storyId === request.storyId || pendingStoryPrivacyMove(db)?.storyId === request.storyId)) return conflict()
      if (current) { const { state, ...previous } = current; if (state === 'prepared' && JSON.stringify(previous) === JSON.stringify(request)) return current; return conflict() }
      if (db.prepare('SELECT 1 FROM story_hidden_changes WHERE id=?').get(request.id)) return conflict()
      if ((db.prepare('SELECT COUNT(*) AS n FROM story_hidden_changes').get() as { n: number }).n >= 10000) throw Object.assign(new Error('Story hidden change capacity'), { deliveryCode: 'capacity' })
      const payload = JSON.stringify(request)
      if (payload.length > 400000) return conflict()
      db.prepare("INSERT INTO story_hidden_changes(id,payload,state) VALUES(?,?,'prepared')").run(request.id, payload)
    } else {
      backgroundPhotoId(command.id)
      if (!current || current.id !== command.id || current.state !== command.expected || current.ownerId !== uid) return conflict()
      if (!(command.state === 'dismissed' || (current.state === 'prepared' && command.state === 'submitted') || (current.state === 'submitted' && ['confirmed', 'rejected'].includes(command.state)))) return conflict()
      if (command.state === 'submitted' && (pendingStoryCaptionSave(db)?.storyId === current.storyId || pendingStoryRemoval(db)?.storyId === current.storyId || pendingStoryPrivacyMove(db)?.storyId === current.storyId)) return conflict()
      // A hidden audience change preserves independently retained caption drafts.
      db.prepare('UPDATE story_hidden_changes SET state=?,payload=CASE WHEN ? THEN NULL ELSE payload END WHERE id=?').run(command.state, command.state === 'dismissed' ? 1 : 0, command.id)
    }
    return pendingStoryHiddenChange(db)
  })()
}
