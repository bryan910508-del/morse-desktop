import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3-multiple-ciphers'
import type { ForwardRequest } from '../../shared/forward'
import { maxAlbumPhotos } from '../../shared/uploads'
import type { MediaSendWire } from '../../shared/model'
import type { UploadDescriptor } from './upload-protocol'
import type { PreparedForwardMedia } from './forward-media-protocol'
import { safeFileName } from '../media/media-document'
import { forwardMediaFormat, forwardMediaRoot } from '../media/forward-media-format'
import { mediaMetadata } from '../../shared/media-metadata'

const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export function forwardMediaDigest(media: PreparedForwardMedia): string {
  if (!['image', 'video', 'file', 'voice', 'sticker'].includes(media.kind) || typeof media.caption !== 'string' || media.caption.length > 3000 ||
      typeof media.isSilent !== 'boolean' || typeof media.blind !== 'boolean' || !Array.isArray(media.parts) || !media.parts.length ||
      media.parts.length > maxAlbumPhotos || (media.kind !== 'image' && media.parts.length !== 1)) throw new Error('Invalid forwarded media')
  const parts = media.parts.map(part => {
    if (!(part.bytes instanceof Uint8Array)) throw new Error('Invalid forwarded bytes')
    const format = forwardMediaFormat(media.kind, Buffer.from(part.bytes.buffer, part.bytes.byteOffset, part.bytes.byteLength))
    if (part.bytes.length >= format.limit ||
        (!part.bytes.length && media.kind !== 'file') || typeof part.name !== 'string' || part.name !== safeFileName(part.name) ||
        part.extension !== format.extension || part.contentType !== format.contentType ||
        createHash('sha256').update(part.bytes).digest('hex') !== part.sha256 || createHash('md5').update(part.bytes).digest('base64') !== part.md5) throw new Error('Invalid forwarded original')
    return { name: part.name, contentType: part.contentType, extension: part.extension, sha256: part.sha256, md5: part.md5, size: part.bytes.length }
  })
  const metadata = mediaMetadata(media.metadata, media.kind, parts.length)
  return hash({ kind: media.kind, caption: media.caption, isSilent: media.isSilent, blind: media.blind, metadata, parts })
}
// Called within the batch receipt transaction, after all byte hashes and IDs
// were validated. Duplicate destinations get independent owned upload paths.
export function insertForwardMedia(db: Database.Database, uid: string, request: ForwardRequest, media: PreparedForwardMedia): void {
  const originals = db.prepare('SELECT COALESCE(SUM(length(source)),0) AS size FROM upload_parts').get() as { size: number }
  const added = media.parts.reduce((sum, part) => sum + part.bytes.length, 0) * request.targets.length
  if (originals.size + added > 250 * 1024 * 1024) throw Object.assign(new Error('Forward media capacity'), { deliveryCode: 'capacity' })
  const insert = db.prepare("INSERT INTO intents(id,chat_id,wire,digest,created_at,state,upload,source_digest,forward_operation_id) VALUES(?,?,?,?,?,'uploading',?,?,?)")
  const insertPart = db.prepare('INSERT INTO upload_parts(intent_id,part_index,descriptor,source) VALUES(?,?,?,?)')
  const createdAt = Date.now(), first = media.parts[0]!
  const metadata = mediaMetadata(media.metadata, media.kind, media.parts.length)
  for (const target of request.targets) {
    const wire: MediaSendWire = { id: target.messageId, chatId: target.chatId, senderId: uid, type: media.kind,
      text: media.kind === 'file' ? first.name : '', mediaUrl: '', isSilent: media.isSilent, isEncrypted: false, protocolVersion: 3,
      ...metadata, ...(media.blind ? { thumbnailUrl: '__blind__' } : {}),
      ...(media.kind === 'file' ? { fileName: first.name, fileSize: first.bytes.length } : media.caption ?
        media.kind === 'image' ? { imageCaption: media.caption } : media.kind === 'video' ? { videoCaption: media.caption } : {} : {}) }
    const uploads = media.parts.map((part, index): UploadDescriptor => ({ id: wire.id, chatId: wire.chatId, kind: media.kind,
      name: part.name, size: part.bytes.length, contentType: part.contentType, sha256: part.sha256, md5: part.md5, session: null,
      path: `${forwardMediaRoot(media.kind, part.contentType)}/${wire.chatId}/${wire.id}${media.parts.length > 1 ? `_${index}` : ''}.${part.extension}` }))
    const sourceDigest = hash(uploads.length === 1 ? { wire, upload: uploads[0] } : { wire, uploads })
    insert.run(wire.id, wire.chatId, JSON.stringify(wire), '', createdAt, JSON.stringify(uploads[0]), sourceDigest, request.id)
    for (const [index, part] of media.parts.entries()) insertPart.run(wire.id, index, JSON.stringify(uploads[index]), Buffer.from(part.bytes.buffer, part.bytes.byteOffset, part.bytes.byteLength))
  }
}
