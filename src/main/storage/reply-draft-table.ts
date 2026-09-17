import type Database from 'better-sqlite3-multiple-ciphers'
import type { ReplyBinding } from '../../shared/reply-draft'
import { identifier } from '../../shared/validation'

export type ReplyDraftCommand =
  | { kind: 'reply-draft'; chatId: string }
  | { kind: 'reply-select'; chatId: string; selection: ReplyBinding }
  | { kind: 'reply-clear'; chatId: string; selectionId: string }

export function storedReply(db: Database.Database, chatId: string): ReplyBinding | null {
  const row = db.prepare('SELECT selection_id,message_id FROM reply_drafts WHERE chat_id=?').get(identifier(chatId)) as
    { selection_id: string; message_id: string } | undefined
  return row ? { selectionId: identifier(row.selection_id), messageId: identifier(row.message_id) } : null
}
export function requireReply(db: Database.Database, chatId: string, expected: ReplyBinding | null, replyToId?: string): void {
  const current = storedReply(db, chatId)
  if ((current?.selectionId ?? null) !== (expected?.selectionId ?? null) || (current?.messageId ?? null) !== (expected?.messageId ?? null) ||
    (current?.messageId ?? undefined) !== replyToId) throw Object.assign(new Error('Reply draft changed'), { deliveryCode: 'conflict' })
}
export function executeReplyDraft(db: Database.Database, command: ReplyDraftCommand): unknown {
  const chatId = identifier(command.chatId)
  switch (command.kind) {
    case 'reply-draft': return storedReply(db, chatId)
    case 'reply-select':
      db.prepare(`INSERT INTO reply_drafts(chat_id,selection_id,message_id) VALUES(?,?,?)
        ON CONFLICT(chat_id) DO UPDATE SET selection_id=excluded.selection_id,message_id=excluded.message_id`)
        .run(chatId, identifier(command.selection.selectionId), identifier(command.selection.messageId)); return null
    case 'reply-clear': return db.prepare('DELETE FROM reply_drafts WHERE chat_id=? AND selection_id=?').run(chatId, identifier(command.selectionId)).changes === 1
  }
}
