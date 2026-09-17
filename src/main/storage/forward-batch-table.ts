import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3-multiple-ciphers'
import { forwardBatchRequest } from '../../shared/forward-batch'
import { maxQueuedMessages } from '../../shared/delivery'
import { outgoingText } from '../../shared/validation'
import type { TextSendWire } from '../../shared/model'
import type { ForwardBatchCommand } from './forward-batch-protocol'
import { clearForwardBatch } from './forward-batch-protocol'
import { forwardMediaDigest, insertForwardMedia } from './forward-media-table'
import { textDigest } from '../messaging/text-identity'

const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const conflict = (): Error => Object.assign(new Error('Forward batch identity conflict'), { deliveryCode: 'conflict' })
export function executeForwardBatch(db: Database.Database, uid: string, command: ForwardBatchCommand): unknown {
  try {
    const request = forwardBatchRequest(command.request), requestDigest = hash({ uid, request })
    return db.transaction(() => {
      const old = db.prepare('SELECT request_digest,content_digest FROM forward_receipts WHERE operation_id=?').get(request.id) as { request_digest: string; content_digest: string } | undefined
      if (old && old.request_digest !== requestDigest) throw conflict()
      if (command.kind === 'forward-batch-known') return Boolean(old)
      if (command.content.length !== request.sources.length) throw new Error('Forward source count mismatch')
      const contentDigest = hash(command.content.map(item => {
        if (item.kind === 'media') return { kind: 'media', digest: forwardMediaDigest(item.media) }
        if (item.kind !== 'text' || typeof item.isSilent !== 'boolean') throw new Error('Invalid forward source')
        outgoingText(item.text)
        return item
      }))
      if (old) { if (old.content_digest !== contentDigest) throw conflict(); return }
      const count = db.prepare('SELECT COUNT(*) AS count FROM intents WHERE wire IS NOT NULL').get() as { count: number }
      const originals = db.prepare('SELECT COALESCE(SUM(length(source)),0) AS size FROM upload_parts').get() as { size: number }
      const added = command.content.reduce((sum, item) => sum + (item.kind === 'media' ? item.media.parts.reduce((size, part) => size + part.bytes.length, 0) : 0), 0) * request.targets.length
      if (count.count + request.sources.length * request.targets.length > maxQueuedMessages || originals.size + added > 250 * 1024 * 1024) throw Object.assign(new Error('Forward batch capacity'), { deliveryCode: 'capacity' })
      for (const target of request.targets) for (const id of target.messageIds) if (db.prepare('SELECT 1 FROM intents WHERE id=?').get(id)) throw conflict()
      const insert = db.prepare("INSERT INTO intents(id,chat_id,wire,digest,created_at,state,forward_operation_id) VALUES(?,?,?,?,?,'queued',?)")
      for (const [index, item] of command.content.entries()) {
        const targets = request.targets.map(target => ({ chatId: target.chatId, messageId: target.messageIds[index]! }))
        if (item.kind === 'media') {
          insertForwardMedia(db, uid, { id: request.id, source: request.sources[index]!, targets }, item.media)
        } else for (const target of targets) {
          const wire: TextSendWire = { id: target.messageId, chatId: target.chatId, senderId: uid, type: 'text',
            text: item.text, isSilent: item.isSilent, isEncrypted: false, protocolVersion: 3 }
          insert.run(wire.id, wire.chatId, JSON.stringify(wire), textDigest(wire), Date.now(), request.id)
        }
      }
      db.prepare('INSERT INTO forward_receipts(operation_id,request_digest,content_digest) VALUES(?,?,?)').run(request.id, requestDigest, contentDigest)
      // Each target receives the source sequence, including upload intents.
      // All originals, text intents and the receipt commit together.
    })()
  } finally { if (command.kind === 'enqueue-forward-batch') clearForwardBatch(command.content) }
}
