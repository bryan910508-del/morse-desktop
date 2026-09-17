import type Database from 'better-sqlite3-multiple-ciphers'
import { createHash } from 'node:crypto'
import { forwardRequest, type ForwardRequest } from '../../shared/forward'
import { outgoingText } from '../../shared/validation'
import type { TextSendWire } from '../../shared/model'
import { maxQueuedMessages } from '../../shared/delivery'
import { textDigest } from '../messaging/text-identity'
import type { PreparedForwardMedia } from './forward-media-protocol'
import { forwardMediaDigest, insertForwardMedia } from './forward-media-table'

export type ForwardCommand =
  | { kind: 'forward-known'; request: ForwardRequest }
  | { kind: 'enqueue-forward'; request: ForwardRequest; text: string; isSilent: boolean }
  | { kind: 'enqueue-forward-media'; request: ForwardRequest; media: PreparedForwardMedia }
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const conflict = (): Error => Object.assign(new Error('Forward identity conflict'), { deliveryCode: 'conflict' })

export function executeForward(db: Database.Database, uid: string, command: ForwardCommand): unknown {
  const request = forwardRequest(command.request), digest = hash({ uid, request })
  return db.transaction(() => {
    const old = db.prepare('SELECT request_digest,content_digest FROM forward_receipts WHERE operation_id=?').get(request.id) as
      { request_digest: string; content_digest: string } | undefined
    if (old && old.request_digest !== digest) throw conflict()
    if (command.kind === 'forward-known') return Boolean(old)
    if (command.kind === 'enqueue-forward') {
      outgoingText(command.text)
      if (typeof command.isSilent !== 'boolean') throw new Error('Invalid forward source')
    }
    const content = command.kind === 'enqueue-forward-media' ? forwardMediaDigest(command.media) : hash({ text: command.text, isSilent: command.isSilent })
    if (old) { if (old.content_digest !== content) throw conflict(); return }
    const count = db.prepare('SELECT COUNT(*) AS count FROM intents WHERE wire IS NOT NULL').get() as { count: number }
    if (count.count + request.targets.length > maxQueuedMessages) throw Object.assign(new Error('Forward capacity'), { deliveryCode: 'capacity' })
    for (const target of request.targets) if (db.prepare('SELECT 1 FROM intents WHERE id=?').get(target.messageId)) throw conflict()
    if (command.kind === 'enqueue-forward-media') {
      insertForwardMedia(db, uid, request, command.media)
      db.prepare('INSERT INTO forward_receipts(operation_id,request_digest,content_digest) VALUES(?,?,?)').run(request.id, digest, content)
      return
    }
    const insert = db.prepare("INSERT INTO intents(id,chat_id,wire,digest,created_at,state,forward_operation_id) VALUES(?,?,?,?,?,'queued',?)")
    const createdAt = Date.now()
    for (const target of request.targets) {
      // The existing server contract carries a new text message, with no
      // source-author identity, source reply, reactions or source attachment URL.
      const wire: TextSendWire = { id: target.messageId, chatId: target.chatId, senderId: uid, type: 'text', text: command.text,
        isSilent: command.isSilent, isEncrypted: false, protocolVersion: 3 }
      insert.run(wire.id, wire.chatId, JSON.stringify(wire), textDigest(wire), createdAt, request.id)
    }
    db.prepare('INSERT INTO forward_receipts(operation_id,request_digest,content_digest) VALUES(?,?,?)').run(request.id, digest, content)
    // No compose draft or reply selection belongs to this independent batch.
  })()
}
