import { pendingStoryHiddenChange } from './story-hidden-change-table'
import { pendingStoryPrivacyMove } from './story-privacy-move-table'
import type Database from 'better-sqlite3-multiple-ciphers'
import { storyRemovalRequest, type StoryRemovalRequest, type StoryRemovalState, type PendingStoryRemoval } from '../../shared/story-removal'
import { pendingStoryCaptionSave } from './story-caption-save-table'
import { backgroundPhotoId } from '../../shared/chat-background'
export type StoryRemovalCommand = { kind: 'story-removal-read' } | { kind: 'story-removal-prepare'; request: StoryRemovalRequest } | { kind: 'story-removal-state'; id: string; expected: StoryRemovalState; state: StoryRemovalState | 'dismissed' }
const conflict = (): never => { throw Object.assign(new Error('Note removal or pending text save changed'), { deliveryCode: 'conflict' }) }
export function pendingStoryRemoval(db: Database.Database): PendingStoryRemoval | null {
  const rows = db.prepare('SELECT id,payload,state FROM story_removals WHERE payload IS NOT NULL LIMIT 2').all() as { id: string; payload: string; state: StoryRemovalState }[]
  if (rows.length > 1) return conflict()
  const row = rows[0]
  if (!row) return null
  if (!['prepared', 'submitted', 'confirmed', 'rejected'].includes(row.state) || row.payload.length > 100000) return conflict()
  const request = storyRemovalRequest(JSON.parse(row.payload))
  if (request.id !== row.id) return conflict()
  return { ...request, state: row.state }
}
export function executeStoryRemoval(db: Database.Database, command: StoryRemovalCommand, uid: string): PendingStoryRemoval | null {
  if (command.kind === 'story-removal-read') { const pending = pendingStoryRemoval(db); if (pending && pending.ownerId !== uid) return conflict(); return pending }
  return db.transaction(() => {
    const current = pendingStoryRemoval(db)
    if (command.kind === 'story-removal-prepare') {
      const request = storyRemovalRequest(command.request)
      if (pendingStoryHiddenChange(db)?.storyId === request.storyId) return conflict()
      if (pendingStoryPrivacyMove(db)?.storyId === request.storyId) return conflict()
      if (request.ownerId !== uid || (pendingStoryCaptionSave(db)?.storyId === request.storyId && pendingStoryCaptionSave(db)?.privacy === request.privacy)) return conflict()
      if (current) { const { state, ...previous } = current; if (state === 'prepared' && JSON.stringify(previous) === JSON.stringify(request)) return current; return conflict() }
      if (db.prepare('SELECT 1 FROM story_removals WHERE id=?').get(request.id)) return conflict()
      if ((db.prepare('SELECT COUNT(*) AS n FROM story_removals').get() as { n: number }).n >= 10000) throw Object.assign(new Error('Note removal capacity'), { deliveryCode: 'capacity' })
      const payload = JSON.stringify(request)
      if (payload.length > 100000) return conflict()
      db.prepare("INSERT INTO story_removals(id,payload,state) VALUES(?,?,'prepared')").run(request.id, payload)
    } else {
      backgroundPhotoId(command.id)
      if (command.state === 'submitted' && current && pendingStoryHiddenChange(db)?.storyId === current.storyId) return conflict()
      if (command.state === 'submitted' && current && pendingStoryPrivacyMove(db)?.storyId === current.storyId) return conflict()
      if (!current || current.id !== command.id || current.state !== command.expected || current.ownerId !== uid) return conflict()
      if (!(command.state === 'dismissed' || (current.state === 'prepared' && command.state === 'submitted') || (current.state === 'submitted' && ['confirmed', 'rejected'].includes(command.state)))) return conflict()
      if (command.state === 'submitted' && pendingStoryCaptionSave(db)?.storyId === current.storyId && pendingStoryCaptionSave(db)?.privacy === current.privacy) return conflict()
      // Deleting a server note never consumes an independently retained local edit draft.
      db.prepare('UPDATE story_removals SET state=?,payload=CASE WHEN ? THEN NULL ELSE payload END WHERE id=?').run(command.state, command.state === 'dismissed' ? 1 : 0, command.id)
    }
    return pendingStoryRemoval(db)
  })()
}
