import { pendingStoryHiddenChange } from './story-hidden-change-table'
import { pendingStoryRemoval } from './story-removal-table'
import type Database from 'better-sqlite3-multiple-ciphers'
import { storyPrivacyMoveRequest, type StoryPrivacyMoveRequest, type StoryPrivacyMoveState, type PendingStoryPrivacyMove } from '../../shared/story-privacy-move'
import { pendingStoryCaptionSave } from './story-caption-save-table'
import { backgroundPhotoId } from '../../shared/chat-background'
export type StoryPrivacyMoveCommand = { kind: 'story-privacy-move-read' } | { kind: 'story-privacy-move-prepare'; request: StoryPrivacyMoveRequest } | { kind: 'story-privacy-move-state'; id: string; expected: StoryPrivacyMoveState; state: StoryPrivacyMoveState | 'dismissed' }
const conflict = (): never => { throw Object.assign(new Error('Note removal or pending text save changed'), { deliveryCode: 'conflict' }) }
export function pendingStoryPrivacyMove(db: Database.Database): PendingStoryPrivacyMove | null {
  const rows = db.prepare('SELECT id,payload,state FROM story_privacy_moves WHERE payload IS NOT NULL LIMIT 2').all() as { id: string; payload: string; state: StoryPrivacyMoveState }[]
  if (rows.length > 1) return conflict()
  const row = rows[0]
  if (!row) return null
  if (!['prepared', 'submitted', 'confirmed', 'rejected'].includes(row.state) || row.payload.length > 100000) return conflict()
  const request = storyPrivacyMoveRequest(JSON.parse(row.payload))
  if (request.id !== row.id) return conflict()
  return { ...request, state: row.state }
}
export function executeStoryPrivacyMove(db: Database.Database, command: StoryPrivacyMoveCommand, uid: string): PendingStoryPrivacyMove | null {
  if (command.kind === 'story-privacy-move-read') { const pending = pendingStoryPrivacyMove(db); if (pending && pending.ownerId !== uid) return conflict(); return pending }
  return db.transaction(() => {
    const current = pendingStoryPrivacyMove(db)
    if (command.kind === 'story-privacy-move-prepare') {
      const request = storyPrivacyMoveRequest(command.request)
      if (pendingStoryHiddenChange(db)?.storyId === request.storyId) return conflict()
      if (request.ownerId !== uid || (pendingStoryCaptionSave(db)?.storyId === request.storyId || pendingStoryRemoval(db)?.storyId === request.storyId)) return conflict()
      if (current) { const { state, ...previous } = current; if (state === 'prepared' && JSON.stringify(previous) === JSON.stringify(request)) return current; return conflict() }
      if (db.prepare('SELECT 1 FROM story_privacy_moves WHERE id=?').get(request.id)) return conflict()
      if ((db.prepare('SELECT COUNT(*) AS n FROM story_privacy_moves').get() as { n: number }).n >= 10000) throw Object.assign(new Error('Note removal capacity'), { deliveryCode: 'capacity' })
      const payload = JSON.stringify(request)
      if (payload.length > 100000) return conflict()
      db.prepare("INSERT INTO story_privacy_moves(id,payload,state) VALUES(?,?,'prepared')").run(request.id, payload)
    } else {
      backgroundPhotoId(command.id)
      if (command.state === 'submitted' && current && pendingStoryHiddenChange(db)?.storyId === current.storyId) return conflict()
      if (!current || current.id !== command.id || current.state !== command.expected || current.ownerId !== uid) return conflict()
      if (!(command.state === 'dismissed' || (current.state === 'prepared' && command.state === 'submitted') || (current.state === 'submitted' && ['confirmed', 'rejected'].includes(command.state)))) return conflict()
      if (command.state === 'submitted' && (pendingStoryCaptionSave(db)?.storyId === current.storyId || pendingStoryRemoval(db)?.storyId === current.storyId)) return conflict()
      // Deleting a server note never consumes an independently retained local edit draft.
      db.prepare('UPDATE story_privacy_moves SET state=?,payload=CASE WHEN ? THEN NULL ELSE payload END WHERE id=?').run(command.state, command.state === 'dismissed' ? 1 : 0, command.id)
    }
    return pendingStoryPrivacyMove(db)
  })()
}
