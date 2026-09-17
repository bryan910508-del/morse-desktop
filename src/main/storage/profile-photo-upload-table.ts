import type Database from 'better-sqlite3-multiple-ciphers'
import { createHash } from 'node:crypto'
import { backgroundPhotoId } from '../../shared/chat-background'
import { maxProfilePhotoHistory, profilePhotoBytes } from '../../shared/profile-photo-upload'
import { identifier } from '../../shared/validation'
import { storageBucket as bucket } from '../media/media-document'

export interface ProfileUploadRecord {
  id: string; stage: 'upload' | 'ready' | 'committing'; session: string | null; url: string | null
  bytes: Uint8Array; sha256: string; md5: string
}
export interface ProfileHistoryRecord { id: string; url: string; bytes: Uint8Array; sha256: string; md5: string; appliedAt: number }
export interface ProfileUploadState { pending: ProfileUploadRecord | null; history?: ProfileHistoryRecord[] }
export type ProfileUploadCommand = { kind: 'profile-upload-read' } |
  { kind: 'profile-upload-create'; id: string; bytes: Uint8Array } |
  { kind: 'profile-upload-state'; id: string; from: ProfileUploadRecord['stage']; stage: ProfileUploadRecord['stage']; session?: string; url?: string } |
  { kind: 'profile-upload-discard' | 'profile-upload-finalize' | 'profile-history-restore' | 'profile-history-forget'; id: string }
const conflict = (): never => { throw Object.assign(new Error('Profile upload changed'), { deliveryCode: 'conflict' }) }
export function profileUploadPath(uid: string, id: string): string { return `profile_photos/${identifier(uid)}/${backgroundPhotoId(id)}.jpg` }
export function profileUploadSession(raw: string, uid: string, id: string): string {
  const url = new URL(raw)
  if (raw.length > 8192 || url.protocol !== 'https:' || url.host !== 'firebasestorage.googleapis.com' || url.username || url.password || url.hash ||
    url.pathname !== `/v0/b/${bucket}/o` || !url.searchParams.get('upload_id') || (url.searchParams.has('name') && url.searchParams.get('name') !== profileUploadPath(uid, id))) return conflict()
  return url.href
}
export function profileUploadURL(raw: string, uid: string, id: string): string {
  const url = new URL(raw)
  if (raw.length > 10000 || url.protocol !== 'https:' || url.host !== 'firebasestorage.googleapis.com' || url.username || url.password || url.hash ||
    url.pathname !== `/v0/b/${bucket}/o/${encodeURIComponent(profileUploadPath(uid, id))}` || url.searchParams.get('alt') !== 'media' || !url.searchParams.get('token')) return conflict()
  return url.href
}
function read(db: Database.Database): ProfileUploadRecord | null {
  const row = db.prepare('SELECT id,stage,session,url,CASE WHEN length(source)<=1048576 THEN source END AS source,sha256,md5 FROM profile_photo_upload WHERE slot=1').get() as
    (Omit<ProfileUploadRecord, 'bytes'> & { source: Buffer }) | undefined
  return row ? { id: row.id, stage: row.stage, session: row.session, url: row.url, bytes: profilePhotoBytes(row.source), sha256: row.sha256, md5: row.md5 } : null
}
function history(db: Database.Database): ProfileHistoryRecord[] {
  const rows = db.prepare(`SELECT id,url,CASE WHEN length(source)<=1048576 THEN source END AS source,sha256,md5,applied_at AS appliedAt
    FROM profile_photo_history ORDER BY sequence DESC LIMIT ?`).all(maxProfilePhotoHistory + 1) as (Omit<ProfileHistoryRecord, 'bytes'> & { source: Buffer })[]
  if (rows.length > maxProfilePhotoHistory) return conflict()
  return rows.map(({ source, ...row }) => ({ ...row, bytes: profilePhotoBytes(source) }))
}
export function executeProfileUpload(db: Database.Database, uid: string, command: ProfileUploadCommand): ProfileUploadState {
  return db.transaction(() => {
    const old = read(db)
    if (command.kind === 'profile-upload-read') return { pending: old, history: history(db) }
    const id = backgroundPhotoId(command.id)
    if (command.kind === 'profile-history-restore' || command.kind === 'profile-history-forget') {
      if (old) return conflict()
      if (command.kind === 'profile-history-forget') {
        if (db.prepare('DELETE FROM profile_photo_history WHERE id=?').run(id).changes !== 1) return conflict()
        return { pending: null, history: history(db) }
      }
      const inserted = db.prepare(`INSERT INTO profile_photo_upload(slot,id,stage,session,url,source,sha256,md5)
        SELECT 1,id,'ready',NULL,url,source,sha256,md5 FROM profile_photo_history WHERE id=?`).run(id)
      if (inserted.changes !== 1) return conflict()
      return { pending: read(db) }
    }
    if (command.kind === 'profile-upload-create') {
      const bytes = profilePhotoBytes(command.bytes), sha256 = createHash('sha256').update(bytes).digest('hex'), md5 = createHash('md5').update(bytes).digest('base64')
      if (old) { if (old.id === id && old.sha256 === sha256) return { pending: old }; return conflict() }
      db.prepare("INSERT INTO profile_photo_upload(slot,id,stage,session,url,source,sha256,md5) VALUES(1,?,'upload',NULL,NULL,?,?,?)").run(id, Buffer.from(bytes), sha256, md5)
    } else {
      if (!old || old.id !== id) return conflict()
      if (command.kind === 'profile-upload-discard') { db.prepare('DELETE FROM profile_photo_upload WHERE slot=1').run(); return { pending: null } }
      if (command.kind === 'profile-upload-finalize') {
        if (old.stage !== 'committing' || !old.url) return conflict()
        profileUploadURL(old.url, uid, id)
        // One transaction retains an acknowledged photo and consumes its pending apply.
        db.prepare('DELETE FROM profile_photo_history WHERE id=?').run(id)
        db.prepare(`INSERT INTO profile_photo_history(id,url,source,sha256,md5,applied_at)
          SELECT id,url,source,sha256,md5,? FROM profile_photo_upload WHERE slot=1`).run(Date.now())
        db.prepare('DELETE FROM profile_photo_history WHERE sequence NOT IN (SELECT sequence FROM profile_photo_history ORDER BY sequence DESC LIMIT ?)').run(maxProfilePhotoHistory)
        db.prepare('DELETE FROM profile_photo_upload WHERE slot=1').run()
        return { pending: null, history: history(db) }
      }
      if (command.kind !== 'profile-upload-state') return conflict()
      if (old.stage !== command.from || !({ upload: ['upload', 'ready'], ready: ['committing'], committing: ['ready'] }[old.stage].includes(command.stage))) return conflict()
      const session = command.session === undefined ? old.session : profileUploadSession(command.session, uid, id)
      const url = command.url === undefined ? old.url : profileUploadURL(command.url, uid, id)
      if ((old.session && session !== old.session) || (old.url && url !== old.url) || (command.stage !== 'upload' && !url)) return conflict()
      db.prepare('UPDATE profile_photo_upload SET stage=?,session=?,url=? WHERE slot=1').run(command.stage, session, url)
    }
    return { pending: read(db) }
  })()
}
