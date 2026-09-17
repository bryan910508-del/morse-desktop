import type Database from 'better-sqlite3-multiple-ciphers'
import { identifier } from '../../shared/validation'

export type ChatFlagCommand =
  | { kind: 'chat-flags-read' }
  | { kind: 'chat-flag-set'; chatId: string; muted?: boolean; archived?: boolean; category?: string | null }

// A chat's «알림 끄기» and «보관» kept on this device only, as Telegram keeps them per person. The iOS app
// writes chats.isMuted / isArchived into the room document everyone shares; the user chose not to follow that.
export function executeChatFlag(db: Database.Database, command: ChatFlagCommand): unknown {
  if (command.kind === 'chat-flags-read') {
    const rows = db.prepare('SELECT chat_id, muted, archived, category FROM chat_flags').all() as { chat_id: string; muted: number; archived: number; category: string | null }[]
    return rows.flatMap(row => {
      try { return [{ chatId: identifier(row.chat_id), muted: row.muted === 1, archived: row.archived === 1, category: row.category ? identifier(row.category) : null }] } catch { return [] }
    })
  }
  const chatId = identifier(command.chatId)
  if (command.muted === undefined && command.archived === undefined && command.category === undefined) throw new Error('Invalid chat flag')
  if (command.category !== undefined && command.category !== null) identifier(command.category)
  if ((command.muted !== undefined && typeof command.muted !== 'boolean') || (command.archived !== undefined && typeof command.archived !== 'boolean')) throw new Error('Invalid chat flag')
  db.prepare('INSERT INTO chat_flags(chat_id,muted,archived) VALUES(?,0,0) ON CONFLICT(chat_id) DO NOTHING').run(chatId)
  if (command.muted !== undefined) db.prepare('UPDATE chat_flags SET muted=? WHERE chat_id=?').run(command.muted ? 1 : 0, chatId)
  if (command.archived !== undefined) db.prepare('UPDATE chat_flags SET archived=? WHERE chat_id=?').run(command.archived ? 1 : 0, chatId)
  if (command.category !== undefined) db.prepare('UPDATE chat_flags SET category=? WHERE chat_id=?').run(command.category, chatId)
  db.prepare('DELETE FROM chat_flags WHERE chat_id=? AND muted=0 AND archived=0 AND category IS NULL').run(chatId)
  return null
}
