import type Database from 'better-sqlite3-multiple-ciphers'
import { storyReactionChangeRequest, type StoryReactionChangeRequest, type PendingStoryReactionChange, type StoryReactionChangeState } from '../../shared/story-reaction-change'
import { backgroundPhotoId } from '../../shared/chat-background'
export type StoryReactionChangeCommand = { kind: 'story-reaction-change-read' } | { kind: 'story-reaction-change-prepare'; request: StoryReactionChangeRequest } | { kind: 'story-reaction-change-state'; id: string; expected: StoryReactionChangeState; state: StoryReactionChangeState | 'dismissed' }
const conflict = (): never => { throw Object.assign(new Error('Story reaction review changed'), { deliveryCode: 'conflict' }) }
function pending(db: Database.Database, uid: string): PendingStoryReactionChange | null {
  const rows = db.prepare('SELECT id,payload,state FROM story_reaction_changes WHERE payload IS NOT NULL LIMIT 2').all() as { id: string; payload: string; state: string }[]
  if (rows.length > 1) return conflict()
  const row = rows[0]; if (!row) return null
  if (!['prepared','submitted','confirmed','rejected'].includes(row.state) || row.payload.length > 16000) return conflict()
  const request = storyReactionChangeRequest(JSON.parse(row.payload))
  if (request.id !== row.id || request.viewerId !== uid) return conflict()
  return { ...request, state: row.state as StoryReactionChangeState }
}
export function executeStoryReactionChange(db: Database.Database, command: StoryReactionChangeCommand, uid: string): PendingStoryReactionChange | null {
  if (command.kind === 'story-reaction-change-read') return pending(db, uid)
  return db.transaction(() => {
    const current = pending(db, uid)
    if (command.kind === 'story-reaction-change-prepare') {
      const request = storyReactionChangeRequest(command.request)
      if (request.viewerId !== uid) return conflict()
      if (current) { const { state, ...previous } = current; if (state === 'prepared' && JSON.stringify(previous) === JSON.stringify(request)) return current; return conflict() }
      if (db.prepare('SELECT 1 FROM story_reaction_changes WHERE id=?').get(request.id)) return conflict()
      if ((db.prepare('SELECT COUNT(*) AS n FROM story_reaction_changes').get() as { n: number }).n >= 10000) throw Object.assign(new Error('Story reaction review capacity'), { deliveryCode: 'capacity' })
      const payload = JSON.stringify(request); if (payload.length > 16000) return conflict()
      db.prepare("INSERT INTO story_reaction_changes(id,payload,state) VALUES(?,?,'prepared')").run(request.id, payload)
    } else {
      backgroundPhotoId(command.id)
      if (command.kind !== 'story-reaction-change-state' || !current || current.id !== command.id || current.state !== command.expected) return conflict()
      if (!(command.state === 'dismissed' || (current.state === 'prepared' && command.state === 'submitted') || (current.state === 'submitted' && ['confirmed','rejected'].includes(command.state)))) return conflict()
      db.prepare('UPDATE story_reaction_changes SET state=?,payload=CASE WHEN ? THEN NULL ELSE payload END WHERE id=?').run(command.state, command.state === 'dismissed' ? 1 : 0, command.id)
    }
    return pending(db, uid)
  })()
}
