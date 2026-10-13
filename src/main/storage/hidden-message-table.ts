import type Database from 'better-sqlite3-multiple-ciphers'
import { identifier } from '../../shared/validation'

// B327b: where a hidden message stands with the server — 0 not sent yet, 1 the server has it (sent, or taken from
// users/{uid}/hiddenMessages), 2 never sent (a secret chat, saved messages, or the server refused it for good).
export type HiddenUpload = 0 | 1 | 2
export type HiddenMessageCommand =
  | { kind: 'hidden-messages-read' }
  | { kind: 'hidden-messages-add'; chatId: string; messageIds: string[]; at: number }
  | { kind: 'hidden-messages-merge'; chatId: string; messageIds: string[]; at: number }
  | { kind: 'hidden-messages-uploaded'; chatId: string; messageIds: string[]; state: 1 | 2 }

export const maxHiddenMessagesPerCall = 100
// The server keeps up to 5,000 for a room (users/{uid}/hiddenMessages, HIDDEN_MAX).
export const maxHiddenMessagesPerRoom = 5000

// iOS "나에게만 삭제" for a message (MessageStore hideForMe, the hidden_for_me rows of its local database) and
// Telegram's delete for me: the message leaves this device's history for good; since B327b the server keeps the list
// for the account's other devices.
export function executeHiddenMessage(db: Database.Database, command: HiddenMessageCommand): unknown {
  if (command.kind === 'hidden-messages-read') {
    // Oldest first, so the list keeps the order they were hidden in (contract B327b §6: sent newest first).
    const rows = db.prepare('SELECT chat_id, message_id, uploaded FROM hidden_messages ORDER BY hidden_at, rowid').all() as { chat_id: string; message_id: string; uploaded: number }[]
    return rows.flatMap(row => {
      try { return [{ chatId: identifier(row.chat_id), messageId: identifier(row.message_id), uploaded: row.uploaded === 1 || row.uploaded === 2 ? row.uploaded : 0 }] } catch { return [] }
    })
  }
  const chatId = identifier(command.chatId)
  const limit = command.kind === 'hidden-messages-merge' ? maxHiddenMessagesPerRoom : maxHiddenMessagesPerCall
  if (!Array.isArray(command.messageIds) || !command.messageIds.length || command.messageIds.length > limit) throw new Error('Invalid hidden messages')
  const ids = command.messageIds.map(identifier)
  if (command.kind === 'hidden-messages-uploaded') {
    if (command.state !== 1 && command.state !== 2) throw new Error('Invalid hidden message state')
    const update = db.prepare('UPDATE hidden_messages SET uploaded = ? WHERE chat_id = ? AND message_id = ? AND uploaded = 0')
    db.transaction(() => { for (const id of ids) update.run(command.state, chatId, id) })()
    return null
  }
  if (typeof command.at !== 'number' || !Number.isSafeInteger(command.at) || command.at <= 0) throw new Error('Invalid hidden message moment')
  // Taken from the server: kept here as the server's, and one this device was still to send needs no sending.
  const statement = command.kind === 'hidden-messages-merge'
    ? db.prepare('INSERT INTO hidden_messages(chat_id,message_id,hidden_at,uploaded) VALUES(?,?,?,1) ON CONFLICT(chat_id,message_id) DO UPDATE SET uploaded = 1 WHERE uploaded = 0')
    : db.prepare('INSERT OR IGNORE INTO hidden_messages(chat_id,message_id,hidden_at,uploaded) VALUES(?,?,?,0)')
  db.transaction(() => { for (const id of ids) statement.run(chatId, id, command.at) })()
  return null
}
