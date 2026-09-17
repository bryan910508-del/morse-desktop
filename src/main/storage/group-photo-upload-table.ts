import type Database from 'better-sqlite3-multiple-ciphers'
import { createHash } from 'node:crypto'
import { backgroundPhotoId } from '../../shared/chat-background'
import { profilePhotoBytes } from '../../shared/profile-photo-upload'
import { groupPhotoUploadRequest, groupPhotoVersion, type GroupPhotoUploadRequest, type GroupPhotoUploadStage } from '../../shared/group-photo-upload'
import { identifier } from '../../shared/validation'
import { storageBucket as bucket } from '../media/media-document'
export interface GroupPhotoUploadRecord extends GroupPhotoUploadRequest {
  stage: GroupPhotoUploadStage; session: string | null; url: string | null; applyVersion: string | null
  bytes: Uint8Array; sha256: string; md5: string
}
export type GroupPhotoUploadCommand = { kind: 'group-photo-upload-read' } |
  { kind: 'group-photo-upload-create'; request: GroupPhotoUploadRequest; bytes: Uint8Array } |
  { kind: 'group-photo-upload-state'; id: string; from: GroupPhotoUploadStage; stage: GroupPhotoUploadStage; session?: string; url?: string; version?: string } |
  { kind: 'group-photo-upload-discard'; id: string; from: GroupPhotoUploadStage }
const conflict = (): never => { throw Object.assign(new Error('Group photo upload changed'), { deliveryCode: 'conflict' }) }
export function groupPhotoUploadPath(chatId: string, id: string): string { return `group_photos/${identifier(chatId)}/${backgroundPhotoId(id)}.jpg` }
export function groupPhotoUploadSession(raw: string, chatId: string, id: string): string {
  const url = new URL(raw)
  if (raw.length > 8192 || url.protocol !== 'https:' || url.host !== 'firebasestorage.googleapis.com' || url.username || url.password || url.hash ||
    url.pathname !== `/v0/b/${bucket}/o` || !url.searchParams.get('upload_id') || (url.searchParams.has('name') && url.searchParams.get('name') !== groupPhotoUploadPath(chatId, id))) return conflict()
  return url.href
}
export function groupPhotoUploadURL(raw: string, chatId: string, id: string): string {
  const url = new URL(raw)
  if (raw.length > 10000 || url.protocol !== 'https:' || url.host !== 'firebasestorage.googleapis.com' || url.username || url.password || url.hash ||
    url.pathname !== `/v0/b/${bucket}/o/${encodeURIComponent(groupPhotoUploadPath(chatId, id))}` || url.searchParams.get('alt') !== 'media' || !url.searchParams.get('token')) return conflict()
  return url.href
}
export function validateGroupPhotoRecord(photo: GroupPhotoUploadRecord): void {
  groupPhotoUploadRequest({ id: photo.id, chatId: photo.chatId, version: photo.version, title: photo.title }); profilePhotoBytes(photo.bytes)
  if (createHash('sha256').update(photo.bytes).digest('hex') !== photo.sha256 || createHash('md5').update(photo.bytes).digest('base64') !== photo.md5 ||
    !['upload', 'ready', 'committing', 'confirmed', 'rejected'].includes(photo.stage)) return conflict()
  if (photo.session) groupPhotoUploadSession(photo.session, photo.chatId, photo.id)
  if (photo.url) groupPhotoUploadURL(photo.url, photo.chatId, photo.id)
  if (photo.stage !== 'upload' && !photo.url) return conflict()
  if (['committing', 'confirmed', 'rejected'].includes(photo.stage)) groupPhotoVersion(photo.applyVersion)
  else if (photo.applyVersion !== null) return conflict()
}
function read(db: Database.Database): GroupPhotoUploadRecord | null {
  const rows = db.prepare(`SELECT id,payload,stage,session,url,CASE WHEN length(source)<=1048576 THEN source END AS source,sha256,md5,apply_version AS applyVersion
    FROM group_photo_uploads WHERE payload IS NOT NULL LIMIT 2`).all() as { id: string; payload: string; stage: GroupPhotoUploadStage; session: string | null; url: string | null; source: Buffer; sha256: string; md5: string; applyVersion: string | null }[]
  if (rows.length > 1) return conflict()
  const row = rows[0]
  if (!row) return null
  if (row.payload.length > 10000) return conflict()
  const request = groupPhotoUploadRequest(JSON.parse(row.payload))
  if (request.id !== row.id) return conflict()
  const photo = { ...request, stage: row.stage, session: row.session, url: row.url, bytes: row.source, sha256: row.sha256, md5: row.md5, applyVersion: row.applyVersion }
  validateGroupPhotoRecord(photo); return photo
}
export function executeGroupPhotoUpload(db: Database.Database, command: GroupPhotoUploadCommand): GroupPhotoUploadRecord | null {
  if (command.kind === 'group-photo-upload-read') return read(db)
  return db.transaction(() => {
    const old = read(db)
    if (command.kind === 'group-photo-upload-create') {
      const request = groupPhotoUploadRequest(command.request), bytes = profilePhotoBytes(command.bytes)
      const sha256 = createHash('sha256').update(bytes).digest('hex'), md5 = createHash('md5').update(bytes).digest('base64')
      if (old) {
        const previous = { id: old.id, chatId: old.chatId, version: old.version, title: old.title }
        if (old.stage === 'upload' && old.sha256 === sha256 && JSON.stringify(request) === JSON.stringify(previous)) return old
        return conflict()
      }
      if (db.prepare('SELECT 1 FROM group_photo_uploads WHERE id=?').get(request.id)) return conflict()
      if ((db.prepare('SELECT COUNT(*) AS n FROM group_photo_uploads').get() as { n: number }).n >= 10000) throw Object.assign(new Error('Group photo record capacity'), { deliveryCode: 'capacity' })
      db.prepare("INSERT INTO group_photo_uploads(id,payload,stage,source,sha256,md5) VALUES(?,?,'upload',?,?,?)").run(request.id, JSON.stringify(request), Buffer.from(bytes), sha256, md5)
    } else {
      const id = backgroundPhotoId(command.id)
      if (!old || old.id !== id || old.stage !== command.from) return conflict()
      if (command.kind === 'group-photo-upload-discard') {
        db.prepare("UPDATE group_photo_uploads SET payload=NULL,source=NULL,session=NULL,url=NULL,sha256=NULL,md5=NULL,apply_version=NULL,stage='discarded' WHERE id=?").run(id)
        return null
      }
      const allowed: Record<GroupPhotoUploadStage, GroupPhotoUploadStage[]> = { upload: ['upload', 'ready'], ready: ['committing'], committing: ['confirmed', 'rejected'], confirmed: [], rejected: [] }
      if (!allowed[old.stage].includes(command.stage)) return conflict()
      const session = command.session === undefined ? old.session : groupPhotoUploadSession(command.session, old.chatId, id)
      const url = command.url === undefined ? old.url : groupPhotoUploadURL(command.url, old.chatId, id)
      const applyVersion = command.stage === 'committing' ? groupPhotoVersion(command.version) : old.applyVersion
      if ((old.session && old.session !== session) || (old.url && old.url !== url) || (command.stage !== 'upload' && !url) || (command.stage !== 'committing' && command.version !== undefined)) return conflict()
      db.prepare('UPDATE group_photo_uploads SET stage=?,session=?,url=?,apply_version=? WHERE id=?').run(command.stage, session, url, applyVersion, id)
    }
    return read(db)
  })()
}
