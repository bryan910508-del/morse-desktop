import type Database from 'better-sqlite3-multiple-ciphers'
import { channelCreationRequest, type ChannelCreationRequest, type ChannelCreationState, type PendingChannelCreation } from '../../shared/channel-creation'
import { backgroundPhotoId } from '../../shared/chat-background'
export type ChannelCreationCommand = { kind: 'channel-creation-read' } | { kind: 'channel-creation-prepare'; request: ChannelCreationRequest } |
  { kind: 'channel-creation-state'; id: string; expected: ChannelCreationState; state: ChannelCreationState | 'dismissed' }
const conflict = (): never => { throw Object.assign(new Error('Channel creation changed'), { deliveryCode: 'conflict' }) }
function pending(db: Database.Database, uid: string): PendingChannelCreation | null {
  const rows = db.prepare('SELECT id,payload,state FROM channel_creations WHERE payload IS NOT NULL LIMIT 2').all() as { id: string; payload: string; state: ChannelCreationState }[]
  if (rows.length > 1) return conflict()
  const row = rows[0]
  if (!row) return null
  if (!['prepared', 'submitted', 'confirmed', 'rejected'].includes(row.state) || row.payload.length > 180000) return conflict()
  const request = channelCreationRequest(JSON.parse(row.payload))
  if (request.id !== row.id || request.ownerId !== uid) return conflict()
  return { ...request, state: row.state }
}
export function executeChannelCreation(db: Database.Database, command: ChannelCreationCommand, uid: string): PendingChannelCreation | null {
  if (command.kind === 'channel-creation-read') return pending(db, uid)
  return db.transaction(() => {
    const current = pending(db, uid)
    if (command.kind === 'channel-creation-prepare') {
      const request = channelCreationRequest(command.request)
      if (request.ownerId !== uid) return conflict()
      if (current) { const { state, ...previous } = current; if (state === 'prepared' && JSON.stringify(previous) === JSON.stringify(request)) return current; return conflict() }
      if (db.prepare('SELECT 1 FROM channel_creations WHERE id=?').get(request.id)) return conflict()
      if ((db.prepare('SELECT COUNT(*) AS n FROM channel_creations').get() as { n: number }).n >= 10000) throw Object.assign(new Error('Channel creation capacity'), { deliveryCode: 'capacity' })
      db.prepare("INSERT INTO channel_creations(id,payload,state) VALUES(?,?,'prepared')").run(request.id, JSON.stringify(request))
    } else {
      backgroundPhotoId(command.id)
      if (!current || current.id !== command.id || current.state !== command.expected) return conflict()
      if (!(command.state === 'dismissed' || (current.state === 'prepared' && command.state === 'submitted') || (current.state === 'submitted' && ['confirmed', 'rejected'].includes(command.state)))) return conflict()
      db.prepare('UPDATE channel_creations SET state=?,payload=CASE WHEN ? THEN NULL ELSE payload END WHERE id=?').run(command.state, command.state === 'dismissed' ? 1 : 0, command.id)
    }
    return pending(db, uid)
  })()
}
