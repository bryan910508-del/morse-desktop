import type Database from 'better-sqlite3-multiple-ciphers'
import { createHash } from 'node:crypto'
import { backgroundPhotoId } from '../../shared/chat-background'
import { channelPhotoBytes, channelPhotoKind, type ChannelPhotoKind } from '../../shared/channel-photo-bytes'
import { channelPhotoUploadRequest, channelPhotoVersion, type ChannelPhotoUploadRequest, type ChannelPhotoUploadStage } from '../../shared/channel-photo-upload'
import { identifier } from '../../shared/validation'
import { storageBucket as bucket } from '../media/media-document'
export interface ChannelPhotoUploadRecord extends ChannelPhotoUploadRequest {
  stage: ChannelPhotoUploadStage; session: string | null; url: string | null; applyVersion: string | null
  bytes: Uint8Array; sha256: string; md5: string
}
export type ChannelPhotoUploadCommand = { kind: 'channel-photo-upload-read' } |
  { kind: 'channel-photo-upload-create'; request: ChannelPhotoUploadRequest; bytes: Uint8Array } |
  { kind: 'channel-photo-upload-state'; id: string; from: ChannelPhotoUploadStage; stage: ChannelPhotoUploadStage; session?: string; url?: string; version?: string } |
  { kind: 'channel-photo-upload-discard'; id: string; from: ChannelPhotoUploadStage }
const conflict = (): never => { throw Object.assign(new Error('Channel photo upload changed'), { deliveryCode: 'conflict' }) }
export function channelPhotoUploadPath(channelId: string, id: string, kind: ChannelPhotoKind = 'avatar'): string { return `${channelPhotoKind(kind) === 'cover' ? 'channel_covers' : 'channel_photos'}/${identifier(channelId)}/${backgroundPhotoId(id)}.jpg` }
export function channelPhotoUploadSession(raw: string, channelId: string, id: string, kind: ChannelPhotoKind = 'avatar'): string {
  const url = new URL(raw)
  if (raw.length > 8192 || url.protocol !== 'https:' || url.host !== 'firebasestorage.googleapis.com' || url.username || url.password || url.hash ||
    url.pathname !== `/v0/b/${bucket}/o` || !url.searchParams.get('upload_id') || (url.searchParams.has('name') && url.searchParams.get('name') !== channelPhotoUploadPath(channelId, id, kind))) return conflict()
  return url.href
}
export function channelPhotoUploadURL(raw: string, channelId: string, id: string, kind: ChannelPhotoKind = 'avatar'): string {
  const url = new URL(raw)
  if (raw.length > 10000 || url.protocol !== 'https:' || url.host !== 'firebasestorage.googleapis.com' || url.username || url.password || url.hash ||
    url.pathname !== `/v0/b/${bucket}/o/${encodeURIComponent(channelPhotoUploadPath(channelId, id, kind))}` || url.searchParams.get('alt') !== 'media' || !url.searchParams.get('token')) return conflict()
  return url.href
}
export function validateChannelPhotoRecord(photo: ChannelPhotoUploadRecord): void {
  channelPhotoUploadRequest({ kind: photo.kind, id: photo.id, channelId: photo.channelId, version: photo.version, title: photo.title }); channelPhotoBytes(photo.bytes, photo.kind)
  if (createHash('sha256').update(photo.bytes).digest('hex') !== photo.sha256 || createHash('md5').update(photo.bytes).digest('base64') !== photo.md5 ||
    !['upload', 'ready', 'committing', 'confirmed', 'rejected'].includes(photo.stage)) return conflict()
  if (photo.session) channelPhotoUploadSession(photo.session, photo.channelId, photo.id, photo.kind)
  if (photo.url) channelPhotoUploadURL(photo.url, photo.channelId, photo.id, photo.kind)
  if (photo.stage !== 'upload' && !photo.url) return conflict()
  if (['committing', 'confirmed', 'rejected'].includes(photo.stage)) channelPhotoVersion(photo.applyVersion)
  else if (photo.applyVersion !== null) return conflict()
}
function read(db: Database.Database): ChannelPhotoUploadRecord | null {
  const rows = db.prepare(`SELECT id,payload,stage,session,url,CASE WHEN length(source)<=1048576 THEN source END AS source,sha256,md5,apply_version AS applyVersion
    FROM channel_photo_uploads WHERE payload IS NOT NULL LIMIT 2`).all() as { id: string; payload: string; stage: ChannelPhotoUploadStage; session: string | null; url: string | null; source: Buffer; sha256: string; md5: string; applyVersion: string | null }[]
  if (rows.length > 1) return conflict()
  const row = rows[0]
  if (!row) return null
  if (row.payload.length > 10000) return conflict()
  const request = channelPhotoUploadRequest(JSON.parse(row.payload))
  if (request.id !== row.id) return conflict()
  const photo = { ...request, stage: row.stage, session: row.session, url: row.url, bytes: row.source, sha256: row.sha256, md5: row.md5, applyVersion: row.applyVersion }
  validateChannelPhotoRecord(photo); return photo
}
export function executeChannelPhotoUpload(db: Database.Database, command: ChannelPhotoUploadCommand): ChannelPhotoUploadRecord | null {
  if (command.kind === 'channel-photo-upload-read') return read(db)
  return db.transaction(() => {
    const old = read(db)
    if (command.kind === 'channel-photo-upload-create') {
      const request = channelPhotoUploadRequest(command.request), bytes = channelPhotoBytes(command.bytes, request.kind)
      const sha256 = createHash('sha256').update(bytes).digest('hex'), md5 = createHash('md5').update(bytes).digest('base64')
      if (old) {
        const previous = channelPhotoUploadRequest({ id: old.id, kind: old.kind, channelId: old.channelId, version: old.version, title: old.title })
        if (old.stage === 'upload' && old.sha256 === sha256 && JSON.stringify(request) === JSON.stringify(previous)) return old
        return conflict()
      }
      if (db.prepare('SELECT 1 FROM channel_photo_uploads WHERE id=?').get(request.id)) return conflict()
      if ((db.prepare('SELECT COUNT(*) AS n FROM channel_photo_uploads').get() as { n: number }).n >= 10000) throw Object.assign(new Error('Channel photo record capacity'), { deliveryCode: 'capacity' })
      db.prepare("INSERT INTO channel_photo_uploads(id,payload,stage,source,sha256,md5) VALUES(?,?,'upload',?,?,?)").run(request.id, JSON.stringify(request), Buffer.from(bytes), sha256, md5)
    } else {
      const id = backgroundPhotoId(command.id)
      if (!old || old.id !== id || old.stage !== command.from) return conflict()
      if (command.kind === 'channel-photo-upload-discard') {
        db.prepare("UPDATE channel_photo_uploads SET payload=NULL,source=NULL,session=NULL,url=NULL,sha256=NULL,md5=NULL,apply_version=NULL,stage='discarded' WHERE id=?").run(id)
        return null
      }
      const allowed: Record<ChannelPhotoUploadStage, ChannelPhotoUploadStage[]> = { upload: ['upload', 'ready'], ready: ['committing'], committing: ['confirmed', 'rejected'], confirmed: [], rejected: [] }
      if (!allowed[old.stage].includes(command.stage)) return conflict()
      const session = command.session === undefined ? old.session : channelPhotoUploadSession(command.session, old.channelId, id, old.kind)
      const url = command.url === undefined ? old.url : channelPhotoUploadURL(command.url, old.channelId, id, old.kind)
      const applyVersion = command.stage === 'committing' ? channelPhotoVersion(command.version) : old.applyVersion
      if ((old.session && old.session !== session) || (old.url && old.url !== url) || (command.stage !== 'upload' && !url) || (command.stage !== 'committing' && command.version !== undefined)) return conflict()
      db.prepare('UPDATE channel_photo_uploads SET stage=?,session=?,url=?,apply_version=? WHERE id=?').run(command.stage, session, url, applyVersion, id)
    }
    return read(db)
  })()
}
