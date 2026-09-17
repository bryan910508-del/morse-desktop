import { storyReplyHistoryRequest, type StoryReplyHistoryRequest, type StoryReplyHistoryPage, type StoryReplyHistoryItem } from '../../shared/story-reply-history'
import type Database from 'better-sqlite3-multiple-ciphers'
import { storyReplySendRequest, type StoryReplySendRequest, type StoryReplySendReceipt } from '../../shared/story-reply-send'
import { backgroundPhotoId } from '../../shared/chat-background'
import { identifier } from '../../shared/validation'
import type { TextSendWire } from '../../shared/model'
import { maxQueuedMessages } from '../../shared/delivery'
import { pendingStoryReplyDraft } from './story-reply-draft-table'
import { storyReplyWire } from '../messaging/story-reply-wire'
import { textDigest } from '../messaging/text-identity'
export type StoryReplySendCommand = { kind: 'story-reply-send-history'; request: StoryReplyHistoryRequest } | { kind: 'story-reply-send-known'; id: string } | { kind: 'enqueue-story-reply'; request: StoryReplySendRequest; wire: TextSendWire }
const conflict = (): never => { throw Object.assign(new Error('Story reply queue conflict'), { deliveryCode: 'conflict' }) }
function known(db: Database.Database, id: string): StoryReplySendReceipt | null {
  const row = db.prepare("SELECT i.chat_id,i.forward_operation_id FROM story_reply_drafts s JOIN intents i ON i.id=s.id WHERE s.id=? AND s.state='queued' AND s.payload IS NULL").get(backgroundPhotoId(id)) as { chat_id: string; forward_operation_id: string | null } | undefined
  if (!row) return null
  if (row.forward_operation_id) return conflict()
  return { id, chatId: identifier(row.chat_id) }
}
function history(db: Database.Database, input: StoryReplyHistoryRequest): StoryReplyHistoryPage {
  const request = storyReplyHistoryRequest(input)
  const rows = db.prepare(`SELECT i.sequence,i.id,i.chat_id,i.created_at,i.state,i.forward_operation_id,(i.wire IS NOT NULL) AS active
    FROM intents i JOIN story_reply_drafts s ON s.id=i.id
    WHERE s.state='queued' AND s.payload IS NULL AND (? IS NULL OR i.sequence < ?)
    ORDER BY i.sequence DESC LIMIT 51`).all(request.before, request.before) as { sequence: number; id: string; chat_id: string; created_at: number; state: StoryReplyHistoryItem['state']; forward_operation_id: string | null; active: number }[]
  const items = rows.slice(0, 50).map(row => {
    if (!Number.isSafeInteger(row.sequence) || row.sequence <= 0 || !Number.isSafeInteger(row.created_at) || row.created_at <= 0 || row.created_at > 8640000000000000 || row.forward_operation_id || !['queued', 'uncertain', 'failed', 'done', 'discarded'].includes(row.state) || Boolean(row.active) !== !['done', 'discarded'].includes(row.state)) return conflict()
    return { id: backgroundPhotoId(row.id), chatId: identifier(row.chat_id), sequence: row.sequence, createdAt: row.created_at, state: row.state }
  })
  const last = items[items.length - 1]
  if (rows.length > 50 && !last) return conflict()
  return { items, next: rows.length > 50 && last ? last.sequence : null }
}
export function executeStoryReplySend(db: Database.Database, command: StoryReplySendCommand, uid: string): StoryReplySendReceipt | StoryReplyHistoryPage | null {
  if (command.kind === 'story-reply-send-history') return history(db, command.request)
  if (command.kind === 'story-reply-send-known') return known(db, command.id)
  return db.transaction(() => {
    const request = storyReplySendRequest(command.request), receipt = known(db, request.id)
    if (receipt) return receipt // Retained identity survives body deletion; never recreate it.
    const pending = pendingStoryReplyDraft(db, uid)
    if (!pending || pending.id !== request.id || pending.revision !== request.revision || pending.expiresAt <= Date.now()) return conflict()
    const chatId = identifier(command.wire.chatId)
    const peer = db.prepare('SELECT peer_uid FROM pending_directs WHERE chat_id=?').get(chatId) as { peer_uid: string } | undefined
    const expected = storyReplyWire(pending, chatId, peer?.peer_uid)
    if (JSON.stringify(expected) !== JSON.stringify(command.wire)) return conflict()
    if (db.prepare('SELECT 1 FROM intents WHERE id=?').get(request.id)) return conflict()
    if ((db.prepare('SELECT COUNT(*) AS n FROM intents WHERE wire IS NOT NULL').get() as { n: number }).n >= maxQueuedMessages) throw Object.assign(new Error('Outbox full'), { deliveryCode: 'capacity' })
    db.prepare("INSERT INTO intents(id,chat_id,wire,digest,created_at,state) VALUES(?,?,?,?,?,'queued')").run(expected.id, chatId, JSON.stringify(expected), textDigest(expected), Date.now())
    db.prepare("UPDATE story_reply_drafts SET state='queued',payload=NULL WHERE id=?").run(request.id)
    db.prepare('DELETE FROM story_reply_texts WHERE draft_id=?').run(request.id)
    // The direct chat's ordinary text/reply drafts belong to a separate editor.
    return { id: request.id, chatId }
  })()
}
