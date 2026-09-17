import type Database from 'better-sqlite3-multiple-ciphers'
import { createHash } from 'node:crypto'
import { contactPhotoEdit, contactPhotoRemoval, maxContactPhotoStorage, type ContactPhotoEdit, type ContactPhotoRemoval } from '../../shared/contact-photo'
import { profilePhotoBytes } from '../../shared/profile-photo-upload'
import { backgroundPhotoId } from '../../shared/chat-background'
import { identifier } from '../../shared/validation'

export interface ContactPhotoRecord { uid: string; version: string; photoId: string | null; sha256: string | null; bytes: number }
export interface ContactPhotoSource { bytes: Uint8Array; sha256: string }
export type ContactPhotoCommand = { kind: 'contact-photo-list' } |
  { kind: 'contact-photo-remove'; removal: ContactPhotoRemoval } |
  { kind: 'contact-photo-source'; uid: string; photoId: string } |
  { kind: 'contact-photo-save'; uid: string; edit: ContactPhotoEdit; bytes?: Uint8Array }
const fail = (code: 'conflict' | 'capacity'): never => { throw Object.assign(new Error('Contact photo ' + code), { deliveryCode: code }) }
function record(db: Database.Database, uid: string): ContactPhotoRecord | undefined {
  return db.prepare('SELECT peer_uid AS uid,version,photo_id AS photoId,sha256,COALESCE(length(source),0) AS bytes FROM contact_personal_photos WHERE peer_uid=?').get(uid) as ContactPhotoRecord | undefined
}
export function executeContactPhoto(db: Database.Database, command: ContactPhotoCommand): unknown {
  if (command.kind === 'contact-photo-list') {
    const rows = db.prepare('SELECT peer_uid AS uid,version,photo_id AS photoId,sha256,COALESCE(length(source),0) AS bytes FROM contact_personal_photos LIMIT 10001').all()
    if (rows.length > 10000) return fail('capacity')
    return rows
  }
  if (command.kind === 'contact-photo-remove') {
    const removal = contactPhotoRemoval(command.removal)
    return db.transaction(() => {
      const old = record(db, removal.uid)
      if (!old || old.version !== removal.version || old.photoId !== removal.photoId) return fail('conflict')
      db.prepare('UPDATE contact_personal_photos SET version=?,photo_id=NULL,source=NULL,sha256=NULL WHERE peer_uid=? AND version=? AND photo_id=?')
        .run(removal.operationId, removal.uid, removal.version, removal.photoId)
      return { uid: removal.uid, version: removal.operationId, photoId: null, sha256: null, bytes: 0 } satisfies ContactPhotoRecord
    })()
  }
  const uid = identifier(command.uid)
  if (command.kind === 'contact-photo-source') {
    const row = db.prepare(`SELECT CASE WHEN length(source)<=1048576 THEN source END AS bytes,sha256
      FROM contact_personal_photos WHERE peer_uid=? AND photo_id=?`).get(uid, backgroundPhotoId(command.photoId)) as ContactPhotoSource | undefined
    if (!row) return null
    profilePhotoBytes(row.bytes)
    return row
  }
  const edit = contactPhotoEdit(command.edit)
  return db.transaction(() => {
    const old = record(db, uid)
    const bytes = edit.photoId ? profilePhotoBytes(command.bytes) : null
    if (!edit.photoId && command.bytes !== undefined) return fail('conflict')
    const sha256 = bytes ? createHash('sha256').update(bytes).digest('hex') : null
    if (old?.version === edit.operationId) {
      if (old.photoId === edit.photoId && old.sha256 === sha256) return old
      return fail('conflict')
    }
    if ((old?.version ?? '') !== edit.expectedVersion) return fail('conflict')
    const totals = db.prepare('SELECT COUNT(*) AS count,COALESCE(SUM(length(source)),0) AS bytes FROM contact_personal_photos').get() as { count: number; bytes: number }
    const oldSize = db.prepare('SELECT COALESCE(length(source),0) AS bytes FROM contact_personal_photos WHERE peer_uid=?').get(uid) as { bytes: number } | undefined
    if ((!old && totals.count >= 10000) || totals.bytes - (oldSize?.bytes ?? 0) + (bytes?.byteLength ?? 0) > maxContactPhotoStorage) return fail('capacity')
    db.prepare(`INSERT INTO contact_personal_photos(peer_uid,version,photo_id,source,sha256) VALUES(?,?,?,?,?)
      ON CONFLICT(peer_uid) DO UPDATE SET version=excluded.version,photo_id=excluded.photo_id,source=excluded.source,sha256=excluded.sha256`)
      .run(uid, edit.operationId, edit.photoId, bytes ? Buffer.from(bytes) : null, sha256)
    return { uid, version: edit.operationId, photoId: edit.photoId, sha256, bytes: bytes?.byteLength ?? 0 } satisfies ContactPhotoRecord
  })()
}
