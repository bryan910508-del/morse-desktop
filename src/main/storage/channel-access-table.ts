import type Database from 'better-sqlite3-multiple-ciphers'
import { accessStates, channelAccessRequest, type ChannelAccessRequest, type ChannelAccessState, type PendingChannelAccess } from '../../shared/channel-access-edit'
import { backgroundPhotoId } from '../../shared/chat-background'
export type ChannelAccessCommand = { kind: 'channel-access-read' } | { kind: 'channel-access-prepare'; request: ChannelAccessRequest } |
  { kind: 'channel-access-state'; id: string; expected: ChannelAccessState; state: ChannelAccessState | 'dismissed' }
const conflict = (): never => { throw Object.assign(new Error('Channel access request changed'), { deliveryCode: 'conflict' }) }
function pending(db: Database.Database): PendingChannelAccess | null {
  const rows = db.prepare('SELECT id,payload,state FROM channel_access_changes WHERE payload IS NOT NULL LIMIT 2').all() as { id: string; payload: string; state: ChannelAccessState }[]
  if (rows.length > 1) return conflict()
  const row = rows[0]
  if (!row) return null
  if (!accessStates.includes(row.state) || row.payload.length > 10000) return conflict()
  const request = channelAccessRequest(JSON.parse(row.payload))
  if (request.id !== row.id) return conflict()
  return { ...request, state: row.state }
}
export function executeChannelAccess(db: Database.Database, command: ChannelAccessCommand): PendingChannelAccess | null {
  if (command.kind === 'channel-access-read') return pending(db)
  return db.transaction(() => {
    const current = pending(db)
    if (command.kind === 'channel-access-prepare') {
      const request = channelAccessRequest(command.request)
      if (current) {
        const { state, ...previous } = current
        if (state === 'prepared' && JSON.stringify(previous) === JSON.stringify(request)) return current
        return conflict()
      }
      if (db.prepare('SELECT 1 FROM channel_access_changes WHERE id=?').get(request.id)) return conflict()
      if ((db.prepare('SELECT COUNT(*) AS n FROM channel_access_changes').get() as { n: number }).n >= 10000) throw Object.assign(new Error('Channel access capacity'), { deliveryCode: 'capacity' })
      db.prepare("INSERT INTO channel_access_changes(id,payload,state) VALUES(?,?,'prepared')").run(request.id, JSON.stringify(request))
    } else {
      backgroundPhotoId(command.id)
      if (!current || current.id !== command.id || current.state !== command.expected) return conflict()
      const transitions: Record<ChannelAccessState, ChannelAccessState[]> = {
        prepared: current.mode === 'sync' ? ['settings-ready'] : ['saving'], saving: ['settings-ready', 'save-rejected'],
        'settings-ready': ['joining'], joining: ['discussion-ready', 'join-rejected'], 'discussion-ready': ['syncing'], syncing: ['completed', 'sync-rejected'],
        completed: [], 'save-rejected': ['saving'], 'join-rejected': ['joining'], 'sync-rejected': ['syncing']
      }
      if (command.state !== 'dismissed' && !transitions[current.state].includes(command.state)) return conflict()
      db.prepare('UPDATE channel_access_changes SET state=?,payload=CASE WHEN ? THEN NULL ELSE payload END WHERE id=?').run(command.state, command.state === 'dismissed' ? 1 : 0, command.id)
    }
    return pending(db)
  })()
}
