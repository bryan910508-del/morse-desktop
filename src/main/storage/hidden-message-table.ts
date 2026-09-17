import type Database from 'better-sqlite3-multiple-ciphers'
import { identifier } from '../../shared/validation'

export type HiddenMessageCommand =
  | { kind: 'hidden-messages-read' }
  | { kind: 'hidden-messages-add'; chatId: string; messageIds: string[]; at: number }

export const maxHiddenMessagesPerCall = 100

// iOS "나에게만 삭제" for a message (MessageStore hideForMe, the hidden_for_me rows of its local database) and
// Telegram's delete for me: the message leaves this device's history for good and the server keeps it.
export function executeHiddenMessage(db: Database.Database, command: HiddenMessageCommand): unknown {
  if (command.kind === 'hidden-messages-read') {
    const rows = db.prepare('SELECT chat_id, message_id FROM hidden_messages').all() as { chat_id: string; message_id: string }[]
    return rows.flatMap(row => {
      try { return [{ chatId: identifier(row.chat_id), messageId: identifier(row.message_id) }] } catch { return [] }
    })
  }
  const chatId = identifier(command.chatId)
  if (!Array.isArray(command.messageIds) || !command.messageIds.length || command.messageIds.length > maxHiddenMessagesPerCall) throw new Error('Invalid hidden messages')
  if (typeof command.at !== 'number' || !Number.isSafeInteger(command.at) || command.at <= 0) throw new Error('Invalid hidden message moment')
  const ids = command.messageIds.map(identifier)
  const insert = db.prepare('INSERT OR IGNORE INTO hidden_messages(chat_id,message_id,hidden_at) VALUES(?,?,?)')
  db.transaction(() => { for (const id of ids) insert.run(chatId, id, command.at) })()
  return null
}
