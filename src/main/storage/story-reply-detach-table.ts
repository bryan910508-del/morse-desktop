import type Database from 'better-sqlite3-multiple-ciphers'
import { backgroundPhotoId } from '../../shared/chat-background'
import { draftText, identifier } from '../../shared/validation'
import { storyReplySendRequest, type StoryReplySendRequest } from '../../shared/story-reply-send'
import type { StoryReplyDetachReceipt } from '../../shared/story-reply-detach'
import { pendingStoryReplyDraft } from './story-reply-draft-table'
export type StoryReplyDetachCommand = { kind: 'story-reply-detach-known'; id: string } | { kind: 'story-reply-detach-list' } | { kind: 'story-reply-detach'; request: StoryReplySendRequest; chatId: string }
const conflict = (): never => { throw Object.assign(new Error('Story reply draft transfer conflict'), { deliveryCode: 'conflict' }) }
type Row = { id: string; chat_id: string; created_at: number }
function receipt(row: Row): StoryReplyDetachReceipt {
  if (!Number.isSafeInteger(row.created_at) || row.created_at <= 0 || row.created_at > 8640000000000000) return conflict()
  return { id: backgroundPhotoId(row.id), chatId: identifier(row.chat_id), createdAt: row.created_at }
}
const select = "SELECT d.id,d.chat_id,d.created_at FROM story_reply_detachments d JOIN story_reply_drafts s ON s.id=d.id WHERE s.state='detached' AND s.payload IS NULL"
function known(db: Database.Database, id: string): StoryReplyDetachReceipt | null { const row = db.prepare(select + ' AND d.id=?').get(backgroundPhotoId(id)) as Row | undefined; return row ? receipt(row) : null }
export function executeStoryReplyDetach(db: Database.Database, uid: string, command: StoryReplyDetachCommand): StoryReplyDetachReceipt | StoryReplyDetachReceipt[] | null {
  if (command.kind === 'story-reply-detach-known') return known(db, command.id)
  if (command.kind === 'story-reply-detach-list') return (db.prepare(select + ' ORDER BY d.created_at DESC,d.id DESC LIMIT 50').all() as Row[]).map(receipt)
  return db.transaction(() => {
    const request = storyReplySendRequest(command.request), previous = known(db, request.id)
    if (previous) return previous // Never restore a draft the user subsequently edited, sent or deleted.
    const pending = pendingStoryReplyDraft(db, uid), chatId = identifier(command.chatId)
    if (!pending || pending.id !== request.id || pending.revision !== request.revision) return conflict()
    const peer = db.prepare('SELECT peer_uid FROM pending_directs WHERE chat_id=?').get(chatId) as { peer_uid: string } | undefined
    if (peer && peer.peer_uid !== pending.ownerId) return conflict()
    const text = draftText(pending.text)
    if (!text.length) return conflict()
    const existing = db.prepare('SELECT text FROM local_drafts WHERE chat_id=?').get(chatId) as { text: string } | undefined
    if ((existing && existing.text !== '') || db.prepare('SELECT 1 FROM reply_drafts WHERE chat_id=?').get(chatId) || db.prepare('SELECT 1 FROM intents WHERE id=?').get(request.id)) return conflict()
    if (db.prepare('SELECT 1 FROM story_reply_detachments WHERE id=?').get(request.id)) return conflict()
    const createdAt = Date.now()
    db.prepare('INSERT INTO local_drafts(chat_id,text) VALUES(?,?) ON CONFLICT(chat_id) DO UPDATE SET text=excluded.text').run(chatId, text)
    db.prepare('INSERT INTO story_reply_detachments(id,chat_id,created_at) VALUES(?,?,?)').run(request.id, chatId, createdAt)
    db.prepare("UPDATE story_reply_drafts SET state='detached',payload=NULL WHERE id=?").run(request.id)
    db.prepare('DELETE FROM story_reply_texts WHERE draft_id=?').run(request.id)
    return { id: request.id, chatId, createdAt }
  })()
}
