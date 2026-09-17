import type Database from 'better-sqlite3-multiple-ciphers'
import { identifier } from '../../shared/validation'

export type MessageBookmarkCommand =
  | { kind: 'bookmarks-read'; chatId: string }
  | { kind: 'bookmark-set'; chatId: string; messageId: string; on: boolean }

// "나에게만 고정" (iOS MessageStore.isBookmarked with bookmarkOrder_{chat}): kept on this
// device only, in the order the messages were pinned.
export function executeMessageBookmark(db: Database.Database, command: MessageBookmarkCommand): unknown {
  const chatId = identifier(command.chatId)
  if (command.kind === 'bookmarks-read') {
    const rows = db.prepare('SELECT message_id FROM message_bookmarks WHERE chat_id=? ORDER BY created_at, message_id').all(chatId) as { message_id: string }[]
    return rows.map(row => identifier(row.message_id))
  }
  const messageId = identifier(command.messageId)
  if (command.on) db.prepare('INSERT INTO message_bookmarks(chat_id,message_id,created_at) VALUES(?,?,?) ON CONFLICT(chat_id,message_id) DO NOTHING').run(chatId, messageId, Date.now())
  else db.prepare('DELETE FROM message_bookmarks WHERE chat_id=? AND message_id=?').run(chatId, messageId)
  return null
}
