import type Database from 'better-sqlite3-multiple-ciphers'
import type { MediaSendWire } from '../../shared/model'
import type { ReplyBinding } from '../../shared/reply-draft'
import { maxQueuedMessages } from '../../shared/delivery'
import { identifier } from '../../shared/validation'
import { textDigest } from '../messaging/text-identity'
import { requireReply } from './reply-draft-table'

// B195: a sticker queued as a reference to the server's copy (tdesktop SendExistingDocument → MTP_inputMediaDocument,
// api_sending.cpp:701-716) — no bytes, no upload; the server fills mediaUrl from stickerFiles/{stickerId}. The queue
// keeps it beside text and uploads in the same order, under the same identity rules.
export type StickerReferenceCommand = { kind: 'enqueue-sticker-reference'; wire: MediaSendWire; reply: ReplyBinding | null }

const referenceKeys = new Set(['id', 'chatId', 'senderId', 'type', 'text', 'mediaUrl', 'isSilent', 'isEncrypted', 'protocolVersion',
  'stickerId', 'stickerKind', 'stickerSetId', 'replyToId', 'categoryId', 'isForwarded'])
export function stickerReferenceWire(wire: MediaSendWire, uid: string): MediaSendWire {
  identifier(wire.id); identifier(wire.chatId)
  if (Object.keys(wire).some(key => !referenceKeys.has(key)) || wire.senderId !== uid || wire.type !== 'sticker' || wire.text !== '' ||
      wire.mediaUrl !== '' || typeof wire.isSilent !== 'boolean' || wire.isEncrypted !== false || wire.protocolVersion !== 3 ||
      typeof wire.stickerId !== 'string' || !/^[a-f0-9]{64}$/.test(wire.stickerId) || !['png', 'gif', 'mp4'].includes(wire.stickerKind ?? '') ||
      (wire.stickerSetId !== undefined && !/^[A-Za-z0-9_-]{1,160}$/.test(wire.stickerSetId)) ||
      (wire.replyToId !== undefined && !/^[A-Za-z0-9_-]{1,160}$/.test(wire.replyToId)) ||
      (wire.categoryId !== undefined && (typeof wire.categoryId !== 'string' || wire.categoryId.length > 160)) ||
      (wire.isForwarded !== undefined && wire.isForwarded !== true)) throw new Error('Invalid sticker reference')
  return wire
}

export function executeStickerReference(db: Database.Database, uid: string, command: StickerReferenceCommand): null {
  const wire = stickerReferenceWire(command.wire, uid), digest = textDigest(wire)
  db.transaction(() => {
    const old = db.prepare('SELECT chat_id,digest,forward_operation_id FROM intents WHERE id=?').get(wire.id) as { chat_id: string; digest: string; forward_operation_id: string | null } | undefined
    if (old) {
      if (old.forward_operation_id || old.chat_id !== wire.chatId || old.digest !== digest) throw Object.assign(new Error('Intent conflict'), { deliveryCode: 'conflict' })
      return
    }
    requireReply(db, wire.chatId, command.reply, wire.replyToId)
    const count = db.prepare('SELECT COUNT(*) AS count FROM intents WHERE wire IS NOT NULL').get() as { count: number }
    if (count.count >= maxQueuedMessages) throw Object.assign(new Error('Outbox full'), { deliveryCode: 'capacity' })
    db.prepare("INSERT INTO intents(id,chat_id,wire,digest,created_at,state) VALUES(?,?,?,?,?,'queued')")
      .run(wire.id, wire.chatId, JSON.stringify(wire), digest, Date.now())
    if (command.reply) db.prepare('DELETE FROM reply_drafts WHERE chat_id=? AND selection_id=?').run(wire.chatId, command.reply.selectionId)
  })()
  return null
}
