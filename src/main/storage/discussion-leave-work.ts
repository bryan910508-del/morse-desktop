import type Database from 'better-sqlite3-multiple-ciphers'
import { discussionLeaveWorkClear, discussionLeaveWorkDismiss, type DiscussionLeaveWork, type DiscussionLeaveWorkClear, type DiscussionLeaveWorkDismiss, type LeaveOutgoingRecord, type LeaveActionRecord } from '../../shared/channel-discussion-leave-work'
import { identifier, draftText, object } from '../../shared/validation'
import { storedReply } from './reply-draft-table'
export type DiscussionLeaveWorkCommand = { kind: 'discussion-leave-work'; chatId: string } | { kind: 'discussion-leave-clear-drafts'; request: DiscussionLeaveWorkClear } | { kind: 'discussion-leave-dismiss-record'; request: DiscussionLeaveWorkDismiss }
type StoredWork = Omit<DiscussionLeaveWork, 'selectedAttachment'>
function read(db: Database.Database, chatId: string): StoredWork {
  identifier(chatId)
  const draft = draftText((db.prepare('SELECT text FROM local_drafts WHERE chat_id=?').get(chatId) as { text: string } | undefined)?.text ?? '')
  const outgoingRows = db.prepare('SELECT id,state,created_at FROM intents WHERE chat_id=? AND wire IS NOT NULL ORDER BY sequence LIMIT 101').all(chatId) as { id: string; state: LeaveOutgoingRecord['state']; created_at: number }[]
  const actionRows = db.prepare('SELECT id,message_id,digest,payload,state FROM message_actions WHERE chat_id=? AND payload IS NOT NULL ORDER BY sequence LIMIT 101').all(chatId) as { id: string; message_id: string; digest: string; payload: string; state: LeaveActionRecord['state'] }[]
  if (outgoingRows.length > 100 || actionRows.length > 100) throw new Error('Local pending work bound exceeded')
  const outgoingItems = outgoingRows.map(row => {
    if (!['queued', 'uncertain', 'failed', 'uploading', 'upload-failed'].includes(row.state) || !Number.isFinite(row.created_at) || row.created_at < 0 || row.created_at > 8640000000000000) throw new Error('Invalid outgoing record')
    return { id: identifier(row.id), state: row.state, createdAt: row.created_at }
  })
  const actionItems = actionRows.map(row => {
    if (row.payload.length > 500000 || !['queued', 'uncertain', 'failed'].includes(row.state) || !/^[a-f0-9]{64}$/.test(row.digest)) throw new Error('Invalid action record')
    const value = object(JSON.parse(row.payload))
    if (value.id !== row.id || value.chatId !== chatId || value.messageId !== row.message_id || !['edit', 'delete', 'reaction'].includes(String(value.kind))) throw new Error('Action identity mismatch')
    return { id: identifier(row.id), messageId: identifier(row.message_id), state: row.state, digest: row.digest, actionKind: value.kind as LeaveActionRecord['actionKind'] }
  })
  return { chatId, draft, voiceDraft:Boolean(db.prepare('SELECT 1 FROM voice_drafts WHERE chat_id=? AND payload IS NOT NULL').get(chatId)), reply: storedReply(db, chatId), outgoing: outgoingItems.length, actions: actionItems.length, outgoingItems, actionItems }
}
export function executeDiscussionLeaveWork(db: Database.Database, command: DiscussionLeaveWorkCommand): StoredWork {
  return db.transaction(() => {
    if (command.kind === 'discussion-leave-work') return read(db, identifier(command.chatId))
    if (command.kind === 'discussion-leave-dismiss-record') {
      const request = discussionLeaveWorkDismiss(command.request), chatId = request.target.chatId
      const conflict = (): never => { throw Object.assign(new Error('Pending record changed'), { deliveryCode: 'conflict' }) }
      if (request.kind === 'action') {
        const row = db.prepare('SELECT state,digest FROM message_actions WHERE id=? AND chat_id=? AND payload IS NOT NULL').get(request.id, chatId) as { state: string; digest: string } | undefined
        if (!row || row.state !== request.state || row.digest !== request.digest) return conflict()
        // Keep the consumed ID and digest even for uncertain, potentially late remote work.
        db.prepare("UPDATE message_actions SET state='dismissed',payload=NULL,reason='' WHERE id=? AND chat_id=?").run(request.id, chatId)
      } else {
        const row = db.prepare('SELECT state FROM intents WHERE id=? AND chat_id=? AND wire IS NOT NULL').get(request.id, chatId) as { state: string } | undefined
        if (!row || row.state !== request.state) return conflict()
        db.prepare('DELETE FROM upload_parts WHERE intent_id=?').run(request.id)
        db.prepare("UPDATE intents SET state='discarded',wire=NULL,upload=NULL,source=NULL,reason='' WHERE id=? AND chat_id=?").run(request.id, chatId)
      }
      return read(db, chatId)
    }
    const request = discussionLeaveWorkClear(command.request), chatId = request.target.chatId, current = read(db, chatId)
    // Compare both reviewed values before either deletion; never clear a newer reply selection.
    if (current.draft !== request.draft || current.reply?.selectionId !== request.reply?.selectionId || current.reply?.messageId !== request.reply?.messageId) throw Object.assign(new Error('Local drafts changed'), { deliveryCode: 'conflict' })
    if (request.clearText) db.prepare('DELETE FROM local_drafts WHERE chat_id=?').run(chatId)
    if (request.clearReply) db.prepare('DELETE FROM reply_drafts WHERE chat_id=?').run(chatId)
    return read(db, chatId)
  })()
}
