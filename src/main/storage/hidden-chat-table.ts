import type Database from 'better-sqlite3-multiple-ciphers'
import { identifier } from '../../shared/validation'

export type HiddenChatCommand =
  | { kind: 'hidden-chats-read' }
  | { kind: 'hidden-chat-set'; chatId: string; on: true; at: number }
  | { kind: 'hidden-chat-set'; chatId: string; on: false }
  | { kind: 'cleared-chats-read' }
  | { kind: 'cleared-chat-set'; chatId: string; cutoff: number }

// Telegram's "Delete chat" for me only, and iOS beginLocalChatDeletion: the moment of deleting is kept
// on this device without a word to the server. Messages up to it stay deleted here, and the room
// leaves the list until a newer message arrives (see HiddenChats).
export function executeHiddenChat(db: Database.Database, command: HiddenChatCommand): unknown {
  if (command.kind === 'hidden-chats-read') {
    const rows = db.prepare('SELECT chat_id, hidden_at FROM hidden_chats').all() as { chat_id: string; hidden_at: number }[]
    return rows.flatMap(row => {
      try { return [{ chatId: identifier(row.chat_id), hiddenAt: Number(row.hidden_at) }] } catch { return [] }
    })
  }
  // Telegram's "Clear history" keeps the chat in the list: History::clear(ClearHistory) turns the last message into the
  // "history cleared" service message, so shouldBeInChatList() still finds a last message. Morse has no such message,
  // so the boundary this device cleared a room at is kept instead: a private room with nothing after exactly that
  // boundary stays listed here, while one emptied by "Delete chat" or by the other side leaves the list.
  if (command.kind === 'cleared-chats-read') {
    const rows = db.prepare('SELECT chat_id, cutoff FROM cleared_chats').all() as { chat_id: string; cutoff: number }[]
    return rows.flatMap(row => {
      try { return [{ chatId: identifier(row.chat_id), cutoff: Number(row.cutoff) }] } catch { return [] }
    })
  }
  if (command.kind === 'cleared-chat-set') {
    if (typeof command.cutoff !== 'number' || !Number.isFinite(command.cutoff) || command.cutoff <= 0) throw new Error('Invalid cleared chat boundary')
    db.prepare('INSERT INTO cleared_chats(chat_id,cutoff) VALUES(?,?) ON CONFLICT(chat_id) DO UPDATE SET cutoff=excluded.cutoff').run(identifier(command.chatId), command.cutoff)
    return null
  }
  const chatId = identifier(command.chatId)
  if (command.on) {
    if (typeof command.at !== 'number' || !Number.isSafeInteger(command.at) || command.at <= 0) throw new Error('Invalid hidden chat moment')
    db.prepare('INSERT INTO hidden_chats(chat_id,hidden_at) VALUES(?,?) ON CONFLICT(chat_id) DO UPDATE SET hidden_at=excluded.hidden_at').run(chatId, command.at)
  }
  else db.prepare('DELETE FROM hidden_chats WHERE chat_id=?').run(chatId)
  return null
}
