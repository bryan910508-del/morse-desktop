import type Database from 'better-sqlite3-multiple-ciphers'
import { identifier } from '../../shared/validation'
import type { PendingDirect } from '../../shared/delivery'
import { textDigest } from '../messaging/text-identity'
import type { SendWire } from '../../shared/model'

export type PendingDirectCommand =
  | { kind: 'direct-list' }
  | { kind: 'direct-open'; chatId: string; peerUid: string; displayName: string }
  | { kind: 'direct-confirm'; chatId: string; peerUid: string }
  | { kind: 'direct-discard'; chatId: string }
  | { kind: 'direct-supersede'; chatId: string; peerUid: string; dialogId: string }
  | { kind: 'direct-move'; chatId: string; peerUid: string; dialogId: string; refusedId: string }

// What direct-move did: the messages now in the dialog, and whether the room went with nothing left in it.
export interface DirectMove { moved: string[]; removed: boolean }

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
    // B88 §28: the server refused this room's first message (DIRECT_CHAT_EXISTS) and named the pair's 1:1. The refused
    // message and those queued behind it go there as they are, with the same ids, without what only makes a new room
    // (the peer, the kind, the new room's auto-delete), as Android's DirectChatPair.movedPayload. One on its way stays
    // for its answer; media stays, as its upload is named by the room; so does a forward, bound to its batch. A room
    // left with nothing goes, its draft to the dialog as direct-supersede moves it.
    case 'direct-move': return db.transaction((): DirectMove => {
      const chatId = identifier(command.chatId), dialogId = identifier(command.dialogId), peerUid = identifier(command.peerUid)
      if (chatId === dialogId || !db.prepare('SELECT 1 FROM pending_directs WHERE chat_id=? AND peer_uid=?').get(chatId, peerUid)) return { moved: [], removed: false }
      const rows = db.prepare(`SELECT id,wire FROM intents WHERE chat_id=? AND wire IS NOT NULL AND upload IS NULL AND forward_operation_id IS NULL
        AND (id=? OR state='queued') ORDER BY sequence`).all(chatId, identifier(command.refusedId)) as { id: string; wire: string }[]
      const moved: string[] = []
      for (const row of rows) {
        const wire = JSON.parse(row.wire) as SendWire & Record<string, unknown>
        if (wire.type !== 'text' || wire.peerUid !== peerUid || wire.chatId !== chatId) continue
        wire.chatId = dialogId
        for (const key of ['peerUid', 'chatType', 'autoDeleteSeconds', 'autoDeleteMyOnly']) delete wire[key]
        db.prepare("UPDATE intents SET chat_id=?,wire=?,digest=?,state='queued',reason='' WHERE id=?").run(dialogId, JSON.stringify(wire), textDigest(wire), row.id)
        moved.push(row.id)
      }
      if (db.prepare("SELECT 1 FROM intents WHERE chat_id=? AND (wire IS NOT NULL OR state='done') LIMIT 1").get(chatId)) return { moved, removed: false }
      db.prepare('DELETE FROM pending_directs WHERE chat_id=?').run(chatId)
      if (db.prepare('SELECT 1 FROM local_drafts WHERE chat_id=? LIMIT 1').get(dialogId)) db.prepare('DELETE FROM local_drafts WHERE chat_id=?').run(chatId)
      else db.prepare('UPDATE local_drafts SET chat_id=? WHERE chat_id=?').run(dialogId, chatId)
      db.prepare('DELETE FROM reply_drafts WHERE chat_id=?').run(chatId)
      return { moved, removed: true }
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
