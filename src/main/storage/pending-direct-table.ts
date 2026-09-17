import type Database from 'better-sqlite3-multiple-ciphers'
import { identifier } from '../../shared/validation'
import type { PendingDirect } from '../../shared/delivery'

export type PendingDirectCommand =
  | { kind: 'direct-list' }
  | { kind: 'direct-open'; chatId: string; peerUid: string; displayName: string }
  | { kind: 'direct-confirm'; chatId: string; peerUid: string }
  | { kind: 'direct-discard'; chatId: string }
  | { kind: 'direct-supersede'; chatId: string; peerUid: string; dialogId: string }

export function executePendingDirect(db: Database.Database, uid: string, command: PendingDirectCommand): unknown {
  switch (command.kind) {
    case 'direct-list': {
      const rows = db.prepare(`SELECT chat_id,peer_uid,display_name,created_at,
        NOT EXISTS(SELECT 1 FROM intents WHERE intents.chat_id=pending_directs.chat_id) AS can_discard
        FROM pending_directs ORDER BY created_at DESC`).all() as
        { chat_id: string; peer_uid: string; display_name: string; created_at: number; can_discard: number }[]
      return rows.map(row => ({ chatId: identifier(row.chat_id), peerUid: identifier(row.peer_uid), displayName: row.display_name,
        createdAt: row.created_at, canDiscard: Boolean(row.can_discard) })) satisfies PendingDirect[]
    }
    case 'direct-open': return db.transaction(() => {
      identifier(command.chatId); identifier(command.peerUid)
      if (command.peerUid === uid || !command.displayName.trim() || command.displayName.length > 512) throw new Error('Invalid direct peer')
      const old = db.prepare('SELECT chat_id FROM pending_directs WHERE peer_uid=?').get(command.peerUid) as { chat_id: string } | undefined
      if (old) {
        // A room opened before the id was derived from the two accounts has a random one. Nothing was sent
        // from it, so it takes the pair's id: the first message from any device then lands in this room.
        if (old.chat_id === command.chatId || db.prepare('SELECT 1 FROM intents WHERE chat_id=? LIMIT 1').get(old.chat_id)) return old.chat_id
        db.prepare('UPDATE pending_directs SET chat_id=? WHERE chat_id=?').run(command.chatId, old.chat_id)
        db.prepare('DELETE FROM local_drafts WHERE chat_id=?').run(command.chatId)
        db.prepare('UPDATE local_drafts SET chat_id=? WHERE chat_id=?').run(command.chatId, old.chat_id)
        return command.chatId
      }
      const count = db.prepare('SELECT COUNT(*) AS count FROM pending_directs').get() as { count: number }
      if (count.count >= 100) throw Object.assign(new Error('Draft capacity'), { deliveryCode: 'capacity' })
      db.prepare('INSERT INTO pending_directs(chat_id,peer_uid,display_name,created_at) VALUES(?,?,?,?)')
        .run(command.chatId, command.peerUid, command.displayName, Date.now())
      return command.chatId
    })()
    case 'direct-confirm':
      db.prepare('DELETE FROM pending_directs WHERE chat_id=? AND peer_uid=?').run(identifier(command.chatId), identifier(command.peerUid)); return null
    // The pair's dialog arrived under another id. The room keeps only an unsent draft; it moves to the dialog
    // unless that one already has a draft. A room that sent something is left to its sends.
    case 'direct-supersede': return db.transaction(() => {
      const chatId = identifier(command.chatId), dialogId = identifier(command.dialogId)
      if (db.prepare('SELECT 1 FROM intents WHERE chat_id=? LIMIT 1').get(chatId)) return false
      const removed = db.prepare('DELETE FROM pending_directs WHERE chat_id=? AND peer_uid=?').run(chatId, identifier(command.peerUid)).changes === 1
      if (removed) {
        if (db.prepare('SELECT 1 FROM local_drafts WHERE chat_id=? LIMIT 1').get(dialogId)) db.prepare('DELETE FROM local_drafts WHERE chat_id=?').run(chatId)
        else db.prepare('UPDATE local_drafts SET chat_id=? WHERE chat_id=?').run(dialogId, chatId)
      }
      return removed
    })()
    case 'direct-discard': return db.transaction(() => {
      const chatId = identifier(command.chatId)
      // Even consumed identities forbid replacing a conversation after an uncertain first send.
      if (db.prepare('SELECT 1 FROM intents WHERE chat_id=? LIMIT 1').get(chatId)) return false
      const removed = db.prepare('DELETE FROM pending_directs WHERE chat_id=?').run(chatId).changes === 1
      if (removed) db.prepare('DELETE FROM local_drafts WHERE chat_id=?').run(chatId)
      return removed
    })()
  }
}
