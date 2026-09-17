import type Database from 'better-sqlite3-multiple-ciphers'
import { createHash } from 'node:crypto'
import { textForwardBatchRequest, type TextForwardBatchRequest } from '../../shared/forward-text-batch'
import { outgoingText } from '../../shared/validation'
import { maxQueuedMessages } from '../../shared/delivery'
import type { TextSendWire } from '../../shared/model'
import { textDigest } from '../messaging/text-identity'

export type ForwardTextBatchCommand =
  | { kind: 'forward-texts-known'; request: TextForwardBatchRequest }
  | { kind: 'enqueue-forward-texts'; request: TextForwardBatchRequest; content: { text: string; isSilent: boolean }[] }
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const conflict = (): Error => Object.assign(new Error('Forward batch identity conflict'), { deliveryCode: 'conflict' })
export function executeForwardTexts(db: Database.Database, uid: string, command: ForwardTextBatchCommand): unknown {
  const request = textForwardBatchRequest(command.request), requestDigest = hash({ uid, request })
  return db.transaction(() => {
    const old = db.prepare('SELECT request_digest,content_digest FROM forward_receipts WHERE operation_id=?').get(request.id) as { request_digest: string; content_digest: string } | undefined
    if (old && old.request_digest !== requestDigest) throw conflict()
    if (command.kind === 'forward-texts-known') return Boolean(old)
    if (command.content.length !== request.sources.length) throw new Error('Forward source count mismatch')
    for (const source of command.content) { outgoingText(source.text); if (typeof source.isSilent !== 'boolean') throw new Error('Invalid forward source') }
    const contentDigest = hash(command.content)
    if (old) { if (old.content_digest !== contentDigest) throw conflict(); return }
    const count = db.prepare('SELECT COUNT(*) AS count FROM intents WHERE wire IS NOT NULL').get() as { count: number }
    if (count.count + request.sources.length * request.targets.length > maxQueuedMessages) throw Object.assign(new Error('Forward batch capacity'), { deliveryCode: 'capacity' })
    for (const target of request.targets) for (const id of target.messageIds) if (db.prepare('SELECT 1 FROM intents WHERE id=?').get(id)) throw conflict()
    const insert = db.prepare("INSERT INTO intents(id,chat_id,wire,digest,created_at,state,forward_operation_id) VALUES(?,?,?,?,?,'queued',?)")
    const now = Date.now()
    for (const target of request.targets) for (const [index, source] of command.content.entries()) {
      const wire: TextSendWire = { id: target.messageIds[index]!, chatId: target.chatId, senderId: uid, type: 'text',
        text: source.text, isSilent: source.isSilent, isEncrypted: false, protocolVersion: 3 }
      insert.run(wire.id, wire.chatId, JSON.stringify(wire), textDigest(wire), now, request.id)
    }
    db.prepare('INSERT INTO forward_receipts(operation_id,request_digest,content_digest) VALUES(?,?,?)').run(request.id, requestDigest, contentDigest)
    // Source order is preserved by insertion sequence. Drafts/replies belong to
    // the individual composers and are never consumed by this batch.
  })()
}
