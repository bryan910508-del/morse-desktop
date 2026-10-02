import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3-multiple-ciphers'
import type { InquiryMessageKind } from '../../shared/channel-inquiries'

// The messages this account has sent into inquiry rooms and the server has not accepted yet: kept on the device until
// they are, as Telegram keeps an outgoing message in its local history and sends it again under the same random_id
// after a reconnect or a restart (Android and iOS keep theirs too). Each carries the client message id the server
// accepts once (sendMorseInquiryMessage acceptedMessages), and, until it is uploaded, the file it sends.
export interface InquirySendMedia { extension: 'jpg' | 'png' | 'webp' | 'gif' | 'mp4' | 'mov' | 'bin' | 'm4a'; noun: string; urlInText: boolean; size: number; sha256: string; md5: string }
export interface InquirySendPayload {
  // The callable's fields apart from those the send adds: inquiryId, clientMessageId, senderId and the file's URL.
  message: Record<string, unknown>
  // What the room shows while it is on its way.
  preview: { kind: InquiryMessageKind; text: string }
  media: InquirySendMedia | null
}
export interface StoredInquirySend extends InquirySendPayload { id: string; inquiryId: string; mediaUrl: string | null; state: 'queued' | 'failed'; reason: string; createdAt: number }
export type InquirySendCommand =
  | { kind: 'inquiry-send-list' }
  | { kind: 'inquiry-send-enqueue'; id: string; inquiryId: string; payload: InquirySendPayload; bytes?: Uint8Array; createdAt: number }
  | { kind: 'inquiry-send-media'; id: string }
  | { kind: 'inquiry-send-uploaded'; id: string; url: string }
  | { kind: 'inquiry-send-state'; id: string; state: 'queued' | 'failed'; reason: string }
  | { kind: 'inquiry-send-remove'; id: string }
  | { kind: 'inquiry-send-forget-room'; inquiryId: string }

// At most this many wait at once; a room is not a place to queue a backlog.
export const maxInquirySends = 100
const messageId = /^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/
const roomId = /^[A-Za-z0-9_-]{3,330}$/
const conflict = (reason: string): never => { throw Object.assign(new Error(reason), { deliveryCode: 'conflict' }) }
const digest = (inquiryId: string, payload: InquirySendPayload): string => createHash('sha256').update(JSON.stringify([inquiryId, payload])).digest('hex')

export function executeInquirySend(db: Database.Database, command: InquirySendCommand): unknown {
  switch (command.kind) {
    case 'inquiry-send-list': {
      const rows = db.prepare('SELECT id,inquiry_id,payload,media_url,state,reason,created_at FROM inquiry_sends ORDER BY sequence').all() as
        { id: string; inquiry_id: string; payload: string; media_url: string | null; state: 'queued' | 'failed'; reason: string; created_at: number }[]
      return rows.map(row => ({ ...JSON.parse(row.payload) as InquirySendPayload, id: row.id, inquiryId: row.inquiry_id, mediaUrl: row.media_url, state: row.state, reason: row.reason, createdAt: row.created_at }))
    }
    case 'inquiry-send-enqueue': return db.transaction(() => {
      const { id, inquiryId, payload } = command
      if (!messageId.test(id) || !roomId.test(inquiryId) || !inquiryId.includes('_')) return conflict('Inquiry send identity')
      if (Boolean(payload.media) !== Boolean(command.bytes)) return conflict('Inquiry send media')
      if (payload.media && command.bytes && (command.bytes.byteLength !== payload.media.size || createHash('sha256').update(command.bytes).digest('hex') !== payload.media.sha256)) return conflict('Inquiry send media')
      const key = digest(inquiryId, payload)
      const old = db.prepare('SELECT digest FROM inquiry_sends WHERE id=?').get(id) as { digest: string } | undefined
      // The same message handed over twice stays one; another under its id is refused.
      if (old) { if (old.digest !== key) return conflict('Inquiry send conflict'); return null }
      if ((db.prepare('SELECT COUNT(*) AS n FROM inquiry_sends').get() as { n: number }).n >= maxInquirySends) throw Object.assign(new Error('Inquiry send capacity'), { deliveryCode: 'capacity' })
      db.prepare("INSERT INTO inquiry_sends(id,inquiry_id,digest,payload,media,media_url,state,reason,created_at) VALUES(?,?,?,?,?,NULL,'queued','',?)")
        .run(id, inquiryId, key, JSON.stringify(payload), command.bytes ? Buffer.from(command.bytes) : null, command.createdAt)
      return null
    })()
    case 'inquiry-send-media': {
      const row = db.prepare('SELECT media FROM inquiry_sends WHERE id=?').get(command.id) as { media: Buffer | null } | undefined
      return row?.media ? new Uint8Array(row.media) : null
    }
    // Once the file is stored its URL is what goes; the bytes are no longer kept.
    case 'inquiry-send-uploaded': db.prepare('UPDATE inquiry_sends SET media_url=?,media=NULL WHERE id=?').run(command.url, command.id); return null
    case 'inquiry-send-state': db.prepare('UPDATE inquiry_sends SET state=?,reason=? WHERE id=?').run(command.state, command.reason, command.id); return null
    case 'inquiry-send-remove': db.prepare('DELETE FROM inquiry_sends WHERE id=?').run(command.id); return null
    case 'inquiry-send-forget-room': db.prepare('DELETE FROM inquiry_sends WHERE inquiry_id=?').run(command.inquiryId); return null
  }
}
