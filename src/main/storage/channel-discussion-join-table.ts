import type Database from 'better-sqlite3-multiple-ciphers'
import type { DeliveryCommand } from './delivery-protocol'
import { discussionJoinRequest, type DiscussionJoinRequest, type DiscussionJoinState, type PendingDiscussionJoin } from '../../shared/channel-discussion-join'
import { backgroundPhotoId } from '../../shared/chat-background'
import { channelAccessRequest } from '../../shared/channel-access-edit'
export type DiscussionJoinCommand = { kind: 'discussion-join-read' } | { kind: 'discussion-join-prepare'; request: DiscussionJoinRequest } |
  { kind: 'discussion-join-state'; id: string; expected: DiscussionJoinState; state: DiscussionJoinState | 'dismissed' }
const conflict = (): never => { throw Object.assign(new Error('Discussion participation record changed or conflicting work exists'), { deliveryCode: 'conflict' }) }
function pending(db: Database.Database): PendingDiscussionJoin | null {
  const rows = db.prepare('SELECT id,payload,state FROM channel_discussion_joins WHERE payload IS NOT NULL LIMIT 2').all() as { id: string; payload: string; state: DiscussionJoinState }[]
  if (rows.length > 1) return conflict()
  const row = rows[0]
  if (!row) return null
  if (!['prepared', 'submitted', 'confirmed', 'rejected'].includes(row.state) || row.payload.length > 10000) return conflict()
  const request = discussionJoinRequest(JSON.parse(row.payload))
  if (request.id !== row.id) return conflict()
  return { ...request, state: row.state }
}
function requireAvailable(db: Database.Database, request: DiscussionJoinRequest): void {
  const settings = db.prepare('SELECT payload FROM channel_access_changes WHERE payload IS NOT NULL LIMIT 2').all() as { payload: string }[]
  if (settings.length > 1 || settings.some(row => channelAccessRequest(JSON.parse(row.payload)).channelId === request.channelId)) return conflict()
  requireEmptyWork(db, request.chatId)
}
export function executeDiscussionJoin(db: Database.Database, command: DiscussionJoinCommand): PendingDiscussionJoin | null {
  if (command.kind === 'discussion-join-read') return pending(db)
  return db.transaction(() => {
    const current = pending(db)
    if (command.kind === 'discussion-join-prepare') {
      const request = discussionJoinRequest(command.request)
      if (current) {
        const { state, ...previous } = current
        if (state === 'prepared' && JSON.stringify(previous) === JSON.stringify(request)) return current
        return conflict()
      }
      if (db.prepare('SELECT 1 FROM channel_discussion_joins WHERE id=?').get(request.id)) return conflict()
      if ((db.prepare('SELECT COUNT(*) AS n FROM channel_discussion_joins').get() as { n: number }).n >= 10000) throw Object.assign(new Error('Discussion participation capacity'), { deliveryCode: 'capacity' })
      requireAvailable(db, request)
      db.prepare("INSERT INTO channel_discussion_joins(id,payload,state) VALUES(?,?,'prepared')").run(request.id, JSON.stringify(request))
    } else {
      backgroundPhotoId(command.id)
      if (!current || current.id !== command.id || current.state !== command.expected) return conflict()
      if (!(command.state === 'dismissed' || (current.state === 'prepared' && command.state === 'submitted') || (current.state === 'submitted' && ['confirmed', 'rejected'].includes(command.state)))) return conflict()
      if (command.state === 'submitted') requireAvailable(db, current)
      db.prepare('UPDATE channel_discussion_joins SET state=?,payload=CASE WHEN ? THEN NULL ELSE payload END WHERE id=?').run(command.state, command.state === 'dismissed' ? 1 : 0, command.id)
    }
    return pending(db)
  })()
}
export function guardDiscussionJoin(db: Database.Database, command: DeliveryCommand): void {
  let targets: string[] = [], channelId: string | null = null
  switch (command.kind) {
    case 'enqueue': case 'enqueue-attachment': targets = [command.wire.chatId]; break
    case 'enqueue-forward': case 'enqueue-forward-media': case 'enqueue-forward-texts': case 'enqueue-forward-batch': targets = command.request.targets.map(target => target.chatId); break
    case 'action-enqueue': targets = [command.action.chatId]; break
    case 'reply-select': targets = [command.chatId]; break
    case 'voice-draft-write':if(command.request.voice)targets=[command.request.chatId];break
    case 'save-draft': if (command.text) targets = [command.chatId]; break
    case 'channel-access-prepare': channelId = command.request.channelId; break
  }
  if (!targets.length && !channelId) return
  const current = pending(db)
  if (current && (targets.includes(current.chatId) || channelId === current.channelId)) return conflict()
}

// The worker processes commands serially. Checking existing work and saving the
// participation record are one transaction; later enqueues cannot race past it.
function requireEmptyWork(db: Database.Database, chatId: string): void {
  if (db.prepare("SELECT 1 FROM local_drafts WHERE chat_id=? AND text<>''").get(chatId) ||
    db.prepare('SELECT 1 FROM reply_drafts WHERE chat_id=?').get(chatId) ||
    db.prepare('SELECT 1 FROM voice_drafts WHERE chat_id=? AND payload IS NOT NULL').get(chatId) ||
    db.prepare('SELECT 1 FROM intents WHERE chat_id=? AND wire IS NOT NULL LIMIT 1').get(chatId) ||
    db.prepare('SELECT 1 FROM message_actions WHERE chat_id=? AND payload IS NOT NULL LIMIT 1').get(chatId)) {
    throw Object.assign(new Error('Resolve drafts and pending work first'), { deliveryCode: 'conflict' })
  }
}
