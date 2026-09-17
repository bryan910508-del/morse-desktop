import type Database from 'better-sqlite3-multiple-ciphers'
import { channelJoinDecisionRequest, type ChannelJoinDecisionRequest, type ChannelJoinDecisionState, type PendingChannelJoinDecision } from '../../shared/channel-join-decisions'
import { backgroundPhotoId } from '../../shared/chat-background'
export type ChannelJoinDecisionCommand = { kind: 'channel-join-decision-read' } | { kind: 'channel-join-decision-prepare'; request: ChannelJoinDecisionRequest } |
  { kind: 'channel-join-decision-state'; id: string; expected: ChannelJoinDecisionState; state: ChannelJoinDecisionState | 'dismissed' }
const conflict = (): never => { throw Object.assign(new Error('Channel join decision request changed'), { deliveryCode: 'conflict' }) }
function pending(db: Database.Database, uid: string): PendingChannelJoinDecision | null {
  const rows = db.prepare('SELECT id,payload,state FROM channel_join_decisions WHERE payload IS NOT NULL LIMIT 2').all() as { id: string; payload: string; state: ChannelJoinDecisionState }[]
  if (rows.length > 1) return conflict()
  const row = rows[0]
  if (!row) return null
  if (!['prepared', 'submitted', 'confirmed', 'rejected'].includes(row.state) || row.payload.length > 10000) return conflict()
  const request = channelJoinDecisionRequest(JSON.parse(row.payload))
  if (request.id !== row.id || request.userId === uid) return conflict()
  return { ...request, state: row.state }
}
export function executeChannelJoinDecision(db: Database.Database, uid: string, command: ChannelJoinDecisionCommand): PendingChannelJoinDecision | null {
  if (command.kind === 'channel-join-decision-read') return pending(db, uid)
  return db.transaction(() => {
    const current = pending(db, uid)
    if (command.kind === 'channel-join-decision-prepare') {
      const request = channelJoinDecisionRequest(command.request)
      if (request.userId === uid) return conflict()
      if (current) {
        const { state, ...previous } = current
        if (state === 'prepared' && JSON.stringify(previous) === JSON.stringify(request)) return current
        return conflict()
      }
      if (db.prepare('SELECT 1 FROM channel_join_decisions WHERE id=?').get(request.id)) return conflict()
      if ((db.prepare('SELECT COUNT(*) AS n FROM channel_join_decisions').get() as { n: number }).n >= 10000) throw Object.assign(new Error('Channel join decision capacity'), { deliveryCode: 'capacity' })
      db.prepare("INSERT INTO channel_join_decisions(id,payload,state) VALUES(?,?,'prepared')").run(request.id, JSON.stringify(request))
    } else {
      backgroundPhotoId(command.id)
      if (!current || current.id !== command.id || current.state !== command.expected) return conflict()
      const valid = command.state === 'dismissed' || (current.state === 'prepared' && command.state === 'submitted') ||
        (current.state === 'submitted' && ['confirmed', 'rejected'].includes(command.state))
      if (!valid) return conflict()
      db.prepare('UPDATE channel_join_decisions SET state=?,payload=CASE WHEN ? THEN NULL ELSE payload END WHERE id=?').run(command.state, command.state === 'dismissed' ? 1 : 0, command.id)
    }
    return pending(db, uid)
  })()
}
