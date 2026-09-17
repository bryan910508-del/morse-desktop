import { requireVoiceDraftForSend,consumeVoiceDraft } from './voice-draft-table'
import { backgroundPhotoId } from '../../shared/chat-background'
import { voiceUploadProof } from '../../shared/voice-send'
import { maxVoiceCaptureBytes } from '../../shared/voice-capture'
import { forwardMediaFormat } from '../media/forward-media-format'
import type Database from 'better-sqlite3-multiple-ciphers'
import { createHash } from 'node:crypto'
import type { MediaSendWire } from '../../shared/model'
import type { UploadCommand, UploadDescriptor, UploadPart, UploadRequest } from './upload-protocol'
import { identifier } from '../../shared/validation'
import { replyBinding } from '../../shared/reply-draft'
import { requireReply } from './reply-draft-table'
import { maxAlbumPhotos } from '../../shared/uploads'
import { maxQueuedMessages } from '../../shared/delivery'
import { storageBucket } from '../media/media-document'
import { textDigest } from '../messaging/text-identity'

export function listUploadParts(db: Database.Database, id: string): UploadPart[] {
  const rows = db.prepare('SELECT part_index,descriptor,url FROM upload_parts WHERE intent_id=? ORDER BY part_index').all(id) as
    { part_index: number; descriptor: string; url: string | null }[]
  if (!rows.length || rows.length > maxAlbumPhotos) throw new Error('Missing upload parts')
  return rows.map((row, index) => {
    const upload = JSON.parse(row.descriptor) as UploadDescriptor
    if (row.part_index !== index || upload.id !== id) throw new Error('Upload order mismatch')
    return { index, upload, url: row.url }
  })
}
function validateReference(raw: string, upload: UploadDescriptor): void {
  const url = new URL(raw)
  if (url.protocol !== 'https:' || url.host !== 'firebasestorage.googleapis.com' || url.username || url.password || url.hash ||
      url.pathname !== `/v0/b/${storageBucket}/o/${encodeURIComponent(upload.path)}` || url.searchParams.get('alt') !== 'media' || !url.searchParams.get('token')) throw new Error('Invalid uploaded reference')
}
function requestDigest(uid: string, request: UploadRequest): string {
  identifier(request.id); identifier(request.chatId)
  const voice=request.voice===undefined?undefined:voiceUploadProof(request.voice)
  const voiceDraftRevision=request.voiceDraftRevision===undefined?undefined:backgroundPhotoId(request.voiceDraftRevision)
  if(voiceDraftRevision && !voice)throw new Error('Voice draft requires voice proof')
  if (request.sticker !== undefined && (typeof request.sticker !== 'string' || !/^[a-f0-9]{64}$/.test(request.sticker) || voice)) throw new Error('Invalid sticker request')
  if (request.senderId !== uid || typeof request.caption !== 'string' || request.caption.length > 3000 || request.caption !== request.caption.trim() ||
      !Array.isArray(request.itemIds) || !request.itemIds.length || request.itemIds.length > maxAlbumPhotos ||
      new Set(request.itemIds).size !== request.itemIds.length) throw new Error('Invalid attachment request')
  // This receipt survives removal of the original bytes and finalized wire. It
  // recognizes a lost enqueue response without constructing/uploading a new send.
  return createHash('sha256').update(JSON.stringify({ id: request.id, chatId: request.chatId, senderId: uid,
    caption: request.caption, itemIds: request.itemIds.map(identifier), reply: replyBinding(request.reply),...(voice?{voice}:{}),...(voiceDraftRevision?{voiceDraftRevision}:{}),...(request.sticker?{sticker:request.sticker}:{}) })).digest('hex')
}
export function executeUpload(db: Database.Database, uid: string, command: UploadCommand): unknown {
  if (command.kind === 'attachment-known') {
    const digest = requestDigest(uid, command.request)
    const old = db.prepare('SELECT chat_id,upload_request_digest FROM intents WHERE id=?').get(command.request.id) as
      { chat_id: string; upload_request_digest: string | null } | undefined
    if (old && (old.chat_id !== command.request.chatId || old.upload_request_digest !== digest)) throw Object.assign(new Error('Upload request conflict'), { deliveryCode: 'conflict' })
    return Boolean(old)
  }
  if (command.kind === 'enqueue-attachment') return db.transaction(() => {
    const { wire, parts, request } = command
    const receipt = requestDigest(uid, request)
    identifier(wire.id); identifier(wire.chatId)
    if (request.id !== wire.id || request.chatId !== wire.chatId || request.itemIds.length !== parts.length ||
        (request.reply?.messageId ?? undefined) !== wire.replyToId ||
        (wire.type !== 'file' && wire.type !== 'sticker' && (wire.type === 'image' ? wire.imageCaption ?? '' : wire.videoCaption ?? '') !== request.caption) ||
        (wire.type === 'sticker') !== (request.sticker !== undefined)) throw new Error('Upload request mismatch')
    if (wire.senderId !== uid || wire.isEncrypted !== false || wire.protocolVersion !== 3 || wire.isSilent !== false ||
        wire.mediaUrl !== '' || wire.mediaKeys !== undefined || !['image', 'video', 'file','voice','sticker'].includes(wire.type) ||
        !parts.length || parts.length > maxAlbumPhotos || (parts.length > 1 && wire.type !== 'image')) throw new Error('Invalid upload intent')
    if(wire.type==='voice'){
      const proof=voiceUploadProof(request.voice)
      if(request.caption!=='' || parts.length!==1 || request.itemIds[0]!==wire.id || wire.text!=='' || wire.voiceDuration!==Math.max(1,Math.round(proof.duration)) || Object.keys(wire).some(k=>!['id','chatId','senderId','type','text','mediaUrl','isSilent','isEncrypted','protocolVersion','voiceDuration','replyToId','categoryId'].includes(k)))throw new Error('Invalid voice preparation')
      const part=parts[0]!
      if(!(part.bytes instanceof Uint8Array) || part.bytes.byteLength>=maxVoiceCaptureBytes || part.upload.sha256!==proof.sha256)throw new Error('Voice preparation changed')
      forwardMediaFormat('voice',Buffer.from(part.bytes.buffer,part.bytes.byteOffset,part.bytes.byteLength))
    }else if(request.voice!==undefined)throw new Error('Unexpected voice proof')
    if (wire.type === 'sticker') {
      const part = parts[0]!
      if (request.caption !== '' || parts.length !== 1 || request.itemIds[0] !== wire.id || wire.text !== '' || wire.mediaWidthPx !== 512 || wire.mediaHeightPx !== 512 ||
        createHash('sha256').update(part.bytes).digest('hex') !== request.sticker ||
        Object.keys(wire).some(k => !['id', 'chatId', 'senderId', 'type', 'text', 'mediaUrl', 'isSilent', 'isEncrypted', 'protocolVersion', 'mediaWidthPx', 'mediaHeightPx', 'replyToId', 'categoryId'].includes(k))) throw new Error('Invalid sticker preparation')
    }
    let size = 0
    for (const [index, { upload, bytes }] of parts.entries()) {
      const extension = wire.type==='voice'?'m4a':({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
        'video/mp4': 'mp4', 'video/quicktime': 'mov', 'application/octet-stream': 'bin' } as Record<string, string>)[upload.contentType]
      const root = wire.type === 'image' || (wire.type === 'sticker' && upload.contentType.startsWith('image/')) ? 'chat_media' : wire.type === 'video' || wire.type === 'sticker' ? 'chat_videos' : 'chat_files'
      if (upload.id !== wire.id || upload.chatId !== wire.chatId || upload.kind !== wire.type || upload.session !== null ||
          !extension || !((wire.type === 'file' || wire.type==='voice') ? upload.contentType === 'application/octet-stream' : wire.type === 'sticker' ? ['image/png', 'image/gif', 'video/mp4'].includes(upload.contentType) : upload.contentType.startsWith(`${wire.type}/`)) ||
          upload.path !== `${root}/${wire.chatId}/${wire.id}${parts.length > 1 ? `_${index}` : ''}.${extension}` ||
          bytes.length !== upload.size || bytes.length >= 50 * 1024 * 1024 || ((wire.type === 'image' || wire.type === 'sticker') && bytes.length >= 10 * 1024 * 1024) ||
          createHash('sha256').update(bytes).digest('hex') !== upload.sha256 || createHash('md5').update(bytes).digest('base64') !== upload.md5) throw new Error('Invalid upload part')
      size += bytes.length
    }
    // Keep the original single-attachment digest format; album order is part of
    // its identity, independent of mutable upload sessions and completed URLs.
    const source = parts.length === 1 ? { wire, upload: parts[0]!.upload } : { wire, uploads: parts.map(part => part.upload) }
    const digest = createHash('sha256').update(JSON.stringify(source)).digest('hex')
    const old = db.prepare('SELECT chat_id,source_digest,upload_request_digest FROM intents WHERE id=?').get(wire.id) as
      { chat_id: string; source_digest: string; upload_request_digest: string | null } | undefined
    if (old) {
      if (old.chat_id !== wire.chatId || old.source_digest !== digest || old.upload_request_digest !== receipt) throw Object.assign(new Error('Upload identity conflict'), { deliveryCode: 'conflict' })
      return
    }
    if(wire.type==='voice')requireVoiceDraftForSend(db,wire.chatId,wire.id,voiceUploadProof(request.voice),parts[0]!.bytes.byteLength,request.voiceDraftRevision)
    requireReply(db, wire.chatId, request.reply, wire.replyToId)
    const count = db.prepare('SELECT COUNT(*) AS count FROM intents WHERE wire IS NOT NULL').get() as { count: number }
    const originals = db.prepare('SELECT COALESCE(SUM(length(source)),0) AS size FROM upload_parts').get() as { size: number }
    if (count.count >= maxQueuedMessages || originals.size + size > 250 * 1024 * 1024) throw Object.assign(new Error('Upload capacity exceeded'), { deliveryCode: 'capacity' })
    db.prepare("INSERT INTO intents(id,chat_id,wire,digest,created_at,state,upload,source_digest,upload_request_digest) VALUES(?,?,?,?,?,'uploading',?,?,?)")
      .run(wire.id, wire.chatId, JSON.stringify(wire), '', Date.now(), JSON.stringify(parts[0]!.upload), digest, receipt)
    const insert = db.prepare('INSERT INTO upload_parts(intent_id,part_index,descriptor,source) VALUES(?,?,?,?)')
    for (const [index, part] of parts.entries()) insert.run(wire.id, index, JSON.stringify(part.upload), Buffer.from(part.bytes.buffer, part.bytes.byteOffset, part.bytes.byteLength))
    // Consume only the reply bound to this enqueue; a separately typed text
    // draft remains intact. Rollback preserves both reply and original parts.
    if(request.voiceDraftRevision)consumeVoiceDraft(db,wire.chatId,request.voiceDraftRevision)
    if (request.reply) db.prepare('DELETE FROM reply_drafts WHERE chat_id=? AND selection_id=?').run(wire.chatId, request.reply.selectionId)
  })()
  return db.transaction(() => {
    const row = db.prepare('SELECT wire,state FROM intents WHERE id=?').get(identifier(command.id)) as { wire: string | null; state: string } | undefined
    if (!row?.wire || !['uploading', 'upload-failed'].includes(row.state)) throw Object.assign(new Error('Upload no longer pending'), { deliveryCode: 'conflict' })
    const wire = JSON.parse(row.wire) as MediaSendWire
    if (wire.senderId !== uid || wire.id !== command.id || wire.mediaUrl !== '') throw new Error('Upload identity mismatch')
    const parts = listUploadParts(db, command.id)
    if (parts.some(part => part.upload.chatId !== wire.chatId || part.upload.kind !== wire.type)) throw new Error('Upload owner mismatch')
    if (command.kind === 'upload-ready') {
      if (parts.some(part => !part.url) || (parts.length > 1 && wire.type !== 'image')) throw new Error('Upload incomplete')
      const urls = parts.map(part => { validateReference(part.url!, part.upload); return part.url! })
      wire.mediaUrl = urls[0]!
      if (wire.type !== 'file' && wire.type !== 'voice') wire.text = urls[0]!
      if (urls.length > 1) wire.mediaKeys = urls
      db.prepare("UPDATE intents SET wire=?,digest=?,upload=?,state='queued',reason='' WHERE id=?")
        .run(JSON.stringify(wire), textDigest(wire), JSON.stringify(parts[0]!.upload), command.id)
      return null
    }
    if (!Number.isSafeInteger(command.index) || command.index < 0 || command.index >= parts.length) throw new Error('Invalid upload index')
    const part = parts[command.index]!, upload = part.upload
    if (command.kind === 'upload-source') {
      const source = db.prepare('SELECT source FROM upload_parts WHERE intent_id=? AND part_index=?').get(command.id, command.index) as { source: Buffer }
      if (!source || source.source.length !== upload.size || createHash('sha256').update(source.source).digest('hex') !== upload.sha256) throw new Error('Source integrity mismatch')
      return source.source
    }
    if (command.kind === 'upload-session') {
      const url = new URL(command.session)
      if (part.url || url.protocol !== 'https:' || url.hostname !== 'firebasestorage.googleapis.com' || url.port || url.username || url.password || url.hash ||
          url.pathname !== `/v0/b/${storageBucket}/o` || !url.searchParams.get('upload_id') ||
          (url.searchParams.has('name') && url.searchParams.get('name') !== upload.path)) throw new Error('Invalid upload session')
      upload.session = command.session
      db.prepare('UPDATE upload_parts SET descriptor=? WHERE intent_id=? AND part_index=?').run(JSON.stringify(upload), command.id, command.index)
      return null
    }
    validateReference(command.url, upload)
    upload.session = null
    db.prepare('UPDATE upload_parts SET descriptor=?,url=? WHERE intent_id=? AND part_index=?').run(JSON.stringify(upload), command.url, command.id, command.index)
    return null
  })()
}
